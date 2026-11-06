/**
 * Coach PWA 掃碼防黑屏（2026-11-06）
 * 現場極端情況：切 App／鎖屏、權限被拒、低電量模式 → 必須自癒或明確提示
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "..", "frontend-v2", "coach-checkin.html");
const html = fs.readFileSync(file, "utf8");
const js = (html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || "";

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. iOS video 必備屬性");
{
  const tag = (html.match(/<video[^>]*id="scanVideo"[^>]*>/) || [""])[0];
  ok("有 playsinline", /playsinline/.test(tag));
  ok("有 webkit-playsinline", /webkit-playsinline/.test(tag));
  ok("有 muted", /muted/.test(tag));
  ok("有 autoplay", /autoplay/.test(tag));
}

console.log("\n🧪 2. 前景返回自動重連");
{
  ok("監聽 visibilitychange", /addEventListener\("visibilitychange"/.test(js));
  ok("監聽 focus", /addEventListener\("focus",\s*recheckCamera\)/.test(js));
  ok("監聽 pageshow", /addEventListener\("pageshow",\s*recheckCamera\)/.test(js));
  ok("有 restartCamera", /function restartCamera/.test(js));
  ok("有 cameraLooksDead（檢查 track/srcObject/paused/videoWidth）",
    /function cameraLooksDead/.test(js) && /readyState === "ended"/.test(js) && /videoWidth === 0/.test(js));
  ok("重連有防連環重啟（lastRestartAt）", /lastRestartAt/.test(js));
  ok("3 秒看門狗", /setInterval\([\s\S]{0,260}\}, 3000\)/.test(js));
  ok("錯誤卡顯示時暫停看門狗", /scanErr\.style\.display !== "none"\) return/.test(js));
  ok("有 loop 守衛（避免雙重 rAF）", /loopActive/.test(js) && /function resumeLoop/.test(js));
  ok("play() 有 4 秒超時（低電量模式卡死可救）", /Promise\.race\(\[/.test(js) && /4000/.test(js));
  ok("卡死的 scanStarting 10 秒後可解鎖重試", /Date\.now\(\) - scanStartAt < 10000/.test(js));
  ok("TimeoutError 有中文指引", /TimeoutError/.test(js) && /鏡頭啟動超時/.test(js));
}

console.log("\n🧪 3. 黑屏兜底提示卡");
{
  ok("有 scanErr 卡", /id="scanErr"/.test(html));
  ok("大字標題「未能開啟相機」", /未能開啟相機/.test(html));
  ok("有重試按鈕", /id="scanRetry"[\s\S]{0,400}重試/.test(html));
  ok("有切換手動名冊", /id="scanBack"[\s\S]{0,400}手動點名/.test(html));
  ok("重試會重新 getUserMedia", /\$\("scanRetry"\)\.onclick[\s\S]{0,80}startScan\(\)/.test(js));
  ok("返回名冊會關閉掃碼", /\$\("scanBack"\)\.onclick[\s\S]{0,60}stopScan\(\)/.test(js));
  ok("權限被拒有具體指引（設定 → Safari）", /NotAllowedError/.test(js) && /設定 → Safari → 相機/.test(js));
  ok("鏡頭被佔用有指引", /NotReadableError/.test(js));
  ok("失敗唔會再靜靜關閉（catch 不再 stopScan）",
    /catch \(e\) \{[\s\S]{0,160}showScanError\(cameraHint\(e\)\)/.test(js));
  ok("成功後會隱藏錯誤卡", /hideScanError\(\)/.test(js));
}

console.log("\n🧪 4. 原有流程唔受影響");
{
  ok("掃碼仍用本地 jsQR", /window\.jsQR/.test(js));
  ok("成功橫幅 1.5 秒", /ms \|\| 1500/.test(js));
  ok("成功後 1.5 秒恢復掃描", /scanning = true; resumeLoop\(\);\s*\}, 1500\)/.test(js));
  ok("demo 模式仍存在", /DEMO_ROSTER/.test(js));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
