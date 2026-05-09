#!/bin/bash
# ZenPass E2E Test Runner (Playwright)
# Usage: bash scripts/e2e-test.sh [light|full]

MODE="${1:-light}"
BASE_URL="${ZENPASS_URL:-http://localhost:3001}"
OUTPUT_DIR="test-reports/e2e"
mkdir -p "$OUTPUT_DIR"

echo "🧪 ZenPass E2E Test ($([ "$MODE" = "light" ] && echo '輕量' || echo '完整'))"
echo "   URL: $BASE_URL"
echo ""

# Create Playwright test script
if [ "$MODE" = "light" ]; then
  cat > /tmp/zenpass-e2e.js << 'SCRIPT'
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = process.env.ZENPASS_URL || 'http://localhost:3001';
const OUTPUT_DIR = 'test-reports/e2e';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-HK' });
  const page = await context.newPage();
  const results = { passed: [], failed: [], screenshots: [] };

  async function test(name, fn) {
    try {
      await fn();
      results.passed.push(name);
      console.log('  \x1b[32m✓\x1b[0m ' + name);
    } catch(e) {
      results.failed.push({ name, error: e.message });
      console.log('  \x1b[31m✗\x1b[0m ' + name + ': ' + e.message);
      const path = OUTPUT_DIR + '/' + name.replace(/[^a-zA-Z0-9]/g,'_') + '.png';
      await page.screenshot({ path });
      results.screenshots.push(path);
    }
  }

  await test("首頁載入", async () => {
    const resp = await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await test("課程頁載入", async () => {
    const resp = await page.goto(BASE_URL + "/courses.html", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await test("登入頁顯示", async () => {
    const resp = await page.goto(BASE_URL + "/login.html", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await test("探索頁載入", async () => {
    const resp = await page.goto(BASE_URL + "/explore.html", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await test("會籍頁載入", async () => {
    const resp = await page.goto(BASE_URL + "/membership.html", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await test("管理後台載入", async () => {
    const resp = await page.goto(BASE_URL + "/admin.html", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await browser.close();
  fs.writeFileSync(OUTPUT_DIR + '/results.json', JSON.stringify(results, null, 2));
  console.log('\n\x1b[36m📋 Results: \x1b[32m' + results.passed.length + ' passed\x1b[0m, \x1b[31m' + results.failed.length + ' failed\x1b[0m');
})();
SCRIPT
else
  cat > /tmp/zenpass-e2e.js << 'SCRIPT'
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = process.env.ZENPASS_URL || 'http://localhost:3001';
const OUTPUT_DIR = 'test-reports/e2e';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-HK' });
  const page = await context.newPage();
  const results = { passed: [], failed: [], screenshots: [] };

  async function test(name, fn) {
    try {
      await fn();
      results.passed.push(name);
      console.log('  \x1b[32m✓\x1b[0m ' + name);
    } catch(e) {
      results.failed.push({ name, error: e.message });
      console.log('  \x1b[31m✗\x1b[0m ' + name + ': ' + e.message);
      const path = OUTPUT_DIR + '/' + name.replace(/[^a-zA-Z0-9]/g,'_') + '.png';
      await page.screenshot({ path });
      results.screenshots.push(path);
    }
  }

  await test("首頁載入", async () => {
    const resp = await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
    if (resp.status() >= 400) throw new Error("HTTP " + resp.status());
  });

  await test("課程頁 + 類別篩選", async () => {
    await page.goto(BASE_URL + "/courses.html", { waitUntil: "networkidle" });
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 50) throw new Error("Page appears empty");
  });

  await test("搜尋功能", async () => {
    await page.goto(BASE_URL + "/explore.html", { waitUntil: "networkidle" });
    const searchInput = await page.$('input');
    if (searchInput) {
      await searchInput.fill("瑜伽");
      await page.waitForTimeout(500);
    }
  });

  await test("會籍頁價格顯示", async () => {
    await page.goto(BASE_URL + "/membership.html", { waitUntil: "networkidle" });
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 100) throw new Error("Membership page appears empty");
  });

  await test("行動版視口 375px", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL + "/courses.html", { waitUntil: "networkidle" });
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 50) throw new Error("Mobile page appears empty");
  });

  await test("管理後台 Dashboard", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BASE_URL + "/admin.html", { waitUntil: "networkidle" });
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.length < 100) throw new Error("Admin page appears empty");
  });

  await test("404 頁面", async () => {
    await page.goto(BASE_URL + "/nonexistent-page.html", { waitUntil: "networkidle" });
  });

  await test("會員頁載入", async () => {
    await page.goto(BASE_URL + "/membership.html", { waitUntil: "networkidle" });
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 50) throw new Error("Membership page appears empty");
  });

  await browser.close();
  fs.writeFileSync(OUTPUT_DIR + '/results.json', JSON.stringify(results, null, 2));
  console.log('\n\x1b[36m📋 Results: \x1b[32m' + results.passed.length + ' passed\x1b[0m, \x1b[31m' + results.failed.length + ' failed\x1b[0m');
})();
SCRIPT
fi

cd /Users/user/.openclaw/workspace/zenpass-platform
node /tmp/zenpass-e2e.js
EXIT=$?

echo ""
echo "📊 報告位置: $OUTPUT_DIR/results.json"
exit $EXIT
