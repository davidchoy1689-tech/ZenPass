/**
 * 客服補救工具：人手延長鎖位＋還原已取消訂單
 * 對應 SOP：60 分鐘錢到位無位嘅補救
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { extendHold, restoreBooking, searchRestorable } = require("../src/services/hold-control");
const { releaseExpiredHolds } = require("../src/services/booking-service");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };
const throws = (n, fn, code) => { try { fn(); failed++; console.log("  ❌", n, "冇拋錯"); } catch (e) { ok(n + " → " + code, e.code === code, e.code + " " + e.message); } };

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT,
      enrolled_count INTEGER DEFAULT 0, max_participants INTEGER DEFAULT 8, status TEXT DEFAULT 'scheduled');
    CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, class_id TEXT,
      status TEXT, payment_status TEXT, amount REAL, group_size INTEGER DEFAULT 1,
      fps_reference TEXT, payme_reference TEXT, payment_reported_at TEXT,
      payment_claimed INTEGER DEFAULT 0, payment_claimed_at TEXT, hold_until TEXT,
      cancel_reason TEXT, child_name TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT,
      user_id TEXT, old_values TEXT, new_values TEXT, description TEXT, created_at TEXT);
  `);
  d.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001')").run();
  d.prepare("INSERT INTO classes VALUES ('c1','芬蘭木柱體驗班')").run();
  d.prepare("INSERT INTO class_schedules VALUES ('s1','c1',datetime('now','+2 days'),0,8,'scheduled')").run();
  d.prepare("INSERT INTO class_schedules VALUES ('s2','c1',datetime('now','+3 days'),8,8,'scheduled')").run();
  d.prepare("INSERT INTO class_schedules VALUES ('s3','c1',datetime('now','+4 days'),0,8,'cancelled')").run();
  return d;
}
const add = (d, id, status = "pending_payment", sched = "s1", extra = {}) => {
  const b = { status, payment_status: status === "confirmed" ? "paid" : "pending", amount: 140, ...extra };
  d.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,
      group_size,fps_reference,payment_claimed,payment_claimed_at,hold_until,cancel_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, "ZP-" + id, "u1", sched, "c1", b.status, b.payment_status, b.amount,
    b.group_size || 1, b.fps_reference || null, b.payment_claimed || 0,
    b.payment_claimed_at || null, b.hold_until || null, b.cancel_reason || null,
  );
};

console.log("\n🧪 1. 人手延長鎖位");
{
  const d = db(); add(d, "b1");
  const r = extendHold(d, { bookingId: "b1", minutes: 60, actorId: "admin1" });
  ok("回傳 hold_until", !!r.hold_until && r.minutes === 60);
  ok("寫入 DB", !!d.prepare("SELECT hold_until h FROM bookings WHERE id='b1'").get().h);
  ok("audit booking.hold_extended",
    d.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='booking.hold_extended'").get().n === 1);
}
{
  const d = db(); add(d, "b1");
  throws("已確認訂單不可延長", () => { add(d, "bx", "confirmed"); extendHold(d, { bookingId: "bx" }); }, "NOT_PENDING");
  throws("不存在訂單", () => extendHold(d, { bookingId: "nope" }), "BOOKING_NOT_FOUND");
}

console.log("\n🧪 2. 延長後唔會被 30 分鐘排程釋放");
{
  const d = db(); add(d, "b1");
  d.prepare("UPDATE bookings SET created_at=datetime('now','-45 minutes') WHERE id='b1'").run();
  releaseExpiredHolds(d, "s1");
  ok("冇延長 → 45 分鐘已被取消", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "cancelled");
}
{
  const d = db(); add(d, "b1");
  d.prepare("UPDATE bookings SET created_at=datetime('now','-45 minutes') WHERE id='b1'").run();
  extendHold(d, { bookingId: "b1", minutes: 60 });
  releaseExpiredHolds(d, "s1");
  ok("已延長 → 保留 pending_payment", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "pending_payment");
  d.prepare("UPDATE bookings SET hold_until=datetime('now','-1 minutes') WHERE id='b1'").run();
  releaseExpiredHolds(d, "s1");
  ok("延長過後 → 仍按規則取消", d.prepare("SELECT status s FROM bookings WHERE id='b1'").get().s === "cancelled");
}

console.log("\n🧪 3. 還原已取消訂單");
{
  const d = db(); add(d, "b1", "cancelled", "s1", { cancel_reason: "系統釋放" });
  const r = restoreBooking(d, { bookingId: "b1", reason: "客人已入數", actorId: "admin1" });
  ok("狀態 confirmed", r.status === "confirmed" && r.payment_status === "paid");
  const b = d.prepare("SELECT * FROM bookings WHERE id='b1'").get();
  ok("DB 已更新＋清 cancel_reason", b.status === "confirmed" && b.payment_status === "paid" && !b.cancel_reason);
  ok("enrolled_count +1", d.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 1);
  ok("audit booking.restored",
    d.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='booking.restored'").get().n === 1);
}
{
  const d = db(); add(d, "b1", "cancelled");
  const r = restoreBooking(d, { bookingId: "b1", reason: "未收到錢先保位", markPaid: false });
  ok("markPaid=false 保持 pending", r.payment_status === "pending");
}
{
  const d = db(); add(d, "b1", "cancelled", "s1", { group_size: 2 });
  restoreBooking(d, { bookingId: "b1", reason: "兩位同行補回" });
  ok("同行 2 位 → enrolled_count +2", d.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 2);
}

console.log("\n🧪 4. 還原防線");
{
  const d = db(); add(d, "b1", "cancelled", "s2");
  throws("滿班不可還原", () => restoreBooking(d, { bookingId: "b1", reason: "客人已入數" }), "CLASS_FULL");
}
{
  const d = db(); add(d, "b1", "cancelled"); add(d, "b2", "confirmed");
  throws("同班已有有效預約", () => restoreBooking(d, { bookingId: "b1", reason: "客人已入數" }), "DUPLICATE_BOOKING");
}
{
  const d = db(); add(d, "b1", "cancelled");
  throws("原因太短", () => restoreBooking(d, { bookingId: "b1", reason: "ok" }), "REASON_REQUIRED");
}
{
  const d = db(); add(d, "b1", "cancelled", "s3");
  throws("課堂已取消", () => restoreBooking(d, { bookingId: "b1", reason: "客人已入數" }), "SCHEDULE_CANCELLED");
}
{
  const d = db(); add(d, "b1", "cancelled");
  d.prepare("UPDATE class_schedules SET start_time=datetime('now','-1 hour') WHERE id='s1'").run();
  throws("已開課不可還原", () => restoreBooking(d, { bookingId: "b1", reason: "客人已入數" }), "SCHEDULE_STARTED");
  const r = restoreBooking(d, { bookingId: "b1", reason: "客人已入數（主管批准）", force: true });
  ok("force=true 可強制還原", r.status === "confirmed");
}
{
  const d = db(); add(d, "b1", "confirmed");
  throws("非取消狀態", () => restoreBooking(d, { bookingId: "b1", reason: "客人已入數" }), "NOT_CANCELLED");
}

console.log("\n🧪 5. 搜尋可還原訂單");
{
  const d = db(); add(d, "b1", "cancelled"); add(d, "b2", "confirmed");
  const byRef = searchRestorable(d, { q: "ZP-b1" });
  ok("搵到參考編號", byRef.length === 1 && byRef[0].booking_id === "b1");
  const byPhone = searchRestorable(d, { q: "98770001" });
  ok("搵到電話（只列已取消）", byPhone.length === 1 && byPhone[0].booking_id === "b1");
  ok("太短字串唔搜", searchRestorable(d, { q: "Z" }).length === 0);
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
