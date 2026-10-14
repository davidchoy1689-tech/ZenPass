#!/usr/bin/env python3
"""
ZenPass — inline <script> syntax checker

Why: a single JS syntax error inside an inline <script> silently kills the whole
page (this happened to admin.html, which stayed broken for months). node --check
on each inline script catches that class of bug at commit time.

Usage: python3 check-inline-js.py file1.html file2.html ...
Exit code 0 = all OK (or skipped), 1 = at least one inline script has a syntax error.
"""
import re
import sys
import os
import subprocess
import tempfile

SCRIPT_RE = re.compile(r"<script([^>]*)>(.*?)</script>", re.S | re.I)


def extract_inline_scripts(html):
    out = []
    for attrs, body in SCRIPT_RE.findall(html):
        a = (attrs or "").lower()
        if "src=" in a:
            continue
        if "ld+json" in a:
            continue
        if body.strip() == "":
            continue
        out.append(body)
    return out


def check_file(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            html = fh.read()
    except OSError as e:
        print(f"  ⚠️  {path}: 讀取失敗 ({e})")
        return True
    scripts = extract_inline_scripts(html)
    ok = True
    for i, src in enumerate(scripts):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
            tf.write(src)
            tmp = tf.name
        try:
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            if r.returncode != 0:
                ok = False
                first = ""
                for line in r.stderr.splitlines():
                    s = line.strip()
                    if s.startswith("SyntaxError") or s.startswith("ReferenceError") or s.startswith("Error"):
                        first = s
                        break
                print(f"  ❌ {path}: inline <script> #{i + 1} 有 JS 語法錯誤 — {first}")
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    return ok


def main(argv):
    files = [f for f in argv[1:] if f.lower().endswith(".html")]
    if not files:
        return 0
    all_ok = True
    for f in files:
        if not os.path.exists(f):
            continue
        if not check_file(f):
            all_ok = False
    if not all_ok:
        print("❌ 有 inline <script> 語法錯誤 — 請修正後再 commit")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
