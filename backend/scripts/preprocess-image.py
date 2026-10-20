#!/usr/bin/env python3
"""
ZenPass — 圖片前處理（提升 tesseract 中文辨識率）
用法：python3 preprocess-image.py <input> <output.png> [scale]
輸出：JSON（成功與否、尺寸、方法）
失敗時 exit code 非 0，Node 端會 fallback 用原圖。
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

        gray = img.convert("L")
        gray = ImageOps.autocontrast(gray, cutoff=2)
        # 自適應式門檻：用中位亮度偏暗者取較低門檻（色底白字／白底黑字都兼顧）
        hist = gray.histogram()
        total = sum(hist) or 1
        cum = 0
        median = 128
        for i, c in enumerate(hist):
            cum += c
            if cum >= total * 0.5:
                median = i
                break
        threshold = 150 if median > 110 else 110
        bw = gray.point(lambda p: 255 if p > threshold else 0, mode="L")
        bw.save(dst, "PNG")
        print(json.dumps({
            "ok": True,
            "width": bw.size[0],
            "height": bw.size[1],
            "scale": round(scale, 2),
            "threshold": threshold,
            "median": median,
        }))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
        return 4


if __name__ == "__main__":
    sys.exit(main())
