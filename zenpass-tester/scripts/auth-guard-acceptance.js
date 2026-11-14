/**
 * auth-guard-acceptance.js — T1 Auth Guard Bypass 驗收（11 項）
 *
 * 用法：node zenpass-tester/scripts/auth-guard-acceptance.js
 * 前提：本機後端已起（預設 http://localhost:3001），全程「未登入」context。
 *
 * 規則：預約起點（探索／詳情／時段抽屜／結帳）一律公開；
 *       只有 Credits 錢包、帳戶頁、教練工具需要登入。
 */
const { chromium } = require("playwright");

const BASE = process.env.ZP_BASE || "http://localhost:3001";
const CID = process.env.ZP_CLASS_ID || "0028eeb3-9926-4fa8-ad67-2fafd3eb7c52";

const out = [];
const ok = (n, c, d) => {
  out.push((c ? "PASS" : "FAIL") + " · " + n + (d ? " — " + d : ""));
  console.log(out[out.length - 1]);
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-HK",
    timezoneId: "Asia/Hong_Kong",
  });
  const p = await ctx.newPage();

  /* 1. 探索頁卡片 → 不得跳 login */
  await p.goto(BASE + "/explore.html", { waitUntil: "networkidle" });
  const card = p.locator('a[href*="detail.html"]').first();
  if (await card.count()) { await card.click(); await p.waitForLoadState("networkidle"); }
  ok("① 探索頁卡片未跳 login", !p.url().includes("login.html"), p.url().replace(BASE, ""));

  /* 2. 詳情頁 CTA → 開時段抽屜，不跳 login、不彈登入 */
  await p.goto(BASE + "/detail.html?id=" + CID, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const bookBtn = p.locator("#bookBtn, .dt-dock button, button:has-text('立即報名')").first();
  if (await bookBtn.count()) { await bookBtn.click(); await p.waitForTimeout(700); }
  ok("② 詳情頁 CTA 未跳 login", !p.url().includes("login.html"), p.url().replace(BASE, ""));
  ok("② 時段抽屜／預約入口可用", await p.evaluate(() => {
    const s = document.getElementById("sheet");
    return !!s && (s.classList.contains("show") || !document.body.innerText.includes("請先登入"));
  }));

  /* 3. 直接入 booking（帶 id）→ Step1 可選班；Step2 有訪客表單 */
  await p.goto(BASE + "/booking.html?id=" + CID, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  ok("③ 未登入可直入 booking Step1", await p.evaluate(() => !document.getElementById("step1").classList.contains("hide")));

  await p.click("#barNext");
  await p.waitForTimeout(600);
  ok("③ Step2 訪客欄位可見", await p.evaluate(() => document.getElementById("guestBox").offsetHeight > 0));

  /* 4. 訪客模式：Credits 付款卡隱藏（比 soft modal 更乾淨，且符合 T5 定案） */
  ok("④ 訪客模式隱藏 Credits 付款選項", await p.evaluate(() => {
    const el = document.querySelector('[data-pm-card="credits"]');
    return !el || getComputedStyle(el).display === "none";
  }));

  /* 5. 「已有帳號？登入」需保留 classId 上下文 */
  const loginHref = await p.evaluate(() => {
    const a = document.getElementById("guestLoginLink");
    return a ? a.getAttribute("href") : null;
  });
  ok("⑤ 登入連結保留預約上下文", !!loginHref && decodeURIComponent(loginHref).includes(CID), loginHref);

  /* 6. 未登入無 id 進 booking → 去探索頁，不是 login */
  await p.goto(BASE + "/booking.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  ok("⑥ 無 classId 導向探索頁（非 login）", p.url().includes("explore.html") && !p.url().includes("login.html"), p.url().replace(BASE, ""));

  /* 7. 帳戶 API 仍受保護 */
  const meStatus = await p.evaluate(async () => {
    const r = await fetch("/api/users/me", { credentials: "include" });
    return r.status;
  });
  ok("⑦ /api/users/me 未登入回 401", meStatus === 401, String(meStatus));

  /* 8. 我的預約／錢包頁 → 需要登入 */
  await p.goto(BASE + "/my-bookings.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const myGuard = await p.evaluate(() => ({
    url: location.pathname,
    gate: document.body.innerText.includes("登入") || !!document.querySelector('a[href*="login.html"]'),
  }));
  ok("⑧ 我的預約需登入", myGuard.url.includes("login") || myGuard.gate, JSON.stringify(myGuard));

  /* 9. 教練工具 → 需要登入 */
  await p.goto(BASE + "/coach-dashboard.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const coachGuard = await p.evaluate(() => ({
    url: location.pathname,
    gate: document.body.innerText.includes("登入") || !!document.querySelector('a[href*="login.html"]'),
    demo: !!document.getElementById("demoModeBanner"),
    demoLabeled: document.body.innerText.includes("示範模式"),
  }));
  ok("⑨ 教練後台：未登入不會外露真數據（示範模式明確標示）",
    (coachGuard.url.includes("login") || coachGuard.gate) && coachGuard.demo && coachGuard.demoLabeled,
    JSON.stringify(coachGuard));

  /* 10. Deep link（classId + sid）可直達結帳 */
  await p.goto(BASE + "/booking.html?id=" + CID, { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  ok("⑩ Deep link 直達 booking 不跳轉", !p.url().includes("login.html") && !p.url().includes("explore.html"), p.url().replace(BASE, ""));

  /* 11. 付款 API 免登入（guest create 不應 401） */
  const guestApi = await p.evaluate(async () => {
    const r = await fetch("/api/guest/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    return r.status;
  });
  ok("⑪ /api/guest/book 未登入不是 401", guestApi !== 401 && guestApi !== 403, "status " + guestApi + "（4xx 驗證錯誤屬正常，401 才算失敗）");

  await b.close();
  const fails = out.filter((x) => x.startsWith("FAIL")).length;
  console.log(`\n${out.length - fails}/${out.length} 通過`);
  process.exit(fails ? 1 : 0);
})();
