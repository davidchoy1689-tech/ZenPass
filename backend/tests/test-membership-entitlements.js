/**
 * ZenPass — 會籍權益：免費取消 tests
 * 「自由取消（開課前一日）」/「無限取消更換」真正生效
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-entcancel-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  for (const id of ["none_u", "free_u", "unlimited_u", "expired_u", "zero_u"]) {
    pre.prepare("INSERT INTO users (id,name) VALUES (?,?)").run(id, id);
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { hasEntitlement, grantEntitlements } = require("../src/services/membership-catalog");
  const { resolveCancellationFeeRate, cancellationFeeRate } = require("../src/services/booking-service");

  console.log("🧪 會籍免費取消 tests");

  console.log("── 基本政策（無會籍）──");
  ok(cancellationFeeRate(80) === 0, "≥72h → 0%");
  ok(cancellationFeeRate(30) === 0.5, "24-72h → 50%");
  ok(cancellationFeeRate(10) === 1, "＜24h → 100%");
  ok(resolveCancellationFeeRate("none_u", 30, 0.5) === 0.5, "無會籍 30h → 照扣 50%");
  ok(resolveCancellationFeeRate("none_u", 10, 1) === 1, "無會籍 10h → 照扣 100%");

  console.log("── free_cancel（所有 Pass）──");
  db.prepare("INSERT INTO entitlements (id,user_id,key,value,source,valid_until,updated_at) VALUES (?,?,?,?,?,?,datetime('now'))")
    .run("e1", "free_u", "free_cancel", 1, "membership:lite", "2099-12-31 00:00:00");
  ok(hasEntitlement("free_u", "free_cancel"), "有效 free_cancel");
  ok(resolveCancellationFeeRate("free_u", 30, 0.5) === 0, "30h 前取消 → 免罰");
  ok(resolveCancellationFeeRate("free_u", 10, 1) === 1, "10h 前（當日）→ 仍扣 100%（符合『開課前一日』）");

  console.log("── unlimited_cancel（高階/VIP Pass）──");
  db.prepare("INSERT INTO entitlements (id,user_id,key,value,source,valid_until,updated_at) VALUES (?,?,?,?,?,?,datetime('now'))")
    .run("e2", "unlimited_u", "unlimited_cancel", 1, "membership:gold", "2099-12-31 00:00:00");
  ok(resolveCancellationFeeRate("unlimited_u", 10, 1) === 0, "10h 前取消 → 免罰（無限取消）");
  ok(resolveCancellationFeeRate("unlimited_u", 30, 0.5) === 0, "30h 前取消 → 免罰");

  console.log("── 過期 / 無效 ──");
  db.prepare("INSERT INTO entitlements (id,user_id,key,value,source,valid_until,updated_at) VALUES (?,?,?,?,?,?,datetime('now'))")
    .run("e3", "expired_u", "unlimited_cancel", 1, "membership:gold", "2020-01-01 00:00:00");
  ok(!hasEntitlement("expired_u", "unlimited_cancel"), "過期權益視為無效");
  ok(resolveCancellationFeeRate("expired_u", 10, 1) === 1, "過期會籍 → 照扣");

  db.prepare("INSERT INTO entitlements (id,user_id,key,value,source,valid_until,updated_at) VALUES (?,?,?,?,?,?,datetime('now'))")
    .run("e4", "zero_u", "unlimited_cancel", 0, "membership:gold", null);
  ok(!hasEntitlement("zero_u", "unlimited_cancel"), "value=0 視為無效");

  console.log("── 權益發放（確認 key 對得上）──");
  const n = grantEntitlements("none_u", "gold", "2099-12-31 00:00:00");
  ok(n > 0 && hasEntitlement("none_u", "unlimited_cancel"), "gold 會籍授予 unlimited_cancel");
  ok(hasEntitlement("none_u", "priority_booking"), "同時授予 priority_booking（下一階段接入）");

  console.log("── 接線 ──");
  const src = fs.readFileSync(path.join(__dirname, "../src/services/booking-service.js"), "utf8");
  ok(/resolveCancellationFeeRate\(\s*req\.user\.id/.test(src), "cancelBooking 使用權益計算罰款");
  ok(/hasEntitlement\(userId, "unlimited_cancel"\)/.test(src), "unlimited_cancel 已接");
  ok(/hoursUntilClass >= 24 && hasEntitlement\(userId, "free_cancel"\)/.test(src), "free_cancel 只限 ≥24h");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
