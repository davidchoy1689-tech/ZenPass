#!/usr/bin/env python3
"""
ZenPass — 類別預設封面圖抓取（Wikimedia Commons，優先 Public Domain / CC0）

用法：python3 scripts/fetch-covers.py
輸出：
  frontend-v2/assets/img/covers/<slug>.jpg   （800x520, JPEG q78）
  frontend-v2/assets/img/covers/manifest.json（來源、授權、作者 — 供審計）

授權策略：
  1. 只接受 Public domain / CC0 / PD-* （免標註、可商用）
  2. 若搵唔到，退回 CC BY-SA（manifest 記錄作者＋授權，頁面需標註）
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

UA = {"User-Agent": "ZenPassBot/1.0 (contact: info.zenpass@gmail.com)"}
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend-v2", "assets", "img", "covers")

TARGETS = [
    ("emerging-sports", "新興運動", "molkky finnish"),
    ("stretch", "伸展", "stretching exercise fitness"),
    ("yoga", "瑜伽", "yoga class"),
    ("fitness", "健身", "gym workout weights"),
    ("meditation", "冥想", "meditation meditation"),
    ("dance", "舞蹈", "dance class"),
    ("kids-fitness", "兒童體適能", "children physical activity"),
    ("senior-fitness", "長者體適能", "senior citizens exercise"),
    ("trx", "TRX 懸吊訓練", "suspension training trx"),
    ("table-tennis", "乒乓球", "table tennis"),
    ("bowling", "保齡球", "bowling"),
    ("fencing", "劍擊", "fencing sport"),
    ("default", "其他活動", "sports fitness people"),
]

LICENSE_OK = ("public domain", "cc0", "pd", "no restrictions")


def search(query, limit=25):
    q = urllib.parse.quote(query)
    url = (
        "https://commons.wikimedia.org/w/api.php?action=query&format=json"
        "&generator=search&gsrnamespace=6&gsrlimit=%d&gsrsearch=%s"
        "&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1400"
        % (limit, q)
    )
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def pick(pages):
    """優先 PD/CC0，其次 CC BY-SA；排除太細／svg"""
    scored = []
    for p in (pages or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata") or {}
        title = str(p.get("title") or "")
        if title.lower().endswith((".svg", ".gif", ".tif", ".tiff")):
            continue
        w = ii.get("width") or 0
        h = ii.get("height") or 0
        if w < 800 or h < 500:
            continue
        lic = str((md.get("LicenseShortName") or {}).get("value") or "").lower()
        free = any(k in lic for k in LICENSE_OK)
        scored.append({
            "title": title,
            "thumb": ii.get("thumburl") or ii.get("url"),
            "license": (md.get("LicenseShortName") or {}).get("value") or "unknown",
            "author": (md.get("Artist") or {}).get("value") or "",
            "desc_url": ii.get("descriptionurl") or "",
            "free": free,
            "w": w,
        })
    scored.sort(key=lambda x: (not x["free"], -x["w"]))
    return scored[0] if scored else None


def fetch_image(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    from PIL import Image

    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for slug, label, query in TARGETS:
        try:
            data = search(query)
            best = pick((data.get("query") or {}).get("pages"))
            if not best:
                print("skip", slug, "(no result)")
                continue
            raw = fetch_image(best["thumb"])
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            # 裁成 800x520（cover）
            tw, th = 800, 520
            ratio = max(tw / img.width, th / img.height)
            img = img.resize((max(tw, int(img.width * ratio)), max(th, int(img.height * ratio))), Image.LANCZOS)
            left = (img.width - tw) // 2
            top = (img.height - th) // 2
            img = img.crop((left, top, left + tw, top + th))
            path = os.path.join(OUT_DIR, slug + ".jpg")
            img.save(path, "JPEG", quality=78, optimize=True)
            manifest[slug] = {
                "label": label,
                "file": slug + ".jpg",
                "source": "Wikimedia Commons",
                "title": best["title"],
                "license": best["license"],
                "author": best["author"][:200],
                "page": best["desc_url"],
                "bytes": os.path.getsize(path),
            }
            print("ok", slug, best["license"], os.path.getsize(path) // 1024, "KB")
        except Exception as e:
            print("ERR", slug, str(e)[:120])

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("done:", len(manifest), "covers")


if __name__ == "__main__":
    sys.exit(main())
