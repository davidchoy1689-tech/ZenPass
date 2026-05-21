const Database = require("better-sqlite3");
const db = new Database("./data/zenpass.db");
const fs = require("fs");
const crypto = require("crypto");

db.pragma("foreign_keys = OFF"); // Temporarily disable FK for seeding

const data = JSON.parse(fs.readFileSync("../frontend/courses.json", "utf8"));
const classes = data.classes;

// Create a coach user if not exists
let coach = db
  .prepare("SELECT id FROM users WHERE email='coach@zenpass.hk'")
  .get();
if (!coach) {
  const id = crypto.randomUUID();
  db.prepare(
    `
    INSERT INTO users (id, email, name, phone, is_coach, coach_verified, credits, membership_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, "coach@zenpass.hk", "靜儀導師", "9234 5678", 1, 1, 0, "none");
  coach = { id };
}

// Update David to admin/coach
db.prepare(
  "UPDATE users SET is_coach = 1 WHERE email='david@zenpass.hk'",
).run();

// Clean existing data
db.prepare("DELETE FROM class_schedules").run();
db.prepare("DELETE FROM classes").run();

const insertClass = db.prepare(`
  INSERT INTO classes (id, coach_id, title, description, category, difficulty, duration, max_participants, price_hkd, venue_name, venue_address, status, class_reference)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSchedule = db.prepare(`
  INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const transaction = db.transaction(() => {
  let count = 0;
  for (const cls of classes) {
    const refNum = String(count + 1000).padStart(5, '0');
    insertClass.run(
      String(cls.id),
      coach.id,
      cls.title,
      cls.desc || "",
      cls.category,
      cls.difficulty || "beginner",
      cls.duration_min || 60,
      cls.capacity || 15,
      cls.price_hkd || 0,
      cls.location || "",
      cls.address || "",
      cls.status === "draft" ? "inactive" : cls.status || "active",
      'CL-' + refNum,
    );

    for (const sched of cls.schedules || []) {
      insertSchedule.run(
        sched.id,
        String(cls.id),
        sched.start_time,
        sched.end_time,
        sched.max_participants,
        0,
        sched.status, // reset enrolled_count to 0, use actual bookings count
      );
    }
    count++;
  }
  return count;
});

const count = transaction();
console.log("✅ Seeded " + count + " classes with schedules");

// Verify
const clsCount = db.prepare("SELECT COUNT(*) as c FROM classes").get();
const schedCount = db
  .prepare("SELECT COUNT(*) as c FROM class_schedules")
  .get();
console.log("Classes:", clsCount.c, "Schedules:", schedCount.c);

db.pragma("foreign_keys = ON");
db.close();
