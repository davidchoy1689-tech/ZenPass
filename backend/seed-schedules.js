// 快速 seed schedules 到 DB — 行一次就得
const Database = require("better-sqlite3");
const db = new Database("./data/zenpass.db");

// Check if class_schedules table exists
const hasTable = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='class_schedules'"
).get();

if (!hasTable) {
  console.log("Creating class_schedules table...");
  db.prepare(`
    CREATE TABLE class_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      enrolled_count INTEGER DEFAULT 0,
      max_participants INTEGER DEFAULT 15,
      status TEXT DEFAULT 'available'
    )
  `).run();
}

// Read courses.json for schedule data
const fs = require("fs");
const courses = JSON.parse(fs.readFileSync("./courses.json", "utf8")).classes;

let total = 0;
courses.forEach((c) => {
  const schedules = c.schedules || [];
  schedules.forEach((s) => {
    // Check if this schedule already exists
    const existing = db
      .prepare("SELECT id FROM class_schedules WHERE class_id = ? AND start_time = ?")
      .get(c.id, s.start_time || s.date);
    if (!existing) {
      db.prepare(`
        INSERT INTO class_schedules (class_id, start_time, end_time, enrolled_count, max_participants, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        c.id,
        s.start_time || s.date,
        s.end_time || s.date,
        s.enrolled_count || 0,
        s.max_participants || 15,
        s.status || "available"
      );
      total++;
    }
  });
});

// Also ensure courses exist in the classes table
courses.forEach((c) => {
  const existing = db.prepare("SELECT id FROM classes WHERE id = ?").get(c.id);
  if (!existing) {
    db.prepare(`
      INSERT INTO classes (id, title, category, difficulty, duration, max_participants, price_hkd, credits_cost, status, description, coach_name, venue_name, venue_address, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.id, c.title, c.category, c.difficulty || "beginner",
      c.duration_min || 60, c.max_participants || 15,
      c.price_hkd || 100, c.credits_cost || 12,
      c.status || "active", c.description || "",
      c.coach_name || "", c.venue_name || "",
      c.venue_address || "", c.image_url || ""
    );
  }
});

db.close();
console.log(`✅ Seeded: ${total} schedules, ${courses.length} courses`);
