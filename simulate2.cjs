const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ===== STUDENT BOOKING =====
  console.log('\n=== STUDENT DETAIL ===');
  const p1 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p1.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p1.fill('#login-email', 'student@zenpass.hk');
  await p1.fill('#login-password', 'admin123');
  await p1.click('#login-btn');
  await p1.waitForTimeout(2000);
  await p1.goto('http://localhost:3001/class-detail.html?id=54', { waitUntil: 'networkidle' });
  await p1.waitForTimeout(1000);

  const text1 = await p1.locator('body').innerText();
  const lines1 = text1.split('\n').filter(l => l.trim()).slice(0, 30);
  console.log('Class detail visible:');
  lines1.forEach(l => console.log('  ' + l.trim()));

  await p1.close();

  // ===== COACH DASHBOARD =====
  console.log('\n=== COACH DETAIL ===');
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p2.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p2.fill('#login-email', 'coach@zenpass.hk');
  await p2.fill('#login-password', 'coach123');
  await p2.click('#login-btn');
  await p2.waitForTimeout(2000);
  await p2.goto('http://localhost:3001/coach-dashboard.html', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(3000);

  const text2 = await p2.locator('body').innerText();
  const lines2 = text2.split('\n').filter(l => l.trim()).slice(0, 30);
  console.log('Coach dashboard visible:');
  lines2.forEach(l => console.log('  ' + l.trim()));

  await p2.close();

  // ===== ADMIN PANEL =====
  console.log('\n=== ADMIN DETAIL ===');
  const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p3.goto('http://localhost:3001/login.html', { waitUntil: 'networkidle' });
  await p3.fill('#login-email', 'admin@zenpass.hk');
  await p3.fill('#login-password', 'admin123');
  await p3.click('#login-btn');
  await p3.waitForTimeout(2000);
  await p3.goto('http://localhost:3001/admin.html', { waitUntil: 'networkidle' });
  await p3.waitForTimeout(3000);

  const text3 = await p3.locator('body').innerText();
  const lines3 = text3.split('\n').filter(l => l.trim()).slice(0, 40);
  console.log('Admin panel visible:');
  lines3.forEach(l => console.log('  ' + l.trim()));

  await p3.close();
  await browser.close();
})();
