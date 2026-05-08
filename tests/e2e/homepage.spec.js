// ZenPass E2E: 首頁
import { test, expect } from "@playwright/test";

test("首頁載入正常", async ({ page }) => {
  const resp = await page.goto("/");
  expect(resp.status()).toBeLessThan(400);
  await expect(page.locator("body")).not.toBeEmpty();
});

test("課程頁載入", async ({ page }) => {
  await page.goto("/courses.html");
  await expect(page.locator("body")).not.toBeEmpty();
});

test("行動版課程頁", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/courses.html");
  await expect(page.locator("body")).not.toBeEmpty();
});
