#!/usr/bin/env python3
"""重建 Noto Sans TC 網頁字體子集（ZenPass）

用法：
    python3 scripts/build-font-subset.py

流程：
  1. 掃 frontend-v2/*.html + assets/*.js 收集實際用到的中文字
  2. 併入香港常見姓氏補充字
  3. 由 Noto Sans TC 可變字體（CFF2）切出 woff2 子集（100–900 全字重，單一檔案）
  4. 輸出 frontend-v2/assets/fonts/NotoSansTC-subset-v2.woff2

注意：
  - 只覆蓋靜態文案用字；DB 動態內容（學員姓名等）缺字會自動 fallback 系統字體，不會出豆腐
  - 加咗新文案／新頁面之後要重跑一次，並把 v2.css / fonts.css 的 ?v= 版本 +1
  - 依賴：pip3 install --user fonttools brotli
"""
import glob
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FE = os.path.join(ROOT, "frontend-v2")
OUT_DIR = os.path.join(FE, "assets", "fonts")
OUT = os.path.join(OUT_DIR, "NotoSansTC-subset-v2.woff2")
VF_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/OTF/Subset/NotoSansTC-VF.otf"
CACHE = "/tmp/NotoSansTC-VF.otf"

# 香港常見姓氏／人名用字（靜態頁面未必出現，但證書、點名表會用到）
EXTRA = (
    # 香港常見姓氏
    "陳李張黃何周梁劉羅蔡吳林楊許鄭謝郭洪曾鍾廖賴徐潘袁葉杜程蘇魏呂丁沈任姚盧傅姜崔譚陸范"
    "冼鄺佘岑衛敖麥溫龔戴馮施莫寧龍歐陽司徒上官諸葛東方獨孤"
    # 常見名字用字（教練／學員姓名，DB 動態內容最容易漏）
    "振輝偉強志明家豪俊傑嘉欣詠詩曉彤浩然子軒雅婷婉婷靜文美玲秀英麗華國建安安琪慧敏"
    "淑儀寶儀美儀少玲惠芳桂芳玉蘭秀蘭鳳英鳳儀月娥美好嘉麗嘉慧嘉敏凱琳凱婷凱欣家欣"
    "家怡家琪家慧子晴子淇子柔芷晴芷欣芷蕎詠恩詠琪詠芝泳琳洛瑤浩軒浩賢晉熙"
    "智豪智健俊軒俊熙俊宇俊宏冠廷冠霖鎧浚銘軒銘峰樂怡樂欣樂瑤樂彤逸朗"
)

UNICODES = "U+0020-007E,U+00A0-00FF,U+2000-206F,U+3000-303F,U+FF00-FFEF"


EXTRA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "font-chars-extra.txt")


def collect_extra() -> str:
    try:
        lines = open(EXTRA_FILE, encoding="utf-8").read().splitlines()
    except OSError:
        return ""
    return "".join(ln for ln in lines if not ln.startswith("#"))


def collect_chars() -> str:
    chars = set()
    for f in glob.glob(os.path.join(FE, "*.html")) + glob.glob(os.path.join(FE, "assets", "*.js")):
        try:
            s = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for ch in s:
            if "\u3400" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff":
                chars.add(ch)
    return "".join(sorted(chars))


def main() -> int:
    text = collect_chars() + EXTRA + collect_extra()
    print(f"chars: {len(set(text))}")
    os.makedirs(OUT_DIR, exist_ok=True)

    if not os.path.exists(CACHE):
        print("downloading variable font …")
        urllib.request.urlretrieve(VF_URL, CACHE)

    tmp_text = "/tmp/zenpass-font-chars.txt"
    open(tmp_text, "w", encoding="utf-8").write(text)

    cmd = [
        sys.executable, "-m", "fontTools.subset", CACHE,
        f"--text-file={tmp_text}",
        f"--unicodes={UNICODES}",
        "--flavor=woff2",
        "--layout-features=ccmp,locl,kern",
        "--no-hinting",
        f"--output-file={OUT}",
    ]
    subprocess.run(cmd, check=True)
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
