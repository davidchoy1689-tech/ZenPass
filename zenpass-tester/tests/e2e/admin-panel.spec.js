// ZenPass E2E: Admin Panel + Booking Flow
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const API = process.env.API_URL || "http://localhost:3001";

test.describe("Admin Panel", () => {
  let token;

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post(API + "/api/auth/login", {
      data: { email: "admin@zenpass.hk", password: "admin123" },
    });
    const body = await loginRes.json();
    token = body.token;
  });

  test("admin page loads", async ({ page }) => {
    await page.goto(BASE + "/admin.html");
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(10);
  });

  test("API stats has expected fields", async ({ request }) => {
    const res = await request.get(API + "/api/admin/stats", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    const stats = json.stats;
    expect(stats).toHaveProperty("total_users");
    expect(stats).toHaveProperty("total_bookings");
    expect(stats).toHaveProperty("confirmed_bookings");
    expect(stats).toHaveProperty("total_revenue");
    expect(stats.total_users).toBeGreaterThan(0);
  });

  test("API users have US- reference", async ({ request }) => {
    const res = await request.get(API + "/api/admin/users", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const users = data.users || data;
    expect(users.length).toBeGreaterThan(5);
    for (const u of users) {
      expect(u.user_reference).toMatch(/^US-/);
    }
  });

  test("API bookings have ZP- reference", async ({ request }) => {
    const res = await request.get(API + "/api/admin/bookings", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const bookings = data.bookings || data;
    for (const b of bookings) {
      expect(b.booking_reference).toMatch(/^ZP-/);
    }
  });

  test("API no token returns 401", async ({ request }) => {
    const res = await request.get(API + "/api/admin/stats");
    expect(res.status()).toBe(401);
  });

  test("API pending payments endpoint works", async ({ request }) => {
    const res = await request.get(API + "/api/admin/pending-payments", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.ok()).toBeTruthy();
  });
});

test.describe("Booking Flow", () => {
  test("homepage loads with content", async ({ page }) => {
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test("courses page has filter buttons", async ({ page }) => {
    await page.goto(BASE + "/courses.html");
    await page.waitForLoadState("networkidle");
    const buttons = page.locator(
      "button, .category-btn, .filter-btn, .nav-item",
    );
    await expect(buttons.first()).toBeVisible();
  });

  test("mobile courses page loads", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE + "/courses.html");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("login page has form inputs", async ({ page }) => {
    await page.goto(BASE + "/login.html");
    await page.waitForLoadState("networkidle");
    const inputs = page.locator(
      'input[type="email"], input[name="email"], input[type="password"], input[name="password"]',
    );
    await expect(inputs.first()).toBeVisible();
  });

  test("explore page loads", async ({ page }) => {
    await page.goto(BASE + "/explore.html");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("membership page loads", async ({ page }) => {
    await page.goto(BASE + "/membership.html");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
