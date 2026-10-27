/** ZenPass — 運維修正 tests（penalty type / 通知 FK / circular JSON） */
const fs = require("fs");
const path = require("path");
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 運維修正 tests");
const bs = fs.readFileSync(path.join(__dirname, "..", "src/services/booking-service.js"), "utf8");
ok(!bs.includes("'cancel_fee'"), "penalty_logs 用 late_cancel（唔再用非法 type）");

const nf = fs.readFileSync(path.join(__dirname, "..", "src/services/notification.js"), "utf8");
ok(nf.includes("SELECT 1 FROM users WHERE id = ?"), "通知前檢查 recipient 存在");
ok(nf.includes("[NOTIF] skip"), "recipient 唔存在會 warn 而唔係 FK error");

const as = fs.readFileSync(path.join(__dirname, "..", "src/middleware/anti-scalping.js"), "utf8");
ok(as.includes("function safeJson"), "有 safeJson 防 circular");
ok(as.includes("safeJson(details)"), "suspicious_activity 用 safeJson");

const schema = fs.readFileSync(path.join(__dirname, "..", "src/config/schema-parity.sql"), "utf8");
ok(/type TEXT NOT NULL CHECK\(type IN \('late_cancel', 'no_show'\)\)/.test(schema), "schema 只准 late_cancel/no_show（確認 code 對得上）");

console.log(fail ? `❌ ${fail} failed` : "✅ 運維修正 tests passed");
if (fail) process.exit(1);

// 名額釋放通知：只發給仍然存在嘅用戶
const idxSrc = fs.readFileSync(path.join(__dirname, "..", "src/services/vacancy-notify.js"), "utf8");
if (!/JOIN users u ON u\.id = b\.user_id/.test(idxSrc)) {
  console.error("  ❌ vacancy notify 未過濾已刪除用戶（會 log [NOTIF] skip）");
  process.exit(1);
}
if (!/JOIN users u2 ON u2\.id = ua\.user_id/.test(idxSrc)) {
  console.error("  ❌ user_actions 分支未過濾已刪除用戶");
  process.exit(1);
}
console.log("  ✅ 名額釋放通知只發給現存用戶");

// 名額釋放要用獨立通知模板（唔可以借用 booking.confirmed）
const notifSrc = fs.readFileSync(path.join(__dirname, "..", "src/services/notification.js"), "utf8");
if (!notifSrc.includes('case "class.vacancy"')) {
  console.error("  ❌ 缺少 class.vacancy 通知模板");
  process.exit(1);
}
if (!/sendNotification\("class\.vacancy"/.test(idxSrc)) {
  console.error("  ❌ 名額釋放仍用錯誤通知類型");
  process.exit(1);
}
console.log("  ✅ 名額釋放用 class.vacancy 模板（唔會出「預約確認」錯誤標題）");

// audit_log 欄位名（2026-10-27）：正確 schema 係 action_type / new_values / description
// 曾經 penalty.js 用 action / details → 每次 no-show 都 SQLITE_ERROR，審計紀錄靜靜流失
const _walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? _walk(p) : p.endsWith(".js") ? [p] : [];
});
const badAudit = _walk(path.join(__dirname, "..", "src")).filter((f) => {
  const src = fs.readFileSync(f, "utf8");
  return /INSERT INTO audit_log \([^)]*\baction\b[^)]*\)/i.test(src) ||
    /INSERT INTO audit_log \([^)]*\bdetails\b[^)]*\)/i.test(src);
});
if (badAudit.length) {
  console.error("  ❌ 以下檔案仍用舊 audit_log 欄位（action／details）：");
  badAudit.forEach((f) => console.error("     - " + path.relative(path.join(__dirname, ".."), f)));
  process.exit(1);
}
console.log("  ✅ audit_log 寫入一律用 action_type / new_values（唔會再靜靜失敗）");
