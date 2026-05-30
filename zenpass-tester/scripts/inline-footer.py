#!/usr/bin/env python3
"""Inline the canonical footer into every page, matching the homepage exactly."""

import re, os, glob

FRONTEND = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend')
FOOTER_FILE = os.path.join(FRONTEND, 'assets', 'footer.html')

# Read the canonical footer HTML
with open(FOOTER_FILE, 'r') as f:
    CANONICAL_FOOTER = f.read().strip()

# Also add the back-to-top button
BACK_TO_TOP = '''<button
  class="back-to-top"
  id="backToTop"
  onclick="window.scrollTo({ top: 0, behavior: 'smooth' })"
  aria-label="返回頂部">
  ↑
</button>
<script>
  window.addEventListener("scroll", function () {
    var el = document.getElementById("backToTop");
    if (el) el.classList.toggle("visible", window.scrollY > 400);
  });
</script>'''

# Collect all HTML files in frontend/ and frontend/admin/
pages = sorted(glob.glob(os.path.join(FRONTEND, '*.html')))
pages += sorted(glob.glob(os.path.join(FRONTEND, 'admin', '*.html')))

stats = {'updated': 0}

for path in pages:
    name = os.path.relpath(path, FRONTEND)
    with open(path, 'r', encoding='utf-8') as f:
        raw = f.read()

    # 1. Remove any existing <footer>...</footer> block (old inline footer)
    raw = re.sub(r'<footer[^>]*>.*?</footer>', '', raw, flags=re.DOTALL | re.IGNORECASE)

    # 2. Remove any orphaned footer CSS blocks
    raw = re.sub(r'<style>\s*\.footer-grad\s*\{.*?</style>', '', raw, flags=re.DOTALL)
    raw = re.sub(r'<style>\s*\.footer-link[^}]*\}.*?</style>', '', raw, flags=re.DOTALL)

    # 3. Remove the dynamic loader placeholder and script
    raw = re.sub(r'<div\s+id="zp-footer"\s*></div>\s*', '', raw)
    raw = re.sub(r'\n?<script[^>]*src="[^"]*footer-loader[^"]*"[^>]*></script>\s*', '', raw)

    # 4. Remove old back-to-top button + scroll script (if any)
    raw = re.sub(
        r'<button[^>]*class="back-to-top"[^>]*>.*?</button>\s*',
        '', raw, flags=re.DOTALL
    )
    raw = re.sub(
        r'\n?\s*window\.addEventListener\("scroll",\s*function\s*\(\)\s*\{.*?getElementById\("backToTop"\).*?scrollY\s*>\s*\d+\s*\}\);\s*\);\s*',
        '', raw, flags=re.DOTALL
    )

    # 5. Inject the canonical footer + back-to-top before LAST </body>
    # (避免注入到 JS 字串入面嘅 </body>)
    last_body = raw.rfind('</body>')
    if last_body >= 0:
        raw = raw[:last_body] + footer_block + raw[last_body:]

    with open(path, 'w', encoding='utf-8') as f:
        f.write(raw)

    stats['updated'] += 1
    print(f'  ✓ {name}')

print(f'\n✅ {stats["updated"]} 頁已 inline 統一 footer')
