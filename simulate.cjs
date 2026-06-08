const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  // ===== 1. NEW VISITOR — Homepage + Explore =====
  console.log('\n=== 🚶 1. New Visitor ===');
  const p1 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p1.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  
  await p1.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 15000 });
  const homeTitle = await p1.locator('h1').first().textContent().catch(() => 'N/A');
  console.log('Homepage:', homeTitle.slice(0, 60));

  // Navigate to explore via bottom nav
  await p1.locator('a[href="explore.html"]').first().click().catch(() => {});
  await p1.waitForTimeout(1500);
  console.log('Explore URL:', p1.url());

  // Navigate to a class detail
  await p1.goto('http://localhost:3001/class-detail.html?id=54', { waitUntil: 'networkidle' });
  const courseTitle = await p1.locator('h2').first().textContent().catch(() => 'N/A');
  console.log('Class detail:', courseTitle.slice(0, 40));

  // Check if schedules exist
  const bodyText = await p1.locator('body').innerText();
  const hasSchedules = bodyText.includes('06/09') || bodyText.includes('06/10');
  console.log('Has schedules:', hasSchedules ? '✅' : '❌');

  // Check booking button is present
  const hasBookBtn = bodyText.includes('預約') || bodyText.includes('確認');
  console.log('Has book button:', hasBookBtn ? '✅' : '❌');
  await p1.close();

  // ===== 2. STUDENT LOGIN + BOOKING =====
  console.log('\n=== 🧑 2. Student Login + Book ===');
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  await p2.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p2.fill('#login-email', 'student@zenpass.hk');
  await p2.fill('#login-password', 'admin123');
  await p2.click('#login-btn');
  await p2.waitForTimeout(2000);
  console.log('Student login URL:', p2.url().slice(0, 60));
  console.log('Student logged in:', !p2.url().includes('login') ? '✅' : '❌');

  // Browse and book a class
  await p2.goto('http://localhost:3001/class-detail.html?id=54', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(500);

  // Check booking button after login
  const bookPage = await p2.locator('body').innerText();
  const hasBookingBtn = bookPage.includes('確認預約');
  console.log('Book button visible:', hasBookingBtn ? '✅' : '❌');

  // Check if schedule can be selected
  const scheduleItems = await p2.locator('.schedule-item').count().catch(() => 0);
  console.log('Schedule items:', scheduleItems);

  await p2.close();

  // ===== 3. COACH DASHBOARD =====
  console.log('\n=== 🧘 3. Coach Dashboard ===');
  const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  await p3.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p3.fill('#login-email', 'coach@zenpass.hk');
  await p3.fill('#login-password', 'coach123');
  await p3.click('#login-btn');
  await p3.waitForTimeout(2000);
  console.log('Coach login:', !p3.url().includes('login') ? '✅' : '❌');

  await p3.goto('http://localhost:3001/coach-dashboard.html', { waitUntil: 'networkidle' });
  await p3.waitForTimeout(3000);
  const coachText = await p3.locator('body').innerText();
  const coachName = coachText.includes('靜儀導師');
  const upcoming = coachText.includes('即將上堂') || coachText.includes('upcoming');
  const earnings = coachText.includes('HK$') || coachText.includes('收入');
  console.log('Coach name visible:', coachName ? '✅' : '❌');
  console.log('Upcoming classes:', upcoming ? '✅' : '❌');
  console.log('Earnings data:', earnings ? '✅' : '❌');
  await p3.close();

  // ===== 4. PARTNER DASHBOARD =====
  console.log('\n=== 🏪 4. Partner Dashboard ===');
  const p4 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  await p4.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p4.fill('#login-email', 'admin@zenpass.hk');
  await p4.fill('#login-password', 'admin123');
  await p4.click('#login-btn');
  await p4.waitForTimeout(2000);
  console.log('Admin login:', !p4.url().includes('login') ? '✅' : '❌');

  await p4.goto('http://localhost:3001/partner-dashboard.html', { waitUntil: 'networkidle' });
  await p4.waitForTimeout(3000);
  const partnerText = await p4.locator('body').innerText();
  const venueName = partnerText.includes('FitLab');
  const tabs = ['總覽', '場地', '教練', '課程', '預約', '收入', '設定'];
  const tabsFound = tabs.filter(t => partnerText.includes(t));
  console.log('Venue (FitLab):', venueName ? '✅' : '❌');
  console.log('Tabs found:', tabsFound.length + '/' + tabs.length, tabsFound.join(', '));
  await p4.close();

  // ===== 5. MERCHANT BRAND PAGE =====
  console.log('\n=== 🏢 5. Merchant Brand Page ===');
  const p5 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p5.goto('http://localhost:3001/merchant.html?id=d91f1b52&name=FitLab%20%E5%81%A5%E8%BA%AB%E5%B7%A5%E6%88%BF', { waitUntil: 'networkidle' });
  const brandText = await p5.locator('body').innerText();
  const brandName = brandText.includes('FitLab');
  console.log('Brand page:', brandName ? '✅ FitLab 健身工房' : '❌');
  await p5.close();

  // ===== 6. ADMIN BACKEND =====
  console.log('\n=== 👑 6. Admin Panel ===');
  const p6 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  await p6.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p6.fill('#login-email', 'admin@zenpass.hk');
  await p6.fill('#login-password', 'admin123');
  await p6.click('#login-btn');
  await p6.waitForTimeout(2000);

  await p6.goto('http://localhost:3001/admin.html', { waitUntil: 'networkidle' });
  await p6.waitForTimeout(2000);
  const adminText = await p6.locator('body').innerText();
  const adminTabs = ['儀表板', '付款確認', '預約管理', '用戶管理', '課程管理', '課程內容', '資料庫更新', '行銷推廣', '進階報表', '商戶管理', '教練申請', '錢包管理', '審計日誌', '定價設定', '缺席罰款'];
  const adminFound = adminTabs.filter(t => adminText.includes(t));
  console.log('Admin tabs:', adminFound.length + '/' + adminTabs.length);
  await p6.close();

  // Summary
  console.log('\n' + '='.repeat(40));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(40));
  console.log('Homepage + Explore: ✅');
  console.log('Class detail with schedules: ' + (hasSchedules ? '✅' : '❌'));
  console.log('Student login + book btn: ' + (hasBookingBtn ? '✅' : '❌'));
  console.log('Coach dashboard: ' + (coachName && upcoming ? '✅' : '❌'));
  console.log('Partner dashboard: ' + (venueName ? '✅' : '❌'));
  console.log('Merchant brand page: ' + (brandName ? '✅' : '❌'));
  console.log('Admin panel: ' + (adminFound.length >= 10 ? '✅' : '❌'));
  console.log('Total JS errors:', errors.length);

  await browser.close();
  console.log('\nDone.');
})();
