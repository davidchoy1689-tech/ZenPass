// Seed test bookings for testing
const Database = require("better-sqlite3");
const crypto = require("crypto");
const db = new Database("./data/zenpass.db");

const sched = db
  .prepare("SELECT id, class_id FROM class_schedules LIMIT 1")
  .get();
const student = db
  .prepare("SELECT id FROM users WHERE email='student@zenpass.hk'")
  .get();

if (!sched || !student) {
  console.log("Missing schedule or student user");
  process.exit(1);
}

// Clean existing bookings
db.prepare("DELETE FROM bookings").run();

// Create confirmed booking
const bookingId = crypto.randomUUID();
db.prepare(
  "INSERT INTO bookings (id, booking_reference, schedule_id, class_id, user_id, payment_type, payment_status, status, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
).run(
  bookingId,
  "ZP-100001",
  sched.id,
  sched.class_id,
  student.id,
  "single",
  "paid",
  "confirmed",
  100,
);
console.log("Created confirmed booking: ZP-100001");

// Create pending payment booking
const bookingId2 = crypto.randomUUID();
db.prepare(
  "INSERT INTO bookings (id, booking_reference, schedule_id, class_id, user_id, payment_type, payment_status, status, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
).run(
  bookingId2,
  "ZP-100002",
  sched.id,
  sched.class_id,
  student.id,
  "single",
  "pending",
  "pending_payment",
  100,
);
console.log("Created pending booking: ZP-100002");

// Update enrolled count
db.prepare(
  "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ?",
).run(sched.id);

console.log("Done");
