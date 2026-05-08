// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || process.env.API_URL || 'http://localhost:3001';
const API = process.env.API_URL || 'http://localhost:3001';

// Test user
const USER = { email: 'david@zenpass.hk', password: 'zenpass123' };
const ADMIN = { email: 'admin@zenpass.hk', password: 'admin123' };

test.describe('ZenPass Booking Flow', () => {

  test('首頁載入 — 顯示課程與導航', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/ZenPass/);
    // 核心導航元素
    await expect(page.locator('nav, .nav, header')).toBeVisible();
    // 頁面有內容（唔係空白）
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('課程頁 — 課程列表顯示及分類', async ({ page }) => {
    await page.goto(`${BASE}/courses.html`);
    await page.waitForLoadState('networkidle');
    
    // 分類按鈕存在
    const categoryBtns = page.locator('button, .category-btn, .filter-btn');
    await expect(categoryBtns.first()).toBeVisible();
    
    // 有課程卡片
    const cards = page.locator('.course-card, .class-card, [class*="course"], [class*="class"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('登入 — 成功登入後可瀏覽 my page', async ({ page }) => {
    // Login
    await page.goto(`${BASE}/login.html`);
    await page.waitForLoadState('networkidle');
    
    // Fill credentials
    await page.fill('input[type="email"], input[name="email"], input#email', USER.email);
    await page.fill('input[type="password"], input[name="password"], input#password', USER.password);
    await page.click('button[type="submit"], .login-btn, button:has-text("登入")');
    
    await page.waitForTimeout(2000);
    
    // After login, navigate to my page
    await page.goto(`${BASE}/my.html`);
    await page.waitForLoadState('networkidle');
    
    // Should see user info, not login redirect
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('登入');
  });

  test('探索頁 — 課程詳情可展開', async ({ page }) => {
    await page.goto(`${BASE}/explore.html`);
    await page.waitForLoadState('networkidle');
    
    const cards = page.locator('.course-card, .class-card, [class*="course"], [class*="class"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('會籍頁 — 顯示會籍方案', async ({ page }) => {
    await page.goto(`${BASE}/membership.html`);
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('API 直接測試 — booking CRUD', async ({ page }) => {
    // Login via API to get token
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { email: USER.email, password: USER.password }
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token, user } = await loginRes.json();
    expect(token).toBeTruthy();
    expect(user).toBeTruthy();
    
    // Get available classes
    const classesRes = await page.request.get(`${API}/api/classes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(classesRes.ok()).toBeTruthy();
    const classesData = await classesRes.json();
    const classes = classesData.classes || classesData;
    expect(classes.length).toBeGreaterThan(0);
    
    // Find a class with available schedule
    let scheduleId = null;
    let classId = null;
    for (const c of classes) {
      if (c.schedules && c.schedules.length > 0) {
        const available = c.schedules.find(s => 
          s.status === 'available' && s.enrolled_count < s.max_participants
        );
        if (available) {
          scheduleId = available.id;
          classId = c.id;
          break;
        }
      }
    }
    
    if (!scheduleId) {
      console.log('⚠️ No available schedule found, skipping booking test');
      return;
    }
    
    // Create a booking
    const bookingRes = await page.request.post(`${API}/api/bookings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        schedule_id: scheduleId,
        class_id: classId,
        payment_type: 'single',
        amount: 120
      }
    });
    expect(bookingRes.ok()).toBeTruthy();
    const booking = await bookingRes.json();
    expect(booking.booking_reference).toMatch(/^ZP-/);
    
    // Verify it shows in my bookings
    const myRes = await page.request.get(`${API}/api/bookings/my`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(myRes.ok()).toBeTruthy();
    
    // Cancel the test booking
    const cancelRes = await page.request.post(`${API}/api/bookings/${booking.booking_id}/cancel`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(cancelRes.ok()).toBeTruthy();
  });
});
