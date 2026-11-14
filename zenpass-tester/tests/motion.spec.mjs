/**
 * motion.spec.mjs — Phase 7.1-Motion 回歸測試
 *
 * 驗證 assets/zenpass-motion.css + assets/motion-controller.js：
 *   - Bottom Sheet 開／關、背景鎖滾動、ESC 關閉、焦點還原
 *   - 成功打勾 SVG（零 Tailwind 依賴）
 *   - 席位倒數進度條（scaleX，不是 width）
 *   - prefers-reduced-motion 熔斷
 *   - 樂齡無動態模式（data-senior-calm）持久化
 *
 * 跑法：node zenpass-tester/tests/motion.spec.mjs
 * 不需要開 server：用 setContent + addStyleTag 直接注入本機檔案。
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../frontend-v2");
const CSS = path.join(ROOT, "assets/zenpass-motion.css");
const JS = path.join(ROOT, "assets/motion-controller.js");

const MARKUP = `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"></head><body>
<div id="success"></div>
<span id="holdTxt">--:--</span>
<div class="zp-hold-track"><div class="zp-hold-bar" id="holdBar"></div></div>
<div class="zp-sheet-backdrop hidden" id="sh" aria-hidden="true">
  <div class="zp-sheet-panel" role="dialog" aria-modal="true">
    <div class="zp-sheet-handle"></div><button id="shClose">關閉</button><p>測試抽屜</p>
  </div>
</div>
</body></html>`;

const results = [];
const ok = (name, cond) => results.push({ name, pass: !!cond });

async function newPage(browser, reducedMotion) {
  const page = await browser.newPage();
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  // 用 route 攔截提供真實 origin（about:blank 係 opaque origin，localStorage 會被封）
  await page.route("http://zenpass.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: MARKUP }));
  await page.goto("http://zenpass.test/motion-test");
  await page.addStyleTag({ path: CSS });
  await page.addScriptTag({ path: JS });
  await page.waitForFunction(() => !!window.ZenPassMotion);
  return page;
}

const browser = await chromium.launch();

/* ---------- 1. 正常動效 ---------- */
const p = await newPage(browser);
ok("API 齊全", await p.evaluate(() =>
  ["openSheet", "closeSheet", "toggleSheet", "mountSuccessCheckSVG", "bindHoldTimerBar", "isReducedMotion", "setSeniorCalm"]
    .every((k) => typeof window.ZenPassMotion[k] === "function")));

await p.evaluate(() => window.ZenPassMotion.openSheet("#sh"));
await p.waitForTimeout(450);
ok("抽屜開啟 is-open", await p.evaluate(() => document.querySelector("#sh").classList.contains("is-open")));
ok("背景鎖滾動", await p.evaluate(() => document.body.style.position === "fixed"));
ok("panel 上移到 0", await p.evaluate(() => {
  const t = getComputedStyle(document.querySelector(".zp-sheet-panel")).transform;
  return t === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t);
}));
ok("aria-hidden=false", await p.evaluate(() => document.querySelector("#sh").getAttribute("aria-hidden") === "false"));

await p.evaluate(() => window.ZenPassMotion.closeSheet("#sh"));
await p.waitForTimeout(350);
ok("抽屜關閉 hidden", await p.evaluate(() => document.querySelector("#sh").classList.contains("hidden")));
ok("解鎖滾動", await p.evaluate(() => document.body.style.position === ""));
ok("焦點還原至 body", await p.evaluate(() => document.activeElement === document.body || document.activeElement === null));

await p.evaluate(() => window.ZenPassMotion.openSheet("#sh"));
await p.waitForTimeout(350);
await p.keyboard.press("Escape");
await p.waitForTimeout(350);
ok("ESC 關閉", await p.evaluate(() => document.querySelector("#sh").classList.contains("hidden")));

ok("mountSuccessCheckSVG 回傳 true", await p.evaluate(() => window.ZenPassMotion.mountSuccessCheckSVG("#success")));
ok("SVG 描邊 path 存在", await p.evaluate(() => !!document.querySelector("#success .zp-success-check-path")));
ok("無 Tailwind 殘留", await p.evaluate(() => !document.querySelector("#success").innerHTML.includes("bg-emerald")));

await p.evaluate(() => window.ZenPassMotion.bindHoldTimerBar("#holdTxt", "#holdBar", 5));
await p.waitForTimeout(1200);
const t1 = await p.evaluate(() => document.querySelector("#holdTxt").textContent);
const s1 = await p.evaluate(() => document.querySelector("#holdBar").style.transform);
ok("倒數文字更新 (" + t1 + ")", /^00:0[0-4]$/.test(t1));
ok("進度條用 scaleX 非 width (" + s1 + ")", /scaleX\(0\.\d+\)/.test(s1));
ok("進度條冇改 width", await p.evaluate(() => {
  const el = document.querySelector("#holdBar");
  return el.style.width === "" || el.style.width === "100%";
}));

/* ---------- 2. prefers-reduced-motion ---------- */
const p2 = await newPage(browser, true);
ok("reduced-motion 偵測", await p2.evaluate(() => window.ZenPassMotion.isReducedMotion()));
await p2.evaluate(() => window.ZenPassMotion.openSheet("#sh"));
await p2.evaluate(() => window.ZenPassMotion.closeSheet("#sh"));
await p2.waitForTimeout(30);
ok("reduced: 即時關閉無動畫", await p2.evaluate(() => document.querySelector("#sh").classList.contains("hidden")));
ok("reduced: panel transform none", await p2.evaluate(() =>
  getComputedStyle(document.querySelector(".zp-sheet-panel")).transform === "none"));

/* ---------- 3. 樂齡無動態 ---------- */
const p3 = await newPage(browser);
await p3.evaluate(() => window.ZenPassMotion.setSeniorCalm(true));
ok("senior-calm 屬性寫入", await p3.evaluate(() => document.documentElement.getAttribute("data-senior-calm") === "1"));
ok("senior-calm localStorage", await p3.evaluate(() => localStorage.getItem("zp_senior_calm") === "1"));
await p3.evaluate(() => window.ZenPassMotion.setSeniorCalm(false));
ok("senior-calm 可關閉", await p3.evaluate(() => document.documentElement.getAttribute("data-senior-calm") === "0"));

await browser.close();

/* ---------- 報告 ---------- */
for (const r of results) console.log((r.pass ? "✅" : "❌") + " " + r.name);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
