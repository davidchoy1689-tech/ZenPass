const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const db = new Database("./data/zenpass.db");
const courses = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "courses.json"), "utf8")).classes;

// Disable FK checks temporarily for seeding
db.pragma("foreign_keys = OFF");

// Check/create class_schedules table
const hasSchedTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='class_schedules'").get();
if (!hasSchedTable) {
  console.log("Creating class_schedules table...");
  db.prepare("CREATE TABLE class_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, enrolled_count INTEGER DEFAULT 0, max_participants INTEGER DEFAULT 15, status TEXT DEFAULT 'available', FOREIGN KEY (class_id) REFERENCES classes(id))").run();
} else {
  // Check if FK is enforced
  const fkList = db.prepare("PRAGMA foreign_key_list(class_schedules)").all();
  console.log("FKs:", fkList.length > 0 ? "enabled" : "none");
}

// Get existing classes IDs
var existingClassIds = new Set();
db.prepare("SELECT id FROM classes").all().forEach(function(r) {
  existingClassIds.add(parseInt(r.id));
});

var schedCount = 0;
var classCount = 0;

courses.forEach(function(c) {
  var cid = parseInt(c.id);
  
  // Insert course if not exists (minimal data for FK)
  if (!existingClassIds.has(cid)) {
    try {
      db.prepare("INSERT INTO classes (id, title, enrolled_count, capacity, status) VALUES (?, ?, ?, ?, ?)").run(
        cid, c.title, 0, c.max_participants || 15, c.status || "active"
      );
      classCount++;
      existingClassIds.add(cid);
    } catch(e) {
      // row may already exist
    }
  }
  
  // Insert schedules
  var scheds = c.schedules || [];
  scheds.forEach(function(s) {
    try {
      db.prepare("INSERT INTO class_schedules (class_id, start_time, end_time, enrolled_count, max_participants, status) VALUES (?, ?, ?, ?, ?, ?)").run(
        cid, s.start_time || s.date, s.end_time || s.date,
        s.enrolled_count || 0, s.max_participants || 15, s.status || "available"
      );
      schedCount++;
    } catch(e) {
      console.log("SKIP:", e.message.substring(0, 60), "for", cid, s.start_time);
    }
  });
});

db.pragma("foreign_keys = ON");
db.close();
console.log("✅ " + classCount + " courses, " + schedCount + " schedules inserted");
