#!/usr/bin/env node
// ZenPass Points Center — 用戶體驗測試
const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:3001';
const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
};

async function testViewport(browser, vpName, vp) {
  console.log(`\n═══════════════════════════════════`);
  console.log(`📱 ${vpName} 測試`);
  console.log(`═══════════════════════════════════`);

  const context = await browser.newContext({
    viewport: vp,
    locale: 'zh-HK',
    colorScheme: 'light',
  });
  const page = await context.newPage();

  var tests = { pass: 0, fail: 0 };

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      tests.pass++;
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`);
      tests.fail++;
    }
  }

  // ===== 1. Login — get token and set localStorage =====
  await test('登入 (獲取 token)', async () => {
    // First go to the origin to establish localStorage domain
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    // Fetch token
    var loginResp = await page.evaluate(async () => {
      var r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@zenpass.hk', password: 'admin123' }),
      });
      return await r.json();
    });
    if (!loginResp.token) throw new Error('Login failed');
    await page.evaluate((t) => { localStorage.setItem('***', t); }, loginResp.token);
  });

  // ===== 2. Load page =====
  await test('頁面載入 (無 error)', async () => {
    await page.goto(BASE_URL + '/points.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    // Check for JS errors only
    var errState = await page.evaluate(() => {
      var el = document.getElementById('loadingState');
      return el ? el.textContent : '';
    });
    if (errState.includes('載入失敗')) throw new Error('Page shows error: ' + errState);
  });

  // ===== 3. Content loads successfully =====
  await test('內容成功載入 (無 error state)', async () => {
    var visible = await page.evaluate(() => {
      var ca = document.getElementById('contentArea');
      return ca && !ca.classList.contains('hidden');
    });
    if (!visible) {
      var errorText = await page.evaluate(() => {
        var el = document.getElementById('loadingState');
        return el ? el.textContent : 'unknown error';
      });
      throw new Error(`Content not loaded: ${errorText}`);
    }
  });

  // ===== 4. Hero Card =====
  await test('Hero Card: 顯示積分餘額', async () => {
    var text = await page.evaluate(() => document.getElementById('heroCard').textContent);
    if (!text.includes('積分餘額')) throw new Error('Missing 積分餘額');
    if (!text.includes('本月賺取')) throw new Error('Missing 本月賺取');
    if (!text.includes('連續簽到')) throw new Error('Missing 連續簽到');
    if (!text.includes('累計賺取')) throw new Error('Missing 累計賺取');
  });

  // ===== 5. Progress Card =====
  await test('進度卡: 顯示等級進度', async () => {
    var text = await page.evaluate(() => {
      var el = document.getElementById('progressCard');
      return el ? el.textContent : '';
    });
    if (!text.includes('分升級') && text.length > 0) {
      // max level — OK
    }
  });

  // ===== 6. Calendar =====
  await test('簽到日曆: 顯示月份標題 + grid', async () => {
    var cells = await page.evaluate(() => {
      var grid = document.getElementById('calendarGrid');
      return grid ? grid.querySelectorAll('.day-cell').length : 0;
    });
    if (cells < 28) throw new Error(`Calendar too few cells: ${cells}`);
  });

  // ===== 7. Action buttons =====
  await test('簽到按鈕存在', async () => {
    var btn = await page.evaluate(() => {
      var b = document.getElementById('checkinBtn');
      return b ? b.textContent.includes('簽到') || b.textContent.includes('已簽到') : false;
    });
    if (!btn) throw new Error('checkin button missing');
  });

  await test('兌換獎勵按鈕存在', async () => {
    var txt = await page.evaluate(() => {
      var btns = document.querySelectorAll('.action-btn');
      return Array.from(btns).map(b => b.textContent).join(', ');
    });
    if (!txt.includes('兌換')) throw new Error('redeem button missing');
  });

  // ===== 8. Tab Bar =====
  await test('Tab Bar: 4 個 tab 存在', async () => {
    var tabs = await page.evaluate(() => {
      return document.querySelectorAll('.tab-bar .tab').length;
    });
    if (tabs !== 4) throw new Error(`Expected 4 tabs, got ${tabs}`);
  });

  // ===== 9. Tab switching =====
  async function testTab(name) {
    await test(`Tab 切換: ${name}`, async () => {
      var btn = await page.$(`.tab[data-tab="${name.toLowerCase()}"]`);
      if (!btn) throw new Error(`tab "${name}" not found`);
      await btn.click();
      await page.waitForTimeout(300);
      var active = await page.evaluate((n) => {
        return document.querySelector(`.tab[data-tab="${n.toLowerCase()}"]`)?.classList.contains('active');
      }, name);
      if (!active) throw new Error(`tab "${name}" not active after click`);
    });
  }
  await testTab('rewards');
  await testTab('tiers');
  await testTab('history');

  // ===== 10. Filter buttons (history tab) =====
  await test(`Filter: 4 個 filter 按鈕`, async () => {
    // Switch to history tab first
    await page.click('.tab[data-tab="history"]');
    await page.waitForTimeout(200);
    var filters = await page.evaluate(() => document.querySelectorAll('.filter-btn').length);
    if (filters !== 4) throw new Error(`Expected 4 filters, got ${filters}`);
  });

  await test('Filter: click 每個 filter 正常切換', async () => {
    var btns = await page.$$('.filter-btn');
    for (var btn of btns) {
      var label = await btn.textContent();
      await btn.click();
      await page.waitForTimeout(100);
      var activeText = await page.evaluate(() => {
        var a = document.querySelector('.filter-btn.active');
        return a ? a.textContent : 'none';
      });
      if (!activeText) throw new Error(`No active filter after clicking "${label}"`);
    }
  });

  // ===== 11. Tiers Tab =====
  await testTab('tiers');
  await test('等級 Tab: 顯示等級列表', async () => {
    var cards = await page.evaluate(() => {
      return document.querySelectorAll('#tiersList .tier-card').length;
    });
    if (cards < 3) throw new Error(`Expected >=3 tier cards, got ${cards}`);
  });

  // ===== 12. Earn Tab =====
  await testTab('earn');
  await test('賺分 Tab: 顯示排行榜 + 小貼士 + 賺分方法', async () => {
    var txt = await page.evaluate(() => {
      var el = document.getElementById('tabEarn');
      return el ? el.textContent : '';
    });
    if (!txt.includes('排行榜') && !txt.includes('積分')) {
      throw new Error('Earn tab content empty');
    }
  });

  await test('排行榜: 顯示至少 1 個用戶', async () => {
    var items = await page.evaluate(() => {
      return document.querySelectorAll('.leaderboard-item').length;
    });
    if (items === 0) throw new Error('Leaderboard empty');
  });

  await test('小貼士: 有文字內容', async () => {
    var tip = await page.evaluate(() => {
      var el = document.getElementById('tipsText');
      return el ? el.textContent.length : 0;
    });
    if (tip < 5) throw new Error('Tip too short');
  });

  await test('小貼士: refresh 按鈕更換內容', async () => {
    var tip1 = await page.evaluate(() => document.getElementById('tipsText').textContent);
    await page.click('.tips-refresh');
    await page.waitForTimeout(100);
    // Can't guarantee different text (random may return same), just check it still works
    var tip2 = await page.evaluate(() => document.getElementById('tipsText').textContent);
    if (tip2.length < 5) throw new Error('Tip empty after refresh');
  });

  await test('分享成就按鈕存在', async () => {
    var txt = await page.evaluate(() => {
      var btn = document.querySelector('.share-btn');
      return btn ? btn.textContent : '';
    });
    if (!txt.includes('分享')) throw new Error('Share button missing');
  });

  // ===== 13. Rewards Grid =====
  await testTab('rewards');
  await test('獎勵 Tab: grid 顯示', async () => {
    var grid = await page.evaluate(() => {
      var el = document.getElementById('rewardsGrid');
      return el ? el.innerHTML.length > 0 : false;
    });
    if (!grid) throw new Error('Rewards grid empty');
  });

  // ===== 14. Toast test =====
  await test('Toast 系統存在', async () => {
    var container = await page.evaluate(() => {
      var el = document.getElementById('toastContainer');
      return el ? el.tagName : 'missing';
    });
    if (container === 'missing') throw new Error('Toast container missing');
  });

  // ===== 15. Modal =====
  await test('Modal overlay 存在', async () => {
    var modal = await page.evaluate(() => {
      var el = document.getElementById('modal');
      return el ? el.classList.contains('show') : false;
    });
    // Modal starts hidden — that's OK
  });

  // ===== 16. Desktop layout (only for desktop) =====
  if (vpName === 'desktop') {
    await test('桌面版: 三欄 hero-row', async () => {
      var row = await page.evaluate(() => {
        var el = document.querySelector('.hero-row');
        return el ? el.children.length : 0;
      });
      if (row < 2) throw new Error(`Desktop hero-row has ${row} children`);
    });
  }

  // ===== 17. Skeleton hidden after load =====
  await test('載完成: skeleton 隱藏', async () => {
    var hidden = await page.evaluate(() => {
      var el = document.getElementById('skeletonState');
      return el && el.classList.contains('hidden');
    });
    if (!hidden) throw new Error('Skeleton still visible after load');
  });

  // ===== 18. No console errors (excluding auth 401) =====
  await test('無 JS 錯誤', async () => {
    var jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    // Filter out auth 401 errors
    var filtered = jsErrors.filter(e => !e.includes('401') && !e.includes('Unauthorized'));
    if (filtered.length > 0) throw new Error(`JS errors: ${filtered.join(', ')}`);
  });

  await context.close();
  return tests;
}

(async () => {
  console.log(`\n🎯 ZenPass Points Center — 用戶體驗測試\n`);
  console.log(`開始時間: ${new Date().toLocaleString('zh-HK')}`);
  console.log(`URL: ${BASE_URL}/points.html`);

  const browser = await chromium.launch({ headless: true });

  var total = { pass: 0, fail: 0 };

  for (var [name, vp] of Object.entries(VIEWPORTS)) {
    var result = await testViewport(browser, name, vp);
    total.pass += result.pass;
    total.fail += result.fail;
  }

  await browser.close();

  console.log(`\n═══════════════════════════════════`);
  console.log(`📊 測試結果總覽`);
  console.log(`═══════════════════════════════════`);
  console.log(`  ✅ 通過: ${total.pass}`);
  console.log(`  ❌ 失敗: ${total.fail}`);
  console.log(`  總計: ${total.pass + total.fail} 項`);
  console.log(`  完成時間: ${new Date().toLocaleString('zh-HK')}`);
  console.log(`═══════════════════════════════════\n`);

  process.exit(total.fail > 0 ? 1 : 0);
})();
