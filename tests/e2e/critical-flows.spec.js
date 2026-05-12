import { test, expect } from '@playwright/test';

test.describe('Navigation Flow', () => {
  test('homepage has categories and courses', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const cats = await page.locator('.category-chip').count();
    expect(cats).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Login Flow', () => {
  test('login page has form elements', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
  });
});

test.describe('Class Detail', () => {
  test('has book button and schedules', async ({ page }) => {
    await page.goto('/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258');
    await page.waitForTimeout(2000);
    await expect(page.locator('#book-button')).toBeVisible();
    const scheds = await page.locator('.schedule-item').count();
    expect(scheds).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Static Pages', () => {
  const pages = [['/', 'Home'], ['/courses.html', 'Courses'], ['/login.html', 'Login'], ['/faq.html', 'FAQ']];
  for (const [path, name] of pages) {
    test(`${name} loads`, async ({ page }) => {
      const resp = await page.goto(path);
      expect(resp?.status()).toBe(200);
    });
  }
});

test.describe('Auth Pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('zenpass_token', 'demo_token_student');
      localStorage.setItem('zenpass_user', JSON.stringify({ name: 'Test', email: 'test@test.com', role: 'student' }));
    });
  });

  test('my bookings shows data', async ({ page }) => {
    await page.goto('/my-bookings.html');
    await page.waitForTimeout(3000);
    const count = await page.locator('.booking-card').count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('points page loads', async ({ page }) => {
    await page.goto('/points.html');
    await page.waitForTimeout(2000);
    const text = await page.innerText('body');
    expect(text).toContain('積分');
  });
});
