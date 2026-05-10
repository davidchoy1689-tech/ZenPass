#!/bin/bash
# Capture screenshots of the new pages (Points, Badges, Share, etc.)
BASE_URL="${ZENPASS_URL:-http://localhost:3001}"
OUTPUT_DIR="test-reports/screenshots-new"
mkdir -p "$OUTPUT_DIR"

cat > /tmp/zenpass-newpages.js << 'SCRIPT'
const { chromium } = require('playwright');
const BASE_URL = process.env.ZENPASS_URL || 'http://localhost:3001';
const OUTPUT_DIR = 'test-reports/screenshots-new';

const PAGES = [
  ["points", "points.html"],
  ["badges", "badges.html"],
  ["my", "my.html"],
  ["checkin", "checkin.html"],
  ["share", "share.html?badge=%E5%82%B3%E5%A5%87%E9%81%8B%E5%8B%95%E5%93%A1&icon=%F0%9F%8F%86&desc=100%E5%A0%82%E8%AA%B2%E7%A8%8B%E5%AE%8C%E6%88%90"],
];

const VIEWPORTS = [
  ["mobile-375", 375, 812],
  ["desktop-1280", 1280, 720],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [vpName, width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-HK' });
    const page = await context.newPage();
    for (const [pageName, path] of PAGES) {
      const url = BASE_URL + '/' + path;
      const filename = OUTPUT_DIR + '/' + vpName + '-' + pageName + '.png';
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: filename, fullPage: true });
        console.log('  \x1b[32m✓\x1b[0m ' + vpName + '-' + pageName);
      } catch(e) {
        console.log('  \x1b[31m✗\x1b[0m ' + vpName + '-' + pageName + ': ' + e.message);
      }
    }
    await context.close();
  }
  await browser.close();
})();
SCRIPT

cd "$(dirname "$0")/.."
NODE_PATH=$(pwd)/node_modules node /tmp/zenpass-newpages.js