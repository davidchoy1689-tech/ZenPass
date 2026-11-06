/**
 * admin-ops UI 翻新（2026-11-06）
 * 驗收：指標卡、待核款卡片化、WhatsApp 預填、還原折疊、Toast 取代 alert、名冊 CSV
 */
const fs = require("fs");
const path = require("path");

const F = path.join(__dirname, "..", "..", "frontend-v2");
const ops = fs.readFileSync(path.join(F, "admin-ops.html"), "utf8");
const roster = fs.readFileSync(path.join(F, "roster-print.html"), "utf8");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 頂部四張指標卡");
{
  ok("statgrid 4 格", /\.statgrid\{display:grid;grid-template-columns:repeat\(4,1fr\)/.test(ops));
  ok("四張卡存在", (ops.match(/class="stat"/g) || []).length === 4);
  ok("12/12 席位卡 + 進度條", /id="stSeats"/.test(ops) && /id="stSeatsBar"/.test(ops));
  ok("進度條 ≥75% 轉橙", /bar\.warn i\{background:#f59e0b\}/.test(ops));
  ok("待核款卡有 pulse", /\.pulse\{/.test(ops) && /@keyframes pulse/.test(ops) && /className = "pulse"/.test(ops));
  ok("營業額卡", /id="stRev"/.test(ops));
  ok("系統狀態卡（API/DB）", /id="stSys"/.test(ops) && /api\/health/.test(ops) && /hd\.database && hd\.database\.connected/.test(ops));
  ok("載入時會計數", /async function loadStats/.test(ops) && /await loadStats\(\);/.test(ops));
  ok("12/12 班次識別", /2026-12-12/.test(ops));
  ok("手機 2 欄", /@media \(max-width:820px\)\{ \.statgrid\{grid-template-columns:1fr 1fr\}/.test(ops));
}

console.log("\n🧪 2. 待核收款卡片化");
{
  ok("paycard 樣式", /\.paycard\{/.test(ops));
  ok("自報已付款左邊黃線", /\.paycard\.claimed\{border-left-color:#f59e0b/.test(ops));
  ok("有 claimed class 綁定", /paycard\$\{claimed \? " claimed" : ""\}/.test(ops));
  ok("主掣：確認收款（實心）", /class="btn btn-solid" data-approve=/.test(ops) && /✅ 確認收款/.test(ops));
  ok("次掣：延長 60 分（線框）", /class="btn btn-line" data-extend=/.test(ops) && /⏱️ 延長 60 分/.test(ops));
  ok("倒數用 timer 樣式", /class="meta timer"/.test(ops) && /\.timer\{font-weight:900/.test(ops));
  ok("WhatsApp 預填含學員名/班次/FPS", /快速 WhatsApp/.test(ops) && /12\/12 楓樹窩班次/.test(ops) && /補交 FPS 參考編號/.test(ops));
}

console.log("\n🧪 3. 還原面板折疊 + 明確禁用");
{
  ok("用 details 折疊", /<details class="foldcard" id="restoreFold">/.test(ops));
  ok("預設收起", !/<details class="foldcard" id="restoreFold" open/.test(ops));
  ok("滿席標示「席位已滿無法還原」", /席位已滿無法還原/.test(ops));
  ok("課堂取消標示", /課堂已取消/.test(ops));
  ok("禁用時 disabled", /\$\{blocked \? "disabled" : ""\}/.test(ops));
}

console.log("\n🧪 4. Toast 取代 alert");
{
  ok("admin-ops 已無 alert(", !/\balert\(/.test(ops));
  ok("Toast 固定右上", /\.toast6\{position:fixed;right:16px;top:16px/.test(ops));
  ok("滑入動畫", /@keyframes toastIn/.test(ops));
  ok("成功 1.8 秒／錯誤 3.2 秒", /\/失敗\|錯誤\|不可\|無法\|未有\/.test\(m\) \? 3200 : 1800/.test(ops));
}

console.log("\n🧪 5. 名冊頁：舊患標籤 + CSV");
{
  ok("姓名旁有 ⚠️ 舊患標籤", /class="tag">⚠️ 舊患/.test(roster));
  ok("標籤樣式（淡紅）", /\.tag\{[^}]*background:#fee2e2/.test(roster));
  ok("有匯出 CSV 掣", /id="csvBtn"/.test(roster) && /📥 匯出 CSV/.test(roster));
  ok("CSV 有 BOM（Excel 中文正常）", /\\ufeff/.test(roster));
  ok("CSV 欄位齊（姓名/電話/舊患/緊急/簽到）", /"緊急聯絡人"/.test(roster) && /"已簽到"/.test(roster));
  ok("CSV 用 roster 資料", /window\.__ROSTER__/.test(roster));
}

console.log("\n🧪 6. 原有功能未被破壞");
{
  ok("確認收款 API 仍在", /\/admin\/approve-payment/.test(ops));
  ok("延長鎖位 API 仍在", /extend-hold/.test(ops));
  ok("還原 API 仍在", /\/restore`/.test(ops));
  ok("A4 名冊入口仍在", /roster-print\.html\?schedule_id=/.test(ops));
  ok("收據縮圖可撳大", /data-rc=/.test(ops) && /showReceipt/.test(ops));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
