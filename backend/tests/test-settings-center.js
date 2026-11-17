#!/usr/bin/env node
/**
 * test-settings-center.js — 後台「⚙️ 系統參數」中心（2026-11-17）
 *
 * 覆蓋：
 *  1) 註冊表完整性（唯一 key、group 有效、default 在範圍內、access 合法）
 *  2) 預設值讀取（DB 冇值時用 registry default）
 *  3) 驗證：int 範圍、bool、enum、percent、list 正規化
 *  4) 寫入：platform_settings + audit_log，cache 即時失效
 *  5) 原子性：其中一個非法 → 全部唔寫
 *  6) 還原預設
 *  7) 接線：取消政策、迎新、積分、罰款、佔位上限、證書門檻、簽到距離
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

const TMP = path.join(os.tmpdir(), "zenpass-settings-" + Date.now() + ".db");
process.env.DB_PATH = TMP;
process.env.JWT_SECRET = "***" + "x".repeat(40);

let pass = 0,
  bad = 0;
const ok = (c, m, x) =>
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase();
try {
  updateDatabase();
} catch (e) {}

const Database = require("better-sqlite3");
const db = new Database(TMP);
db.pragma("foreign_keys = ON");

const registry = require("../src/config/settings-registry");
const settings = require("../src/services/settings-service");

console.log("\n[1] 註冊表完整性");
const keys = registry.ITEMS.map((i) => i.key);
ok(new Set(keys).size === keys.length, "key 冇重複（" + keys.length + " 項）");
ok(registry.ITEMS.every((i) => ["ops", "super"].includes(i.access)), "access 只可以 ops / super");
ok(registry.ITEMS.every((i) => i.wired === true), "所有參數已接線（wired=true）");
const groupIds = registry.GROUPS.map((g) => g.id);
ok(registry.ITEMS.every((i) => groupIds.includes(i.group)), "group 都存在");
const badDefaults = registry.ITEMS.filter((i) => {
  if (["int", "float", "percent"].includes(i.type)) {
    if (typeof i.default !== "number") return true;
    if (i.min != null && i.default < i.min) return true;
    if (i.max != null && i.default > i.max) return true;
  }
  if (i.type === "enum" && !(i.options || []).includes(i.default)) return true;
  return false;
});
ok(badDefaults.length === 0, "所有 default 都在合法範圍", badDefaults.map((b) => b.key));
ok(registry.ITEMS.some((i) => i.access === "super"), "有 super-only 參數（金錢／安全）");
ok(registry.ITEMS.some((i) => i.restart), "有標示需重啟的參數");

console.log("\n[2] 預設值讀取");
settings.clearCache();
ok(settings.num(db, "booking_hold_minutes", -1) === 10, "booking_hold_minutes 預設 10");
ok(settings.bool(db, "security.bot_detection", false) === true, "bot_detection 預設開");
ok(settings.num(db, "penalty.no_show_credits", -1) === 2, "缺席罰款預設 2 credits");

console.log("\n[3] 驗證");
const v = (key, raw) => settings.validate(settings.getItem(key), raw);
ok(v("booking_hold_minutes", 5).ok && v("booking_hold_minutes", 5).value === "5", "int 合法 → 5");
ok(!v("booking_hold_minutes", 2).ok, "int 低於下限 → 拒絕");
ok(!v("booking_hold_minutes", 999).ok, "int 高於上限 → 拒絕");
ok(!v("booking_hold_minutes", "abc").ok, "int 非數字 → 拒絕");
ok(!v("booking_hold_minutes", 5.5).ok, "int 小數 → 拒絕");
ok(v("security.bot_detection", false).value === "0", "bool false → '0'");
ok(v("security.bot_detection", "true").value === "1", "bool 'true' → '1'");
ok(v("venue.pli_gate", "enforce").value === "enforce", "enum 合法值");
ok(!v("venue.pli_gate", "nope").ok, "enum 非法值 → 拒絕");
ok(v("coach_commission_rate", 0.85).value === "0.85", "percent 0.85");
ok(!v("coach_commission_rate", 1.2).ok, "percent 超出 → 拒絕");
ok(v("launch.allow_domains", " A.com, b.com ").value === "a.com,b.com", "list 正規化（去空格、細寫）");

console.log("\n[4] 寫入 + 審計 + cache");
const before = db.prepare("SELECT COUNT(*) c FROM audit_log").get().c;
settings.setMany(db, { booking_hold_minutes: 25, "points.review": 30 }, { actorId: "admin1" });
ok(settings.num(db, "booking_hold_minutes", -1) === 25, "寫入後即時讀到 25（cache 已失效）");
ok(
  db.prepare("SELECT value FROM platform_settings WHERE key='booking_hold_minutes'").get().value === "25",
  "platform_settings 已寫入",
);
const after = db.prepare("SELECT COUNT(*) c FROM audit_log").get().c;
ok(after - before === 2, "每項改動各寫一條 audit（+2）", after - before);
const auditRow = db
  .prepare("SELECT action_type, old_values, new_values FROM audit_log WHERE entity_id='points.review' ORDER BY created_at DESC LIMIT 1")
  .get();
ok(auditRow && auditRow.action_type === "settings.update", "audit action_type = settings.update", auditRow);
ok(JSON.parse(auditRow.new_values).value === 30, "audit 記錄新值", auditRow.new_values);

console.log("\n[5] 原子性（一個錯 → 全部唔寫）");
let err = null;
try {
  settings.setMany(db, { "points.referral": 200, booking_hold_minutes: 9999 }, { actorId: "admin1" });
} catch (e) {
  err = e;
}
ok(err && err.status === 400 && err.code === "INVALID_SETTING", "回 400 INVALID_SETTING", err && err.code);
ok(settings.num(db, "points.referral", -1) === 100, "合法嗰項都冇寫入（維持 100）");
ok(settings.num(db, "booking_hold_minutes", -1) === 25, "原有值冇被破壞");

console.log("\n[6] describe + 還原預設");
const d = settings.describe(db);
ok(d.item_count === registry.ITEMS.length, "describe 回傳全部參數", d.item_count);
const holdItem = d.groups.flatMap((g) => g.items).find((i) => i.key === "booking_hold_minutes");
ok(holdItem.is_default === false && holdItem.value === 25, "describe 反映自訂值");
settings.resetToDefaults(db, ["booking_hold_minutes"], { actorId: "admin1" });
ok(settings.num(db, "booking_hold_minutes", -1) === 10, "還原後回預設 10");
const holdItem2 = settings.describe(db).groups.flatMap((g) => g.items).find((i) => i.key === "booking_hold_minutes");
ok(holdItem2.is_default === true, "describe 標記回預設");

console.log("\n[6b] 寫返預設值 → 自動清除 override");
const rb1 = settings.setMany(db, { "points.review": 20 }, { actorId: "admin1" });
ok(rb1.changes.length === 1, "由自訂 30 寫返預設 20 → 1 個改動", rb1.changes);
ok(!db.prepare("SELECT key FROM platform_settings WHERE key='points.review'").get(), "override 已刪除（保持預設狀態）");
const rb2 = settings.setMany(db, { "points.review": 20 }, { actorId: "admin1" });
ok(rb2.changes.length === 0, "本來就係預設 → 冇多餘寫入", rb2.changes);

console.log("\n[7] 接線：取消政策");
const bookingService = require("../src/services/booking-service");
ok(bookingService.cancellationFeeRate(200) === 0, "≥72h → 全退（預設）");
ok(bookingService.cancellationFeeRate(48) === 0.5, "24–72h → 一半（預設）");
ok(bookingService.cancellationFeeRate(2) === 1, "<24h → 全扣（預設）");
settings.setMany(
  db,
  { "booking.cancel_free_hours": 100, "booking.cancel_half_hours": 12, "booking.cancel_half_rate": 0.6 },
  { actorId: "admin1" },
);
ok(bookingService.cancellationFeeRate(96) === 0.6, "改設定後 96h → 0.6（新政策生效）");
ok(bookingService.cancellationFeeRate(120) === 0, "120h ≥ 新免費界線 → 0");
ok(bookingService.cancellationFeeRate(5) === 1, "5h < 新半費界線 → 1");

console.log("\n[8] 接線：迎新優惠");
db.prepare(
  "INSERT INTO users (id,email,name,credits,phone,role,email_verified,created_at) VALUES ('u_new','n@t.hk','新人',50,'90001111','user',1,datetime('now','-3 days'))",
).run();
const t1 = bookingService.getTrialStatus(db, "u_new");
ok(t1.eligible === true && t1.trial_window_days === 7, "新用戶 7 日內可迎新", t1);
settings.setMany(db, { "booking.trial_window_days": 1 }, { actorId: "admin1" });
const t2 = bookingService.getTrialStatus(db, "u_new");
ok(t2.eligible === false, "把窗口改做 1 日 → 3 日前註冊唔再合資格");
settings.setMany(db, { "booking.trial_window_days": 7, "booking.trial_max_count": 2 }, { actorId: "admin1" });
const t3 = bookingService.getTrialStatus(db, "u_new");
ok(t3.trial_window_days === 7, "改回 7 日生效");

console.log("\n[9] 接線：積分／罰款／佔位／證書／簽到距離");
const { EARN_RULES } = require("../src/services/points");
settings.setMany(db, { "points.review": 77 }, { actorId: "admin1" });
ok(EARN_RULES.review === 77, "EARN_RULES.review 跟設定（77）", EARN_RULES.review);
ok(EARN_RULES.booking === 50, "booking 積分維持 50");

const { holdLimits } = require("../src/middleware/unpaid-hold-guard");
settings.setMany(db, { "booking.unpaid_hold_max": 7, "booking.unpaid_hold_window_minutes": 45 }, { actorId: "admin1" });
const hl = holdLimits(db);
ok(hl.perUser === 7 && hl.windowMin === 45 && hl.ipMax === 14, "佔位上限／窗口／IP 上限跟設定", hl);

const cert = require("../src/services/certificate-service");
ok(cert.assessmentMinHours(db) === 30, "Level 3 門檻預設 30 小時");
settings.setMany(db, { "assessment.min_hours": 20 }, { actorId: "admin1" });
ok(cert.assessmentMinHours(db) === 20, "改做 20 小時生效");

const sum = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
ok(sum("routes/penalty.js").includes("penalty.no_show_credits"), "罰款設定已改讀 settings");
ok(sum("services/booking-service.js").includes("class.checkin_max_distance_m"), "簽到距離已接 settings");
ok(sum("services/certificate-service.js").includes("certificate.min_attendance_rate"), "出席率門檻已接 settings");
ok(sum("middleware/anti-scalping.js").includes("security.anti_scalping_user_per_min"), "反炒場限流已接 settings");
ok(sum("index.js").includes("security.rate_limit_auth_per_min"), "登入限流已接 settings");

console.log("\n[10] 金錢表零改動");
ok(db.prepare("SELECT COUNT(*) c FROM wallet_transactions").get().c === 0, "wallet_transactions 維持 0");
ok(db.prepare("SELECT COUNT(*) c FROM coach_earnings").get().c === 0, "coach_earnings 維持 0");

db.close();
console.log(`\n${bad ? "❌" : "✅"} 系統參數中心：${pass} 通過，${bad} 失敗`);
process.exit(bad ? 1 : 0);
