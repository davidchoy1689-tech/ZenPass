/**
 * sandbox-booking.js — 沙盒全流程驗收（免註冊訪客，FPS 待核實）
 *
 * 目的：唔需要真人、唔需要碰生產 DB，跑一次完整落單流程。
 *
 * 起沙盒（另一個 port + DB 副本）：
 *   mkdir -p /tmp/zp-sandbox
 *   cp backend/data/zenpass.db /tmp/zp-sandbox/zenpass.db
 *   PORT=3011 DB_PATH=/tmp/zp-sandbox/zenpass.db node backend/src/index.js
 *
 * 跑測試：
 *   node zenpass-tester/scripts/sandbox-booking.js
 *   ZP_SANDBOX_BASE=http://localhost:3011 ZP_CLASS_ID=<id> node ...
 *
 * 驗證：Step1 → Step2 免註冊 → Step3 港幣價 → FPS 提交 → 成功頁 + 打勾 API
 * 清理：kill 沙盒進程，rm -rf /tmp/zp-sandbox
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.ZP_SANDBOX_BASE || "http://localhost:3011";
const CID = process.env.ZP_CLASS_ID || "0028eeb3-9926-4fa8-ad67-2fafd3eb7c52";
const PHONE = "5" + String(Math.floor(Math.random() * 9000000) + 1000000);

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
  const dialogs = [];
  p.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));

  await p.goto(`${BASE}/booking.html?id=${CID}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  ok("沙盒載入預約頁", await p.evaluate(() => !document.getElementById("step1").classList.contains("hide")));

  await p.click("#barNext");
  await p.waitForTimeout(600);
  ok("Step2 免註冊表單出現", await p.evaluate(() => document.getElementById("guestBox").offsetHeight > 0));
  ok("Step2 訪客無 Credits 付款卡", await p.evaluate(() => {
    const el = document.querySelector('[data-pm-card="credits"]');
    return !el || getComputedStyle(el).display === "none";
  }));

  await p.fill("#gName", "沙盒測試");
  await p.fill("#gPhone", PHONE);
  await p.check("#waiverAgree").catch(() => {});
  await p.check("#consent").catch(() => {});
  await p.click("#toStep3");
  await p.waitForTimeout(900);
  ok("Step3 出現", await p.evaluate(() => !document.getElementById("step3").classList.contains("hide")));

  const payTxt = await p.evaluate(() => document.getElementById("payNow").textContent.trim());
  ok("付款鍵只顯示港幣", /HK\$/.test(payTxt) && !/cr/i.test(payTxt), payTxt);

  await p.click("#payNow");
  await p.waitForTimeout(3000);
  ok("FPS 面板出現", await p.evaluate(() => !!document.querySelector("#payPanels")));

  await p.fill("#payRef", "SBX" + Date.now());
  await p.click("#paySubmit");
  await p.waitForTimeout(4000);

  const done = await p.evaluate(() => ({
    visible: !document.getElementById("done").classList.contains("hide"),
    title: (document.getElementById("doneTitle") || {}).textContent,
    body: document.getElementById("done").innerText.slice(0, 160).replace(/\n+/g, " | "),
  }));
  ok("成功頁顯示", done.visible, done.title);
  ok("FPS 待核实用 ⏳ 圖示（非打勾）", await p.evaluate(() =>
    document.getElementById("doneIcon").textContent.trim() === "⏳"));
  ok("打勾描邊 API 420ms 可用", await p.evaluate(() => {
    window.ZenPassMotion.mountSuccessCheckSVG("#doneIcon");
    const x = document.querySelector("#doneIcon .zp-success-check-path");
    return !!x && getComputedStyle(x).animationDuration === "0.42s";
  }));

  console.log("   成功頁: " + done.body);
  console.log("   彈窗: " + (dialogs.length ? dialogs.join(" / ") : "無"));
  console.log("   JS 錯誤: " + (errs.length ? errs[0] : "無"));
  ok("全程零 JS 錯誤", errs.length === 0, errs[0] || "");

  const shotDir = "qa-screenshots-t6";
  fs.mkdirSync(shotDir, { recursive: true });
  await p.screenshot({ path: `${shotDir}/sandbox-success.png`, fullPage: true });

  await b.close();

  const fails = out.filter((x) => x.startsWith("FAIL")).length;
  console.log(`\n${out.length - fails}/${out.length} 通過 · 測試電話 ${PHONE}`);
  process.exit(fails ? 1 : 0);
})();
