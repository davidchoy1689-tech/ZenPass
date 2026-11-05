/**
 * 測試：Admin 改期 / 加位升級（transaction + rollback + audit）
 * 用獨立 in-memory DB，直接測 service。
 */
const path = require("path");
const assert = require("assert");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { rescheduleBooking, upgradeSeats } = require("../src/services/admin-booking-actions");

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, user_reference TEXT, email TEXT, password_hash TEXT, name TEXT, phone TEXT,
      auth_provider TEXT, email_verified INTEGER DEFAULT 0, agree_terms INTEGER DEFAULT 0,
      penalty_consent INTEGER DEFAULT 0, role TEXT, lead_source TEXT, tags TEXT
    );
    CREATE TABLE class_schedules (
      id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT, status TEXT DEFAULT 'available',
      enrolled_count INTEGER DEFAULT 0, max_participants INTEGER DEFAULT 8
    );
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, class_id TEXT,
      payment_type TEXT, payment_status TEXT, status TEXT, amount REAL,
      payment_method TEXT, fps_reference TEXT, payme_reference TEXT, group_size INTEGER DEFAULT 1,
      group_invite_code TEXT, venue_partner_id TEXT, platform_commission_rate REAL,
      venue_earned_amount REAL, platform_earned_amount REAL,
      amount_cents INTEGER, venue_earned_amount_cents INTEGER, platform_earned_amount_cents INTEGER,
      cancel_reason TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT, user_id TEXT,
      new_values TEXT, description TEXT, ip_address TEXT, user_agent TEXT, created_at TEXT
    );
  `);
  return db;
}

const future = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace("T", " ");
let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("  ✅", name); }
  else { failed++; console.log("  ❌", name, extra || ""); }
}
function throws(name, fn, code) {
  try { fn(); failed++; console.log("  ❌", name, "(冇拋錯)"); }
  catch (e) { ok(name + ` → ${code}`, e.code === code, `got ${e.code}: ${e.message}`); }
}

function seed(db, { seats = 1, paid = true } = {}) {
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u1','u1@x.com','陳小明','91234567','user')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,enrolled_count,max_participants) VALUES ('s1','c1',?,?,8)").run(future(3), seats);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,enrolled_count,max_participants) VALUES ('s2','c1',?,?,8)").run(future(5), 7);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,enrolled_count,max_participants) VALUES ('s3','c1',?,0,8)").run(future(-2));
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,status,enrolled_count,max_participants) VALUES ('s4','c1',?,'cancelled',0,8)").run(future(6));
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,enrolled_count,max_participants) VALUES ('s9','c9',?,0,8)").run(future(6));
  const ids = [];
  for (let i = 0; i < seats; i++) {
    const id = "b" + (i + 1);
    ids.push(id);
    db.prepare(
      `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,platform_commission_rate,venue_earned_amount,platform_earned_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, "ZP-000" + (i + 1), "u1", "s1", "c1", "single", paid ? "paid" : "pending", paid ? "confirmed" : "pending_payment", i === 0 ? 100 : 140, 0.25, i === 0 ? 75 : 105, i === 0 ? 25 : 35);
  }
  return ids;
}

