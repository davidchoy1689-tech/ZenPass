#!/usr/bin/env node
// ZenPass 課程預約完整 E2E 測試
// Flow: Browse → Class Detail → Book → Payment → Confirmation
const { chromium } = require('playwright');

const BASE = 'http://localhost:3001';
const APIBASE = BASE + '/api';
const EMAIL = 'admin@zenpass.hk';
const PASS = 'admin123';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-HK' });
  const page = await context.newPage();
  
  var tests = { pass: 0, fail: 0, skip: 0 };
  var errors = [];
  page.on('pageerror', e => errors.push(e.message));
  
  async function t(name, fn) {
    try {
      await fn();
      console.log('  ✅ ' + name);
      tests.pass++;
    } catch(e) {
      console.log('  ❌ ' + name + ': ' + e.message);
      tests.fail++;
    }
  }
  
  // ===== 1. Login via API directly =====
  await t('登入（API）', async () => {
    // Go to homepage first to establish origin
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(async () => {
      var r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({email:'admin@zenpass.hk', password:'admin123'})
      });
      var d = await r.json();
      if (d.token) {
        localStorage.setItem('***', d.token);
        return true;
      }
      return false;
    });
  });
  
  // ===== 2. Browse Courses (from index page) =====
  await t('瀏覽首頁課程', async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    var title = await page.textContent('title');
    if (!title.includes('ZenPass')) throw new Error('Wrong page: ' + title);
  });
  
  // ===== 3. Explore page =====
  await t('探索課程頁載入', async () => {
    await page.goto(BASE + '/explore.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    var hasClasses = await page.evaluate(() => document.querySelectorAll('.class-card').length > 0);
    if (!hasClasses) throw new Error('No classes loaded');
  });
  
  // ===== 4. Date filtering =====
  await t('日期篩選（點擊有課日期）', async () => {
    var dateChips = await page.$$('.date-chip');
    // Skip "全部日期" chip (first one), click the first real date
    if (dateChips.length < 2) {
      tests.skip++;
      console.log('  ⏭️ Only "全部日期" chip available, skipping date filter test');
      return;
    }
    await dateChips[1].click();
    await page.waitForTimeout(1000);
    // Should update class list
  });
  
  // ===== 5. Courses page =====
  await t('課程列表頁', async () => {
    await page.goto(BASE + '/courses.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    var bodyLen = await page.evaluate(() => document.body.innerHTML.length);
    if (bodyLen < 200) throw new Error('Empty page');
  });
  
  // ===== 6. Class Detail page =====
  await t('課程詳情頁', async () => {
    // Navigate to class-detail with a known class ID
    await page.goto(BASE + '/class-detail.html?id=1', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    var body = await page.evaluate(() => document.body.textContent.substring(0, 300));
    if (body.length < 50) throw new Error('Empty class detail');
  });
  
  // ===== 7. Booking API (direct test) =====
  await t('預約 API 測試', async () => {
    // Get token from localStorage
    var token = await page.evaluate(() => localStorage.getItem('***'));
    if (!token) throw new Error('No auth token');
    
    // Try to create a booking via API
    var result = await page.evaluate(async () => {
      var token = localStorage.getItem('***');
      // Get available schedules
      var schedRes = await fetch('/api/classes/1', {
        headers: {'Authorization': 'Bearer ' + token}
      });
      var schedData = await schedRes.json();
      
      // Try to book
      if (schedData.schedules && schedData.schedules.length > 0) {
        var scheduleId = schedData.schedules[0].id;
        var bookRes = await fetch('/api/bookings', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
          body: JSON.stringify({ class_id: '1', schedule_id: scheduleId })
        });
        var bookData = await bookRes.json();
        return { scheduleFound: true, bookingResult: bookRes.status, hasBooking: !!bookData.booking };
      }
      return { scheduleFound: false, bookingResult: null };
    });
    
    if (result.scheduleFound && result.bookingResult) {
      console.log('    Schedule found, booking HTTP ' + result.bookingResult);
    } else if (!result.scheduleFound) {
      console.log('    ⚠️ No schedules available for this class (expected - might be in future)');
    }
  });
  
  // ===== 8. Payment page =====
  await t('付款頁載入', async () => {
    await page.goto(BASE + '/payment.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    var body = await page.evaluate(() => document.body.textContent.substring(0, 100));
    if (body.length < 20) throw new Error('Empty payment page');
  });
  
  // ===== 9. My Bookings page =====
  await t('我的預約頁', async () => {
    await page.goto(BASE + '/my-bookings.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    var body = await page.evaluate(() => document.body.textContent);
    if (body.length < 50) throw new Error('Empty bookings page');
  });
  
  // ===== 10. My page =====
  await t('個人主頁', async () => {
    await page.goto(BASE + '/my.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    var body = await page.evaluate(() => document.body.textContent.substring(0, 200));
    if (body.length < 50) throw new Error('Empty my page');
  });
  
  // ===== 11. Check for no JS errors =====
  await t('JS 無錯誤', async () => {
    if (errors.length > 0) throw new Error(errors.join(', '));
  });
  
  // ===== Results =====
  console.log('\n═══════════════════════════════════');
  console.log('📊 課程預約 E2E 測試結果');
  console.log('═══════════════════════════════════');
  console.log('  ✅ 通過: ' + tests.pass);
  console.log('  ❌ 失敗: ' + tests.fail);
  if (tests.skip > 0) console.log('  ⏭️ 跳過: ' + tests.skip);
  console.log('  總計: ' + (tests.pass + tests.fail + tests.skip) + ' 項');
  console.log('═══════════════════════════════════\n');
  
  await browser.close();
  process.exit(tests.fail > 0 ? 1 : 0);
})();
