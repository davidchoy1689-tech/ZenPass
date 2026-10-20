#!/usr/bin/env python3
"""
ZenPass — 圖片前處理（提升 tesseract 中文辨識率）
用法：python3 preprocess-image.py <input> <output.png> [scale]
輸出：JSON（成功與否、尺寸、方法）
失敗時 exit code 非 0，Node 端會 fallback 用原圖。

實測結論（2026-10-20）：
  - 放大 2 倍 + 灰階 + autocontrast → 效果最好（標題＋欄位都讀到）
  - **唔做二值化**：色底白字會變黑塊，tesseract 反而讀唔到標題
  - 另出反相版本，供白字／深底單張使用
"""
import json
import sys


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: preprocess-image.py <in> <out> [scale]"}))
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

    try:
        from PIL import Image, ImageOps
    except Exception as e:
        print(json.dumps({"ok": False, "error": "PIL unavailable: %s" % e}))
        return 3

    try:
        img = Image.open(src)
        if img.mode not in ("L", "RGB"):
            img = img.convert("RGB")
        w, h = img.size
        # 太大唔好再放大（控制 OCR 時間）
        if max(w, h) * scale > 2600:
            scale = max(1.0, 2600.0 / max(w, h))
        if scale > 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        gray = ImageOps.autocontrast(img.convert("L"), cutoff=2)
        gray.save(dst, "PNG")

        inv_path = dst[:-4] + "-inv.png" if dst.lower().endswith(".png") else dst + "-inv.png"
        ImageOps.invert(gray).save(inv_path, "PNG")

        print(json.dumps({
            "ok": True,
            "inverted": inv_path,
            "width": gray.size[0],
            "height": gray.size[1],
            "scale": round(scale, 2),
            "mode": "grayscale+autocontrast",
        }))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
        return 4


if __name__ == "__main__":
    sys.exit(main())
