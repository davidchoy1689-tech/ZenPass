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
