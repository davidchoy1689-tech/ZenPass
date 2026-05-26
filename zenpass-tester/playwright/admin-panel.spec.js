// @ts-check
const { test, expect } = require("@playwright/test");

const BASE =
  process.env.BASE_URL || process.env.API_URL || "http://localhost:3001";
const API = process.env.API_URL || "http://localhost:3001";
const ADMIN = { email: "admin@zenpass.hk", password: "admin123" };

test.describe("Admin Panel", () => {
  test("管理後台載入 — 頁面正確渲染", async ({ page }) => {
    await page.goto(`${BASE}/admin/index.html`);
    await page.waitForLoadState("networkidle");

    // 頁面有內容
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(10);
  });

  test("API: Admin stats 包含所有預期欄位", async ({ page }) => {
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    const { token } = await loginRes.json();

    const res = await page.request.get(`${API}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const { stats } = await res.json();

    expect(stats).toHaveProperty("total_users");
    expect(stats).toHaveProperty("total_bookings");
    expect(stats).toHaveProperty("confirmed_bookings");
    expect(stats).toHaveProperty("total_revenue");
    expect(stats.total_users).toBeGreaterThan(0);
    expect(stats.total_revenue).toBeGreaterThan(0);
  });

  test("API: User CRUD — 列出用戶", async ({ page }) => {
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    const { token } = await loginRes.json();

    const res = await page.request.get(`${API}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const users = data.users || data;
    expect(users.length).toBeGreaterThan(5);

    // Check user references
    for (const u of users) {
      expect(u.user_reference).toMatch(/^US-/);
    }
  });

  test("API: Booking list 包含參考編號", async ({ page }) => {
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    const { token } = await loginRes.json();

    const res = await page.request.get(`${API}/api/admin/bookings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const bookings = data.bookings || data;

    for (const b of bookings) {
      expect(b.booking_reference).toMatch(/^ZP-/);
    }
  });

  test("API: Payment status 邏輯一致", async ({ page }) => {
    const loginRes = await page.request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    const { token } = await loginRes.json();

    const res = await page.request.get(`${API}/api/admin/bookings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const bookings = data.bookings || data;

    for (const b of bookings) {
      if (b.status === "confirmed") {
        expect(b.payment_status).toBe("paid");
      }
      if (b.payment_status === "paid") {
        expect(b.status).toBe("confirmed");
      }
    }
  });

  test("API: Auth security — 無 token 返回 401", async ({ page }) => {
    const res = await page.request.get(`${API}/api/admin/stats`);
    expect(res.status()).toBe(401);
  });
});
