#!/usr/bin/env python3
"""
ZenPass — 生成「每班專屬」品牌封面（漸變 + 運動圖標 + 班名）
用法：python3 scripts/make-class-cover.py <slug> <icon.svg> <title> [subtitle] [out.jpg]
輸出預設：frontend-v2/assets/img/classes/<slug>.jpg (1200x800)

目的：同一類別唔同班次都可以有獨立、統一品牌風格嘅封面（唔會撞相）。
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "frontend-v2", "assets", "icons", "sports")
OUT_DIR = os.path.join(ROOT, "frontend-v2", "assets", "img", "classes")
W, H = 1200, 800

PALETTES = [
    ("#F97316", "#C2410C"),
    ("#8B5CF6", "#5B21B6"),
    ("#10B981", "#047857"),
    ("#3B82F6", "#1D4ED8"),
    ("#EC4899", "#9D174D"),
    ("#0EA5A4", "#0F766E"),
]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def gradient(c1, c2):
    img = Image.new("RGB", (W, H), c1)
    d = ImageDraw.Draw(img)
    a, b = hex_rgb(c1), hex_rgb(c2)
    for y in range(H):
        t = y / max(1, H - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    overlay = Image.new("L", (W, H), 0)
    ImageDraw.Draw(overlay).ellipse([-W * 0.3, -H * 0.8, W * 0.85, H * 0.55], fill=36)
    img.paste(Image.new("RGB", (W, H), "white"), (0, 0), overlay)
    return img


def font(size):
    for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def icon_mask(svg_name, px=560):
    tmp = tempfile.mkdtemp()
    subprocess.run(["qlmanage", "-t", "-s", str(px), "-o", tmp, os.path.join(ICON_DIR, svg_name)],
                   check=True, capture_output=True)
    png = [f for f in os.listdir(tmp) if f.lower().endswith(".png")][0]
    ic = Image.open(os.path.join(tmp, png)).convert("L")
    mask = ic.point(lambda v: 0 if v > 235 else 255 - v)
    bbox = mask.getbbox()
    if bbox:
        mask = mask.crop(bbox)
    return mask


def build(slug, icon, title, subtitle="", palette=0, out=None):
    c1, c2 = PALETTES[palette % len(PALETTES)]
    img = gradient(c1, c2)
    try:
        m = icon_mask(icon)
        side = 430
        scale = side / max(m.size)
        m = m.resize((max(1, int(m.width * scale)), max(1, int(m.height * scale))), Image.LANCZOS)
        layer = Image.new("RGBA", m.size, (255, 255, 255, 0))
        layer.putalpha(m.point(lambda v: int(v * 0.95)))
        img.paste(layer, (90, 175), layer)
    except Exception as e:
        print("icon warn:", str(e)[:80])

    d = ImageDraw.Draw(img)
    d.text((90, 70), "ZenPass 禪流", font=font(34), fill=(255, 255, 255, 225))

    size = 84
    f = font(size)
    while d.textlength(title, font=f) > W - 180 and size > 40:
        size -= 4
        f = font(size)
    d.text((90, 520 - (84 - size) // 2), title, font=f, fill="white")

    if subtitle:
        d.text((94, 640), subtitle, font=font(32), fill=(255, 255, 255, 215))

    os.makedirs(OUT_DIR, exist_ok=True)
    path = out or os.path.join(OUT_DIR, slug + ".jpg")
    img.save(path, "JPEG", quality=84, optimize=True)
    print("ok", path, os.path.getsize(path) // 1024, "KB")
    return path


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("usage: make-class-cover.py <slug> <icon.svg> <title> [subtitle] [palette]")
        sys.exit(2)
    slug, icon, title = sys.argv[1], sys.argv[2], sys.argv[3]
    subtitle = sys.argv[4] if len(sys.argv) > 4 else ""
    palette = int(sys.argv[5]) if len(sys.argv) > 5 else 0
    build(slug, icon, title, subtitle, palette)
