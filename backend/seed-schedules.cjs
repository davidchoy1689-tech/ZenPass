const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const db = new Database("./data/zenpass.db");
const courses = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "courses.json"), "utf8")).classes;

// Classes columns: id, title, enrolled_count, capacity, status
const cols = db.prepare("PRAGMA table_info(classes)").all();
console.log("Classes:", cols.map(c => c.name).join(", "));

// Check/create schedules table
const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='class_schedules'").get();
if (!hasTable) {
  console.log("Creating class_schedules table...");
  db.prepare("CREATE TABLE class_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, enrolled_count INTEGER DEFAULT 0, max_participants INTEGER DEFAULT 15, status TEXT DEFAULT 'available')").run();
}

let total = 0;
const existingSchedules = new Set();
db.prepare("SELECT class_id, start_time FROM class_schedules").all().forEach(function(r) {
  existingSchedules.add(r.class_id + "_" + r.start_time);
});

courses.forEach(function(c) {
  var scheds = c.schedules || [];
  scheds.forEach(function(s) {
    var key = c.id + "_" + (s.start_time || s.date);
    if (!existingSchedules.has(key)) {
      try {
        db.prepare("INSERT INTO class_schedules (class_id, start_time, end_time, enrolled_count, max_participants, status) VALUES (?, ?, ?, ?, ?, ?)").run(
          parseInt(c.id), s.start_time || s.date, s.end_time || s.date,
          s.enrolled_count || 0, s.max_participants || 15, s.status || "available"
        );
        total++;
      } catch(e) {
        console.log("Error:", e.message, "for", c.id, s.start_time);
      }
    }
  });
});

db.close();
console.log("Done: " + total + " schedules seeded");
