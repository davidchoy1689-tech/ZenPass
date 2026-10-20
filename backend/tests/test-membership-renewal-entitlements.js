/**
 * ZenPass — 會籍閉環 tests
 * 1) 續期接續：有生效會籍時，新一期由舊會籍到期日開始（唔蝕剩餘日數）
 * 2) 權益落地：priority_booking entitlement 真正影響 VIP 優先預約窗口
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-secret-key-for-tests-only-32chars!";
const tmp = path.join(os.tmpdir(), "zenpass-renew-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits REAL DEFAULT 0, membership_type TEXT DEFAULT 'none',
    membership_expires_at TEXT, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  for (const id of ["u_renew", "u_lite", "u_vip", "u_expired"]) {
    pre.prepare("INSERT INTO users (id,name,email) VALUES (?,?,?)").run(id, id, id + "@t.hk");
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { grantEntitlements } = require("../src/services/membership-catalog");
  const { computeMembershipPeriod } = require("../src/routes/membership-orders");
  const { isVipCustomer, checkVipPriorityWindow } = require("../src/services/booking-service");

  console.log("🧪 會籍續期 + 權益 tests");

  // ── 1. 續期接續 ─────────────────────────────
  const now = new Date("2026-10-20T12:00:00Z");

  const fresh = computeMembershipPeriod(db, "u_renew", 30, now);
  ok(!fresh.stacked, "無現有會籍 → 由今日起算（唔標記續期接續）");
  ok(
    Math.round((fresh.end - now) / 86400000) === 30,
    "無現有會籍 → 30 日後到期",
  );

  const oldEnd = new Date("2026-11-05T00:00:00Z").toISOString();
  db.prepare(
    "INSERT INTO memberships (id,user_id,type,price_hkd,credits_granted,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?)",
  ).run("m1", "u_renew", "lite", 299, 37, "2026-10-06T00:00:00Z", oldEnd, "active");

  const stacked = computeMembershipPeriod(db, "u_renew", 30, now);
  ok(stacked.stacked, "有生效會籍 → 標記為續期接續");
  ok(
    new Date(stacked.start).toISOString() === oldEnd,
    "新一期由舊會籍到期日開始（舊到期 " + oldEnd.slice(0, 10) + "）",
  );
  ok(
    Math.round((stacked.end - new Date(oldEnd)) / 86400000) === 30,
    "新一期長度仍為 30 日（總有效期 36 日，冇蝕剩餘日數）",
  );

  // 已過期會籍唔應該被接續
  db.prepare("UPDATE memberships SET end_date=? WHERE id='m1'").run("2026-10-01T00:00:00Z");
  const past = computeMembershipPeriod(db, "u_renew", 30, now);
  ok(!past.stacked, "舊會籍已過期 → 由今日重新起算");

  // ── 2. 權益 → VIP 優先預約 ─────────────────
  db.prepare("DELETE FROM memberships").run();
  const cls = { vip_priority_hours: 24, created_at: new Date(now.getTime() - 3600 * 1000).toISOString() };

  ok(!isVipCustomer(db, "u_lite"), "無權益（lite 未開通）→ 唔算 VIP");
  ok(checkVipPriorityWindow(db, cls, "u_lite", now).allowed === false, "無權益 → VIP 窗口內被擋");

  grantEntitlements("u_vip", "gold", new Date(now.getTime() + 30 * 86400000).toISOString());
  ok(isVipCustomer(db, "u_vip"), "有 priority_booking 權益 → 視為 VIP");
  ok(checkVipPriorityWindow(db, cls, "u_vip", now).allowed === true, "有權益 → VIP 窗口內可預約");

  // 權益過期 → 唔再有效
  grantEntitlements("u_expired", "gold", new Date(now.getTime() - 86400000).toISOString());
  db.prepare("UPDATE entitlements SET valid_until=? WHERE user_id='u_expired'").run(
    new Date(now.getTime() - 86400000).toISOString(),
  );
  ok(!isVipCustomer(db, "u_expired"), "權益已過期 → 唔再算 VIP");

  // 窗口過後所有人可預約
  const oldCls = { vip_priority_hours: 24, created_at: new Date(now.getTime() - 48 * 3600 * 1000).toISOString() };
  ok(checkVipPriorityWindow(db, oldCls, "u_lite", now).allowed === true, "VIP 窗口結束 → 一般用戶可預約");

  try {
    fs.unlinkSync(tmp);
  } catch (e) {}
  console.log(fail === 0 ? "\n✅ 全部通過" : "\n❌ " + fail + " 項失敗");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("❌ 測試錯誤:", e.message);
  process.exit(1);
});
