/**
 * 付款申報鎖位：30 分鐘 hold、claim 60 分鐘、同電話最多 2 單
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { claimPayment } = require("../src/services/payment-claim");
const { releaseExpiredHolds } = require("../src/services/booking-service");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };
const throws = (n, fn, code) => { try { fn(); failed++; console.log("  ❌", n, "冇拋錯"); } catch (e) { ok(n + " → " + code, e.code === code, e.code + " " + e.message); } };

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE class_schedules (id TEXT PRIMARY KEY, enrolled_count INTEGER DEFAULT 0, max_participants INTEGER DEFAULT 8);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT,
      status TEXT, payment_status TEXT, fps_reference TEXT, payme_reference TEXT,
      payment_reported_at TEXT, payment_claimed INTEGER DEFAULT 0, payment_claimed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT,
      user_id TEXT, new_values TEXT, description TEXT, created_at TEXT);
  `);
  d.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001')").run();
  d.prepare("INSERT INTO users VALUES ('u2','李生','91234567')").run();
  ["s1", "s2", "s3"].forEach((s) => d.prepare("INSERT INTO class_schedules (id) VALUES (?)").run(s));
  return d;
}
const add = (d, id, user, sched, extra = "") =>
  d.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status${extra ? "," + extra.split("=")[0] : ""})
             VALUES (?,?,?,?,'pending_payment','pending'${extra ? ",?" : ""})`).run(id, "ZP-" + id, user, sched, ...(extra ? [extra.split("=")[1]] : []));

console.log("\n🧪 1. 申報鎖位");
{
  const d = db(); add(d, "b1", "u1", "s1");
  const r = claimPayment(d, { bookingId: "b1", userId: "u1" });
  ok("成功", r.already_reported === false);
  const b = d.prepare("SELECT * FROM bookings WHERE id='b1'").get();
  ok("payment_claimed=1", Number(b.payment_claimed) === 1 && !!b.payment_claimed_at);
  ok("audit payment.claimed", d.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='payment.claimed'").get().n === 1);
}

console.log("\n🧪 2. 2 人同行同一單只算 1 個佔位");
{
  const d = db(); add(d, "b1", "u1", "s1"); add(d, "b2", "u1", "s1");
  claimPayment(d, { bookingId: "b1", userId: "u1" });
  const b2 = d.prepare("SELECT * FROM bookings WHERE id='b2'").get();
  ok("同行另一座位 sel一齊標記", Number(b2.payment_claimed) === 1);
  add(d, "b3", "u1", "s2");
  claimPayment(d, { bookingId: "b3", userId: "u1" });
  ok("第 2 單仍可", d.prepare("SELECT COUNT(*) n FROM bookings WHERE payment_claimed=1").get().n === 3);
}

console.log("\n🧪 3. 第 3 個未核實佔位被拒");
{
  const d = db(); add(d, "b1", "u1", "s1"); add(d, "b2", "u1", "s2");
  claimPayment(d, { bookingId: "b1", userId: "u1" });
  claimPayment(d, { bookingId: "b2", userId: "u1" });
  add(d, "b3", "u1", "s3");
  throws("第 3 單", () => claimPayment(d, { bookingId: "b3", userId: "u1" }), "CLAIM_LIMIT");
}

console.log("\n🧪 4. 非本人不可申報");
{
  const d = db(); add(d, "b1", "u1", "s1");
  throws("u2 申報 u1 單", () => claimPayment(d, { bookingId: "b1", userId: "u2" }), "FORBIDDEN");
}

console.log("\n🧪 5. 30 分鐘未付款釋放 / 已申報保留到 60 分鐘");
{
  const d = db(); add(d, "b1", "u1", "s1");
  d.prepare("UPDATE bookings SET created_at=datetime('now','-31 minutes') WHERE id='b1'").run();
  releaseExpiredHolds(d, "s1");
  ok("31 分鐘未申報 → cancelled", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "cancelled");
}
{
  const d = db(); add(d, "b1", "u1", "s1");
  claimPayment(d, { bookingId: "b1", userId: "u1" });
  d.prepare("UPDATE bookings SET created_at=datetime('now','-45 minutes') WHERE id='b1'").run();
  releaseExpiredHolds(d, "s1");
  ok("45 分鐘已申報 → 保留", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "pending_payment");
  d.prepare("UPDATE bookings SET payment_claimed_at=datetime('now','-61 minutes') WHERE id='b1'").run();
  releaseExpiredHolds(d, "s1");
  ok("超過 60 分鐘 → cancelled", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "cancelled");
}
{
  const d = db(); add(d, "b1", "u1", "s1");
  d.prepare("UPDATE bookings SET fps_reference='FPS-1', created_at=datetime('now','-120 minutes') WHERE id='b1'").run();
  releaseExpiredHolds(d, "s1");
  ok("已提交參考編號 → 永不自動釋放", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "pending_payment");
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
