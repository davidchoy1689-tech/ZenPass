/**
 * e2e-guest-funnel-check.js — T6 真機回歸（客路漏斗）
 *
 * 用法：node zenpass-tester/scripts/e2e-guest-funnel-check.js
 * 前提：本機後端 + 靜態站已起（預設 http://localhost:3001）
 *
 * 檢查項：
 *   T1 未登入訪客可由探索頁直入課程／預約，不會被踢去 login.html
 *   T2 booking.html 有「快速預約（免註冊）」表單
 *   T3 時間以香港時區顯示（用 America/New_York 時區模擬，證明無 02:30 偏移）
 *   T4 通行卡價格單一真相 HK$520，無 $480 / $560 殘留
 *   T5 訪客模式隱藏 Credits（cr）付款選項
 *
 * 截圖：qa-screenshots-t6/
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.ZP_BASE || "http://localhost:3001";
const CLASS_ID = process.env.ZP_CLASS_ID || "0028eeb3-9926-4fa8-ad67-2fafd3eb7c52";
const OUT = path.resolve("qa-screenshots-t6");
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? "✅" : "❌") + " " + name + (detail ? " — " + detail : ""));
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 故意用紐約時區：若任何頁面用裝置本地時間，就會露餡
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/New_York",
    locale: "zh-HK",
  });
  const page = await context.newPage();

  /* ---------- 1. 探索頁（訪客） ---------- */
  await page.goto(BASE + "/explore.html", { waitUntil: "networkidle" });
  const exploreText = await page.textContent("body");
  await page.screenshot({ path: path.join(OUT, "01-explore-guest.png") });

  ok("T3 探索頁無 02:30 偏移", !exploreText.includes("02:30"),
    exploreText.includes("02:30") ? "偵測到 02:30" : "無偏移");
  ok("T5 探索頁訪客無 cr 價格標籤", !/\d+\s*cr\s*\/\s*HK\$/i.test(exploreText),
    (exploreText.match(/\d+\s*cr\s*\/\s*HK\$/i) || [""])[0]);

  /* ---------- 2. T1：由探索頁進入，不得跳 login ---------- */
  const firstLink = page.locator('a[href*="detail.html"]').first();
  if (await firstLink.count()) {
    await firstLink.click();
    await page.waitForLoadState("networkidle");
  } else {
    await page.goto(BASE + "/detail.html?id=" + CLASS_ID, { waitUntil: "networkidle" });
  }
  ok("T1 未被踢去 login.html", !page.url().includes("login.html"), page.url().replace(BASE, ""));
  ok("T1 已進入課程頁", page.url().includes("detail.html"), page.url().replace(BASE, ""));

  /* ---------- 3. T3：課程頁時間必須是香港時間 ---------- */
  await page.waitForTimeout(1200);
  const detailText = await page.textContent("body");
  await page.screenshot({ path: path.join(OUT, "02-detail-hkt.png") });
  ok("T3 課程頁無 02:30", !detailText.includes("02:30"));
  // 04:00Z 應顯示 12:00 HKT（若用了裝置時區會變 23:00 或 22:00）
  const hasHkt12 = /12:00/.test(detailText);
  ok("T3 04:00Z 顯示為 12:00 HKT", hasHkt12, hasHkt12 ? "" : "未找到 12:00");

  /* ---------- 4. T2 / T5：預約頁免註冊 ---------- */
  await page.goto(BASE + "/booking.html?id=" + CLASS_ID, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "03-booking-guest.png"), fullPage: true });

  const guestBox = page.locator("#guestBox");
  // 免註冊表單在 Step 2，需要先按「下一步」
  const nextBtn = page.locator('button:has-text("下一步")').first();
  if (await nextBtn.count()) {
    await nextBtn.click();
    await page.waitForTimeout(700);
  }
  const guestVisible = (await guestBox.count()) > 0 && (await guestBox.isVisible());
  ok("T2 快速預約（免註冊）表單可見", guestVisible);

  const creditsCardVisible = await page.evaluate(() => {
    const el = document.querySelector('[data-pm-card="credits"]');
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  });
  ok("T5 訪客隱藏 Credits 付款卡", !creditsCardVisible);

  const payBtnText = await page.evaluate(() => {
    const b = document.getElementById("payNow");
    return b ? b.textContent.trim() : "";
  });
  ok("T5 付款按鈕只顯示 HK$", /HK\$/.test(payBtnText) && !/cr/i.test(payBtnText), payBtnText || "(找不到按鈕)");

  /* ---------- 5. T4：通行卡價格 ---------- */
  await page.goto(BASE + "/pass.html", { waitUntil: "networkidle" });
  const passText = await page.textContent("body");
  await page.screenshot({ path: path.join(OUT, "04-pass-520.png") });
  ok("T4 通行卡 HK$520", passText.includes("520"));
  ok("T4 無 $480 殘留", !/\$480|HK\$480/.test(passText));
  ok("T4 無 $560 殘留", !/\$560|HK\$560/.test(passText));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通過");
  console.log("截圖：" + OUT);
  process.exit(failed.length ? 1 : 0);
})();
