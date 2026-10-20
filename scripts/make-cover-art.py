#!/usr/bin/env python3
"""
ZenPass — 生成品牌類別封面（漸變底 + 白色運動圖標 + 類別名）
輸出：frontend-v2/assets/img/covers/<slug>.jpg (1000x650, q80)

理由：免費授權相片質素／相關性參差，品牌化設計更一致、零版權風險。
圖標來源：frontend-v2/assets/icons/sports/*.svg（用 macOS qlmanage 轉 PNG）
"""
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "frontend-v2", "assets", "icons", "sports")
OUT_DIR = os.path.join(ROOT, "frontend-v2", "assets", "img", "covers")

W, H = 1000, 650

# slug, 類別名, 圖標檔名, 漸變色（由深到淺）
COVERS = [
    ("emerging-sports", "新興運動", "moelkkyla.svg", ("#0EA5A4", "#0F766E")),
    ("stretch", "伸展", "stretching.svg", ("#F97316", "#C2410C")),
    ("yoga", "瑜伽", "yoga.svg", ("#8B5CF6", "#5B21B6")),
    ("fitness", "健身", "gym.svg", ("#EF4444", "#991B1B")),
    ("meditation", "冥想", "meditation.svg", ("#6366F1", "#3730A3")),
    ("dance", "舞蹈", "dance.svg", ("#EC4899", "#9D174D")),
    ("kids-fitness", "兒童體適能", "kids-fitness.svg", ("#F59E0B", "#B45309")),
    ("senior-fitness", "長者體適能", "senior.svg", ("#10B981", "#047857")),
    ("trx", "TRX 懸吊訓練", "gym.svg", ("#0F172A", "#334155")),
    ("table-tennis", "乒乓球", "table-tennis.svg", ("#3B82F6", "#1D4ED8")),
    ("bowling", "保齡球", "bowling.svg", ("#64748B", "#1E293B")),
    ("fencing", "劍擊", "fencing.svg", ("#7C3AED", "#4C1D95")),
    ("default", "其他活動", "aerobics.svg", ("#0EA5E9", "#075985")),
]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def gradient(w, h, c1, c2):
    img = Image.new("RGB", (w, h), c1)
    d = ImageDraw.Draw(img)
    a, b = hex_rgb(c1), hex_rgb(c2)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    # 斜向光暈
    overlay = Image.new("L", (w, h), 0)
    od = ImageDraw.Draw(overlay)
    od.ellipse([-w * 0.35, -h * 0.9, w * 0.9, h * 0.6], fill=38)
    img.paste(Image.new("RGB", (w, h), "white"), (0, 0), overlay)
    return img


def font(size, bold=True):
    cands = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in cands:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def icon_png(svg_name, px=520):
    tmp = tempfile.mkdtemp()
    subprocess.run(["qlmanage", "-t", "-s", str(px), "-o", tmp, os.path.join(ICON_DIR, svg_name)],
                   check=True, capture_output=True)
    for f in os.listdir(tmp):
        if f.lower().endswith(".png"):
            return os.path.join(tmp, f)
    raise RuntimeError("qlmanage failed for " + svg_name)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for slug, label, svg, (c1, c2) in COVERS:
        img = gradient(W, H, c1, c2)
        # 圖標（白色）：用 alpha 反白
        try:
            p = icon_png(svg)
            ic = Image.open(p).convert("RGB")
            # qlmanage 出嚟係白底黑線 → 用亮度反相做 mask，再裁走白邊
            gray = ic.convert("L")
            mask = gray.point(lambda v: 0 if v > 235 else 255 - v)
            bbox = mask.getbbox()
            if bbox:
                gray = gray.crop(bbox)
                mask = mask.crop(bbox)
            side = 400
            w0, h0 = mask.size
            scale = side / max(w0, h0)
            size = (max(1, int(w0 * scale)), max(1, int(h0 * scale)))
            mask = mask.resize(size, Image.LANCZOS)
            white = Image.new("RGBA", size, (255, 255, 255, 0))
            white.putalpha(mask.point(lambda v: int(v * 0.95)))
            img.paste(white, (80, 150), white)
        except Exception as e:
            print("icon fail", slug, str(e)[:80])

        d = ImageDraw.Draw(img)
        d.text((70, 60), "ZenPass 禪流", font=font(30, False), fill=(255, 255, 255, 220))
        size = 72
        f_label = font(size)
        while d.textlength(label, font=f_label) > W - 140 and size > 34:
            size -= 4
            f_label = font(size)
        d.text((70, 470 + (72 - size)), label, font=f_label, fill="white")
        d.text((74, 570), "全港新興運動・體驗課堂", font=font(28, False), fill=(255, 255, 255, 210))

        path = os.path.join(OUT_DIR, slug + ".jpg")
        img.save(path, "JPEG", quality=82, optimize=True)
        manifest[slug] = {
            "label": label,
            "file": slug + ".jpg",
            "source": "generated (ZenPass brand art)",
            "license": "proprietary — ZenPass",
            "icon": svg,
            "gradient": [c1, c2],
            "bytes": os.path.getsize(path),
        }
        print("ok", slug, os.path.getsize(path) // 1024, "KB")

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("done", len(manifest))


if __name__ == "__main__":
    main()
