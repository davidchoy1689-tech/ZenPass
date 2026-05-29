#!/usr/bin/env python3
"""Unify ZenPass footer across all pages."""

import re, os, glob

FRONTEND = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend')
PLACEHOLDER = '<div id="zp-footer"></div>\n'
SCRIPT = '<script src="assets/footer-loader.js"></script>\n'

# Collect all HTML files (skip admin/ for now)
pages = sorted(glob.glob(os.path.join(FRONTEND, '*.html')))

footer_pattern = re.compile(
    r'<footer[^>]*>.*?</footer>',
    re.DOTALL | re.IGNORECASE
)

stats = {'updated': 0, 'added': 0, 'skipped': 0}

for path in pages:
    name = os.path.basename(path)
    with open(path, 'r', encoding='utf-8') as f:
        raw = f.read()

    has_footer_tag = bool(re.search(r'</footer>', raw, re.IGNORECASE))
    has_placeholder = 'id="zp-footer"' in raw
    has_loader = 'footer-loader.js' in raw

    if has_placeholder and has_loader:
        # Already unified
        stats['skipped'] += 1
        continue

    if has_footer_tag:
        # Remove existing footer (everything between <footer> and </footer>)
        raw = re.sub(
            r'<footer[^>]*>.*?</footer>',
            PLACEHOLDER.rstrip('\n'),
            raw,
            count=1,
            flags=re.DOTALL | re.IGNORECASE
        )
        stats['updated'] += 1
        msg = f'  ↻ {name} — replaced inline footer'
    elif not has_placeholder:
        # No footer at all — add placeholder before </body>
        raw = raw.replace('</body>', PLACEHOLDER + SCRIPT + '</body>')
        stats['added'] += 1
        msg = f'  + {name} — added footer'
    else:
        stats['skipped'] += 1
        msg = f'  - {name} — skipped'

    # Ensure script tag is there (if not already from placeholder addition)
    if 'footer-loader.js' not in raw:
        raw = raw.replace('</body>', SCRIPT + '</body>')

    with open(path, 'w', encoding='utf-8') as f:
        f.write(raw)

    print(msg)

print(f'\n✅ 完成: {stats["updated"]} 頁更新, {stats["added"]} 頁新增, {stats["skipped"]} 頁跳過')
