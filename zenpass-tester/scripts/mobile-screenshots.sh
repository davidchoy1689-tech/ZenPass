#!/bin/bash
# ZenPass Mobile Screenshot Test
# Usage: bash scripts/mobile-screenshots.sh

BASE_URL="${ZENPASS_URL:-http://localhost:3001}"
OUTPUT_DIR="test-reports/screenshots"
mkdir -p "$OUTPUT_DIR"

echo "📸 ZenPass Mobile Screenshot Test"
echo "   URL: $BASE_URL"
echo "   Output: $OUTPUT_DIR/"
echo ""

cat > /tmp/zenpass-screenshots.js << 'SCRIPT'
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = process.env.ZENPASS_URL || 'http://localhost:3001';
const OUTPUT_DIR = 'test-reports/screenshots';

const PAGES = [
  ["index", ""],
  ["courses", "courses.html"],
  ["explore", "explore.html"],
  ["login", "login.html"],
  ["membership", "membership.html"],
  ["my-bookings", "my-bookings.html"],
  ["admin", "admin.html"],
];

const VIEWPORTS = [
  ["mobile-375", 375, 812],
  ["tablet-768", 768, 1024],
  ["desktop-1280", 1280, 720],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const [vpName, width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-HK' });
    const page = await context.newPage();

    for (const [pageName, path] of PAGES) {
      const url = BASE_URL + '/' + path;
      const filename = OUTPUT_DIR + '/' + vpName + '-' + pageName + '.png';
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.screenshot({ path: filename, fullPage: true });
        results.push({ page: pageName, viewport: vpName, file: filename, status: 'ok' });
        console.log('  \x1b[32m✓\x1b[0m ' + vpName + '-' + pageName);
      } catch(e) {
        results.push({ page: pageName, viewport: vpName, file: filename, status: 'error', error: e.message });
        console.log('  \x1b[31m✗\x1b[0m ' + vpName + '-' + pageName + ': ' + e.message);
      }
    }
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(OUTPUT_DIR + '/manifest.json', JSON.stringify(results, null, 2));

  const passed = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;
  console.log('\n\x1b[36m📸 Total: ' + (passed + failed) + ', \x1b[32m' + passed + ' OK\x1b[0m, \x1b[31m' + failed + ' failed\x1b[0m');
})();
SCRIPT

cd /Users/user/.openclaw/workspace/zenpass-platform
NODE_PATH=$(pwd)/node_modules node /tmp/zenpass-screenshots.js
