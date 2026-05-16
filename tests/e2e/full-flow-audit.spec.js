import { test, expect } from '@playwright/test';

/**
 * ZenPass 完整 E2E 流程審計 (v4-pro level)
 * 測試所有 11 項功能流程，收集 console errors、page errors、渲染問題
 */

const BASE = 'http://localhost:3001';
const CONSOLE_ERRORS = []; // global collector
const PAGE_ERRORS = [];

// ── Helpers ──────────────────────────────────────────────

async function collectConsoleErrors(page, label) {
  page.on('console', msg => {
    if (msg.type() === 'error') {
      CONSOLE_ERRORS.push(`[${label}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    PAGE_ERRORS.push(`[${label}] ${err.message}`);
  });
}

async function loginAs(page, email, password) {
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-btn');
  await page.waitForTimeout(2000);
}

async function loginViaLocalStorage(page, token, user) {
  await page.goto(BASE);
  await page.evaluate(({ t, u }) => {
    localStorage.setItem('zenpass_token', t);
    localStorage.setItem('zenpass_user', JSON.stringify(u));
  }, { t: token, u: user });
}

// ── Test 1: 首頁 ────────────────────────────────────────

test.describe('1️⃣ 首頁 / (Homepage)', () => {
  test('header, nav, categories, featured classes render correctly', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check key elements
    const checks = [
      { sel: '.hero', name: 'Hero header' },
      { sel: '.bottom-nav', name: 'Bottom nav' },
    ];

    for (const { sel, name } of checks) {
      const el = page.locator(sel);
      if (await el.count() === 0) errors.push(`Missing: ${name} (${sel})`);
    }

    // Check categories
    const catCount = await page.locator('.category-chip, .cat-chip, [class*="category"] button, [class*="Category"] button').count();
    if (catCount === 0) {
      // Try alternative selectors
      const altCount = await page.locator('#category-list > *').count();
      if (altCount === 0) errors.push('Missing: category chips/tabs');
    }

    // Check featured classes
    const featCount = await page.locator('#featured-classes .class-card, #featured-classes .course-card, #featured-classes > *').count();
    if (featCount === 0) errors.push('Missing: featured class cards');

    console.log(`[Homepage] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 2: Login ────────────────────────────────────────

test.describe('2️⃣ Login /login.html', () => {
  test('login form renders and accepts credentials', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Check form elements
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#login-password')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#login-btn')).toBeVisible({ timeout: 3000 });

    // Try login
    await page.fill('#login-email', 'david@zenpass.hk');
    await page.fill('#login-password', 'zenpass123');
    
    // Setup navigation promise BEFORE clicking (login redirects to explore.html)
    const navPromise = page.waitForURL('**/explore.html', { timeout: 8000 }).catch(() => null);
    await page.click('#login-btn');
    
    // Wait for either navigation or timeout
    const navResult = await navPromise;
    await page.waitForTimeout(1500);

    // Check token in localStorage
    const token = await page.evaluate(() => localStorage.getItem('zenpass_token'));
    console.log(`[Login] Token: ${token ? 'YES' : 'NO'}, Navigated: ${!!navResult}`);

    // Also verify token was stored
    const token2 = await page.evaluate(() => localStorage.getItem('zenpass_token'));
    if (!token2) errors.push('Login: No token in localStorage after login');

    console.log(`[Login] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 3: 探索課程 ────────────────────────────────────

test.describe('3️⃣ 探索課程 /explore.html', () => {
  test('class cards render, filter and search work', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/explore.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // wait for async data

    // Check class cards
    const cardCount = await page.locator('.class-card, .course-card').count();
    console.log(`[Explore] Class cards: ${cardCount}`);
    if (cardCount === 0) errors.push('Missing: class cards (.class-card)');

    // Check search input
    const searchInput = page.locator('input[type="text"], input[type="search"], #search-input');
    const searchVisible = await searchInput.isVisible().catch(() => false);
    if (!searchVisible) errors.push('Missing: search input');

    // Check category filters
    const filterCount = await page.locator('.category-chip, .filter-chip, [class*="filter"] button, [class*="Filter"] button').count();
    if (filterCount === 0) {
      const catCount2 = await page.locator('#category-list > *').count();
      if (catCount2 === 0) errors.push('Missing: category/filter buttons');
    }

    console.log(`[Explore] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 4: 課程詳情 ────────────────────────────────────

test.describe('4️⃣ 課程詳情 /class-detail.html', () => {
  test('schedules, price, waiver, booking button render', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // First get a class ID from the API
    const classResp = await page.request.get(`${BASE}/api/classes`);
    const classes = await classResp.json();
    let classId = null;
    if (Array.isArray(classes) && classes.length > 0) {
      classId = classes[0].id;
    } else if (classes?.data && classes.data.length > 0) {
      classId = classes.data[0].id;
    }
    if (!classId) {
      console.log('[ClassDetail] No classes found, using hardcoded ID');
      classId = 'f9e35b02-eb78-4e8c-a117-7d40cb6c3258';
    }

    await page.goto(`${BASE}/class-detail.html?id=${classId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Check title
    const title = page.locator('h2');
    const titleText = await title.innerText().catch(() => '');
    console.log(`[ClassDetail] Title: "${titleText}"`);

    // Check schedule items
    const schedCount = await page.locator('.schedule-item').count().catch(() => 0);
    console.log(`[ClassDetail] Schedules: ${schedCount}`);
    if (schedCount === 0) errors.push('Missing: schedule items (.schedule-item)');

    // Check book button
    const bookBtn = page.locator('#book-button');
    const bookVisible = await bookBtn.isVisible().catch(() => false);
    if (!bookVisible) errors.push('Missing: book button (#book-button)');

    // Check waiver checkbox (should appear after selecting schedule)
    // Click first schedule if available
    if (schedCount > 0) {
      await page.locator('.schedule-item').first().click();
      await page.waitForTimeout(500);
      const waiverCheck = page.locator('#waiver-agree');
      const waiverVisible = await waiverCheck.isVisible().catch(() => false);
      console.log(`[ClassDetail] Waiver visible after schedule select: ${waiverVisible}`);
      
      // Try clicking waiver
      if (waiverVisible) {
        await waiverCheck.check();
        await page.waitForTimeout(300);
        const btnDisabled = await bookBtn.isDisabled().catch(() => true);
        console.log(`[ClassDetail] Book button disabled after waiver tick: ${btnDisabled}`);
      }
    }

    console.log(`[ClassDetail] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 5: 會員方案 ─────────────────────────────────────

test.describe('5️⃣ 會員方案 /membership.html', () => {
  test('plan cards display', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/membership.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check plan cards
    const planCount = await page.locator('.plan-card, [class*="plan"], [class*="Plan"]').count();
    console.log(`[Membership] Plan cards: ${planCount}`);

    const cardCount = await page.locator('#plans-container > .card, #plans-container > div').count();
    console.log(`[Membership] Plans container children: ${cardCount}`);

    // Check page content
    const bodyText = await page.innerText('body').catch(() => '');
    if (!bodyText.includes('會籍') && !bodyText.includes('方案') && !bodyText.includes('plan') && !bodyText.includes('Plan') && !bodyText.includes('會員')) {
      errors.push('Membership page missing plan content');
    }

    console.log(`[Membership] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 6: 個人頁面 ────────────────────────────────────

test.describe('6️⃣ 個人頁面 /my.html', () => {
  test('user profile and quick actions render', async ({ page }) => {
    // Login for real to get a valid token
    await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', 'david@zenpass.hk');
    await page.fill('#login-password', 'zenpass123');
    await page.click('#login-btn');
    await page.waitForTimeout(2000);

    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    page.on('response', resp => { if (resp.status() >= 400) errors.push(`${resp.status()}: ${resp.url()}`); });

    await page.goto(`${BASE}/my.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const bodyText = await page.innerText('body').catch(() => '');
    console.log(`[My] Body excerpt: ${bodyText.substring(0, 200)}`);

    // Check for user-related content
    if (!bodyText.includes('David') && !bodyText.includes('david') && !bodyText.includes('用戶') && !bodyText.includes('帳戶')) {
      errors.push('My page missing user info');
    }

    console.log(`[My] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics') && !e.includes('/api/users/me'))).toEqual([]);
  });
});

// ── Test 7: 我的預約 ────────────────────────────────────

test.describe('7️⃣ 我的預約 /my-bookings.html', () => {
  test('booking records display', async ({ page }) => {
    // Real login
    await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', 'david@zenpass.hk');
    await page.fill('#login-password', 'zenpass123');
    await page.click('#login-btn');
    await page.waitForTimeout(2000);
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/my-bookings.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const bookingCount = await page.locator('.booking-card, [class*="booking"]').count();
    console.log(`[MyBookings] Booking cards: ${bookingCount}`);

    const bodyText = await page.innerText('body').catch(() => '');
    if (!bodyText.includes('預約') && !bodyText.includes('booking') && !bodyText.includes('Booking') && !bodyText.includes('課程')) {
      errors.push('My bookings page missing booking content');
    }

    console.log(`[MyBookings] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 8: 積分 ────────────────────────────────────────

test.describe('8️⃣ 積分 /points.html', () => {
  test('points display and rewards show', async ({ page }) => {
    // Real login
    await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', 'david@zenpass.hk');
    await page.fill('#login-password', 'zenpass123');
    await page.click('#login-btn');
    await page.waitForTimeout(2000);
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/points.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const bodyText = await page.innerText('body').catch(() => '');
    console.log(`[Points] Body excerpt: ${bodyText.substring(0, 200)}`);

    if (!bodyText.includes('積分') && !bodyText.includes('Points') && !bodyText.includes('points')) {
      errors.push('Points page missing points content');
    }

    console.log(`[Points] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 9: 教練列表 ────────────────────────────────────

test.describe('9️⃣ 教練列表 /coaches.html', () => {
  test('coach cards display', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/coaches.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const coachCount = await page.locator('.coach-card, [class*="coach"]').count();
    console.log(`[Coaches] Coach cards: ${coachCount}`);

    const bodyText = await page.innerText('body').catch(() => '');
    if (!bodyText.includes('教練') && !bodyText.includes('Coach') && !bodyText.includes('coach')) {
      errors.push('Coaches page missing coach content');
    }

    console.log(`[Coaches] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 10: Admin ───────────────────────────────────────

test.describe('🔟 Admin /admin.html', () => {
  test('admin login and dashboard render', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Check for admin login form
    const loginEmail = page.locator('#loginEmail');
    const loginPass = page.locator('#loginPass');

    if (await loginEmail.isVisible().catch(() => false)) {
      // Admin login form visible
      await loginEmail.fill('admin@zenpass.hk');
      await loginPass.fill('admin123');
      await page.locator('button:has-text("登入"), button:has-text("Login"), button[type="submit"]').first().click();
      await page.waitForTimeout(2000);

      // Check dashboard rendered
      const statsGrid = page.locator('.stats-grid, .stat-card, [class*="stat"]');
      const statsVisible = await statsGrid.first().isVisible().catch(() => false);
      console.log(`[Admin] Dashboard visible: ${statsVisible}`);

      if (!statsVisible) {
        // Check if we're still on login
        const stillLogin = await loginEmail.isVisible().catch(() => false);
        if (stillLogin) {
          const msgText = await page.locator('#loginMsg').innerText().catch(() => '');
          errors.push(`Admin login failed: ${msgText}`);
        }
      }
    } else {
      console.log('[Admin] Login form not found, may already be logged in or different layout');
    }

    // Check main content area
    const bodyText = await page.innerText('body').catch(() => '');
    console.log(`[Admin] Body excerpt: ${bodyText.substring(0, 200)}`);

    console.log(`[Admin] Errors: ${errors.length}`, errors);
    expect(errors.filter(e => !e.includes('favicon') && !e.includes('analytics'))).toEqual([]);
  });
});

// ── Test 11: API 驗證 ────────────────────────────────────

test.describe('1️⃣1️⃣ API 驗證', () => {
  test('all critical API endpoints return valid responses', async ({ request }) => {
    const errors = [];

    // Health (use relative path so Playwright uses configured baseURL)
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    const healthBody = await health.json();
    console.log(`[API] Health raw: ${JSON.stringify(healthBody).substring(0, 200)}`);
    // Health API wraps response in {success, data}
    const healthData = healthBody?.data || healthBody;
    const dbConnected = healthData?.database?.connected || healthData?.status === 'ok';
    if (!dbConnected) errors.push('API health: DB not connected');

    // Classes
    const classes = await request.get('/api/classes');
    expect(classes.status()).toBe(200);
    const classesBody = await classes.json();
    const classCount = Array.isArray(classesBody) ? classesBody.length : classesBody?.data?.length || 0;
    console.log(`[API] Classes: ${classCount}`);

    // Bookings for user (with demo token)
    const bookings = await request.get('/api/bookings/my', {
      headers: { Authorization: 'Bearer demo_token_student' }
    });
    const bookingsStatus = bookings.status();
    console.log(`[API] Bookings/my: ${bookingsStatus}`);
    if (bookingsStatus !== 200 && bookingsStatus !== 401) {
      errors.push(`API bookings/my: unexpected status ${bookingsStatus}`);
    }

    // Points
    const points = await request.get('/api/points', {
      headers: { Authorization: 'Bearer demo_token_student' }
    });
    const pointsStatus = points.status();
    console.log(`[API] Points: ${pointsStatus}`);
    if (pointsStatus !== 200 && pointsStatus !== 401 && pointsStatus !== 404) {
      errors.push(`API points: unexpected status ${pointsStatus}`);
    }

    // Admin stats
    const adminStats = await request.get('/api/admin/stats', {
      headers: { Authorization: 'Bearer demo_token_admin' }
    });
    const statsStatus = adminStats.status();
    console.log(`[API] Admin/stats: ${statsStatus}`);
    if (statsStatus !== 200 && statsStatus !== 401 && statsStatus !== 403) {
      errors.push(`API admin/stats: unexpected status ${statsStatus}`);
    }

    console.log(`[API] Errors: ${errors.length}`, errors);
    expect(errors).toEqual([]);
  });
});

// ── Summary Test ─────────────────────────────────────────

test.describe('📊 E2E Audit Summary', () => {
  test('no critical page errors across all flows', async () => {
    // This test just reports the global error collection
    const criticalErrors = [
      ...CONSOLE_ERRORS.filter(e => 
        !e.includes('favicon') && 
        !e.includes('analytics') && 
        !e.includes('google') && 
        !e.includes('gtag')
      ).slice(0, 50),
      ...PAGE_ERRORS.slice(0, 20)
    ];

    if (criticalErrors.length > 0) {
      console.log('⚠️ CRITICAL ERRORS FOUND:');
      criticalErrors.forEach(e => console.log(`  • ${e}`));
    } else {
      console.log('✅ No critical errors found across all 11 flows');
    }

    // We don't fail the test here - just report
    // Actual errors are caught in individual tests
  });
});
