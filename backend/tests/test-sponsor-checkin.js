/**
 * 測試：子女代報名 + 現場簽到報平安
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { checkInBooking } = require("../src/services/admin-booking-actions");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, venue_name TEXT, coach_id TEXT);
  CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT);
  CREATE TABLE bookings (
    id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, class_id TEXT,
    status TEXT, payment_status TEXT, attendee_type TEXT DEFAULT 'self',
    parent_name TEXT, parent_phone TEXT, notify_sponsor_on_checkin INTEGER DEFAULT 0,
    checked_in_at TEXT, checkin_method TEXT
  );
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT,
    user_id TEXT, new_values TEXT, description TEXT, ip_address TEXT, user_agent TEXT, created_at TEXT);
`);
let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };
const throws = (n, fn, code) => { try { fn(); failed++; console.log("  ❌", n, "冇拋錯"); } catch (e) { ok(n + " → " + code, e.code === code, e.code + " " + e.message); } };

db.prepare("INSERT INTO users VALUES ('u1','陳小姐','91234567')").run();
db.prepare("INSERT INTO users VALUES ('coach','靜儀導師','90000000')").run();
db.prepare("INSERT INTO classes VALUES ('c1','樂齡深層伸展（平日）','青衣楓樹窩體育館','coach')").run();
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1','2026-11-09 02:30:00','2026-11-09 04:00:00')").run();

function addBooking(id, { notify = 1, paid = true, status = "confirmed", parent = "陳伯伯" } = {}) {
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,attendee_type,parent_name,parent_phone,notify_sponsor_on_checkin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, "ZP-" + id, "u1", "s1", "c1", status, paid ? "paid" : "pending", "parent", parent, "98765432", notify);
}

console.log("\n🧪 1. 簽到 + 報平安");
addBooking("b1");
const r = checkInBooking(db, { bookingId: "b1", actorId: "admin1" });
ok("狀態 attended", db.prepare("SELECT status FROM bookings WHERE id='b1'").get().status === "attended");
ok("checked_in_at 已寫", !!db.prepare("SELECT checked_in_at FROM bookings WHERE id='b1'").get().checked_in_at);
ok("sponsor 用付款人電話", r.sponsor && r.sponsor.phone === "91234567");
ok("wa.me 連結", r.sponsor && r.sponsor.wa_url.startsWith("https://wa.me/85291234567?text="));
ok("訊息有父母名", r.sponsor && r.sponsor.message.includes("陳伯伯"));
ok("訊息有下課時間", r.sponsor && r.sponsor.message.includes("12:00"));
ok("audit checked_in", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='booking.checked_in'").get().n === 1);
ok("audit sponsor_notified", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='checkin.sponsor_notified'").get().n === 1);

console.log("\n🧪 2. 重複簽到 / 未付款 / 未確認");
throws("已簽到", () => checkInBooking(db, { bookingId: "b1" }), "ALREADY_CHECKED_IN");
addBooking("b2", { paid: false });
throws("未付款", () => checkInBooking(db, { bookingId: "b2" }), "BOOKING_NOT_PAID");
addBooking("b3", { status: "pending_payment" });
throws("未確認", () => checkInBooking(db, { bookingId: "b3" }), "BOOKING_NOT_CONFIRMED");

console.log("\n🧪 3. 關閉通知");
addBooking("b4", { notify: 0 });
const r4 = checkInBooking(db, { bookingId: "b4" });
ok("照樣簽到", db.prepare("SELECT status FROM bookings WHERE id='b4'").get().status === "attended");
ok("冇 sponsor 連結", r4.sponsor === null);
ok("冇第二條 sponsor audit", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='checkin.sponsor_notified'").get().n === 1);

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