console.log("\n🧪 1. 改期（單人）");
{
  const db = makeDb(); const [b] = seed(db);
  const r = rescheduleBooking(db, { bookingId: b, newScheduleId: "s2", reason: "首發特批順延", actorId: "admin1" });
  const oldB = db.prepare("SELECT * FROM bookings WHERE id=?").get(b);
  const newB = db.prepare("SELECT * FROM bookings WHERE id=?").get(r.new_booking_ids[0]);
  ok("舊單 cancelled", oldB.status === "cancelled");
  ok("新單 confirmed + paid", newB.status === "confirmed" && newB.payment_status === "paid");
  ok("金額保留 100", newB.amount === 100);
  ok("新班名額 7→8", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s2'").get().n === 8);
  ok("舊班名額 1→0", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 0);
  ok("audit booking.rescheduled", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='booking.rescheduled'").get().n === 1);
}

console.log("\n🧪 2. 改期（2 人同行一齊搬）");
{
  const db = makeDb(); const ids = seed(db, { seats: 2 });
  db.prepare("UPDATE class_schedules SET enrolled_count=6 WHERE id='s2'").run();
  const r = rescheduleBooking(db, { bookingId: ids[0], newScheduleId: "s2", reason: "兩位一齊改期", actorId: "admin1" });
  ok("搬 2 個位", r.seats === 2 && r.new_booking_ids.length === 2);
  ok("新班 6→8", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s2'").get().n === 8);
  ok("舊班 2→0", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 0);
  ok("兩舊單都 cancelled", db.prepare("SELECT COUNT(*) n FROM bookings WHERE status IN ('confirmed','pending_payment') AND schedule_id='s1'").get().n === 0);
}

console.log("\n🧪 3. 改期失敗 → 必須 rollback");
{
  const db = makeDb(); const [b] = seed(db);
  db.prepare("UPDATE class_schedules SET enrolled_count=8 WHERE id='s2'").run();
  throws("目標班只剩 1 位", () => rescheduleBooking(db, { bookingId: b, newScheduleId: "s2", reason: "測試滿額", actorId: "a" }), "CLASS_FULL");
  const oldB = db.prepare("SELECT status FROM bookings WHERE id=?").get(b);
  ok("舊單仍 confirmed（無被取消）", oldB.status === "confirmed");
  ok("舊班名額仍 1", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 1);
  throws("過去班次", () => rescheduleBooking(db, { bookingId: b, newScheduleId: "s3", reason: "測試過去", actorId: "a" }), "SCHEDULE_PAST");
  throws("已取消班次", () => rescheduleBooking(db, { bookingId: b, newScheduleId: "s4", reason: "測試取消班", actorId: "a" }), "SCHEDULE_CANCELLED");
  throws("不同課程", () => rescheduleBooking(db, { bookingId: b, newScheduleId: "s9", reason: "測試課程", actorId: "a" }), "CLASS_MISMATCH");
  throws("同班", () => rescheduleBooking(db, { bookingId: b, newScheduleId: "s1", reason: "測試同班", actorId: "a" }), "SAME_SCHEDULE");
  throws("原因太短", () => rescheduleBooking(db, { bookingId: b, newScheduleId: "s2", reason: "x", actorId: "a" }), "REASON_REQUIRED");
}

console.log("\n🧪 4. 加位升級");
{
  const db = makeDb(); const [b] = seed(db);
  db.prepare("UPDATE bookings SET amount=140 WHERE id=?").run(b);
  const r = upgradeSeats(db, { bookingId: b, friendName: "陳太", friendPhone: "852 9234 5678", topUpAmount: 100, paymentReference: "FPS-123456", actorId: "admin1" });
  const nb = db.prepare("SELECT * FROM bookings WHERE id=?").get(r.new_booking_id);
  const friend = db.prepare("SELECT * FROM users WHERE id=?").get(r.friend_user_id);
  ok("新 booking $100 paid confirmed", nb.amount === 100 && nb.payment_status === "paid" && nb.status === "confirmed");
  ok("朋友帳號有姓名電話", friend.name === "陳太" && friend.phone === "92345678");
  ok("名額 1→2", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 2);
  ok("合共 240", db.prepare("SELECT SUM(amount) s FROM bookings WHERE schedule_id='s1' AND status='confirmed'").get().s === 240);
  ok("audit booking.upgraded_seats", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='booking.upgraded_seats'").get().n === 1);
  throws("重複電話", () => upgradeSeats(db, { bookingId: b, friendName: "陳太", friendPhone: "92345678", topUpAmount: 100, paymentReference: "FPS-2", actorId: "a" }), "FRIEND_PHONE_EXISTS");
  throws("金額不等於 100", () => upgradeSeats(db, { bookingId: b, friendName: "陳生", friendPhone: "93456789", topUpAmount: 90, paymentReference: "FPS-3", actorId: "a" }), "TOPUP_AMOUNT_INVALID");
  throws("缺 FPS 參考", () => upgradeSeats(db, { bookingId: b, friendName: "陳生", friendPhone: "93456789", topUpAmount: 100, paymentReference: "", actorId: "a" }), "PAYMENT_REF_REQUIRED");
  throws("電話格式錯", () => upgradeSeats(db, { bookingId: b, friendName: "陳生", friendPhone: "123", topUpAmount: 100, paymentReference: "FPS-4", actorId: "a" }), "FRIEND_PHONE_INVALID");
}

console.log("\n🧪 5. 加位失敗 → rollback");
{
  const db = makeDb(); const [b] = seed(db);
  db.prepare("UPDATE class_schedules SET enrolled_count=8 WHERE id='s1'").run();
  const before = db.prepare("SELECT COUNT(*) n FROM bookings").get().n;
  const usersBefore = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  throws("班次已滿", () => upgradeSeats(db, { bookingId: b, friendName: "陳太", friendPhone: "92345678", topUpAmount: 100, paymentReference: "FPS-X", actorId: "a" }), "CLASS_FULL");
  ok("冇新增 booking", db.prepare("SELECT COUNT(*) n FROM bookings").get().n === before);
  ok("冇新增用戶", db.prepare("SELECT COUNT(*) n FROM users").get().n === usersBefore);
}
{
  const db = makeDb(); seed(db, { paid: false });
  throws("未付款不可加位", () => upgradeSeats(db, { bookingId: "b1", friendName: "陳太", friendPhone: "92345678", topUpAmount: 100, paymentReference: "FPS-X", actorId: "a" }), "BOOKING_NOT_PAID");
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
