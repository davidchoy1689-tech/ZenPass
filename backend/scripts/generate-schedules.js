#!/usr/bin/env node
/**
 * Generate future class schedules for all active classes
 * Each class gets 4 weekly time slots over the next 30 days
 */

const Database = require("better-sqlite3");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.join(__dirname, "../data/zenpass.db");
const db = new Database(DB_PATH);

// Helper: random int between min and max
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Time slots by category preference
const TIME_SLOTS = {
  default: ["09:00", "10:00", "14:00", "18:00", "19:00"],
  yoga: ["07:00", "08:00", "09:00", "17:00", "18:30"],
  dance: ["10:00", "14:00", "18:00", "19:00", "20:00"],
  fitness: ["06:30", "07:00", "12:00", "18:00", "19:00"],
  martial: ["18:00", "19:00", "20:00"],
};

// Duration by class
const DURATIONS = {
  default: 60,
};

const MAX_PARTICIPANTS = {
  default: 20,
  yoga: 25,
  fitness: 20,
  "one-on-one": 10,
};

console.log("🔍 Fetching active classes...");
const classes = db
  .prepare(
    "SELECT id, title, category, duration FROM classes WHERE status='active'",
  )
  .all();
console.log(`   Found ${classes.length} active classes`);

// Clear old past schedules (optional - keep them for history)
// Or we can keep them and just add new ones
const existingFutureCount = db
  .prepare(
    "SELECT COUNT(*) as c FROM class_schedules WHERE start_time >= datetime('now')",
  )
  .get().c;
console.log(`   Existing future schedules: ${existingFutureCount}`);

// Get current time
const now = new Date();

let created = 0;
let skipped = 0;

const insertStmt = db.prepare(`
  INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants, enrolled_count, status, notes)
  VALUES (?, ?, ?, ?, 'none', ?, 0, 'available', ?)
`);

const insertMany = db.transaction((schedules) => {
  for (const s of schedules) {
    insertStmt.run(
      s.id,
      s.class_id,
      s.start_time,
      s.end_time,
      s.max_participants,
      s.notes || "",
    );
  }
});

for (const cls of classes) {
  const cat = (cls.category || "").toLowerCase();
  const dur = cls.duration || 60;

  // Determine time slots for this class category
  let timeOpts = TIME_SLOTS.default;
  if (cat.includes("瑜伽") || cat.includes("yoga")) timeOpts = TIME_SLOTS.yoga;
  else if (cat.includes("舞蹈") || cat.includes("dance"))
    timeOpts = TIME_SLOTS.dance;
  else if (
    cat.includes("健身") ||
    cat.includes("fitness") ||
    cat.includes("hiit")
  )
    timeOpts = TIME_SLOTS.fitness;
  else if (cat.includes("拳") || cat.includes("搏擊"))
    timeOpts = TIME_SLOTS.martial;

  // Determine max participants
  let maxP = MAX_PARTICIPANTS.default;
  if (cat.includes("瑜伽")) maxP = MAX_PARTICIPANTS.yoga;
  else if (cat.includes("健身")) maxP = MAX_PARTICIPANTS.fitness;

  const schedules = [];
  const usedDays = new Set();

  // Generate 4 different days over next 30 days
  for (let i = 0; i < 4; i++) {
    let dayOffset;
    let attempts = 0;
    do {
      dayOffset = rand(3, 30); // Start 3 days from now, up to 30 days
      attempts++;
    } while (usedDays.has(dayOffset) && attempts < 20);
    usedDays.add(dayOffset);

    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    const dateStr = date.toISOString().split("T")[0];

    const timeSlot = timeOpts[rand(0, timeOpts.length - 1)];
    const startTime = `${dateStr}T${timeSlot}:00`;

    const endDate = new Date(date);
    const [h, m] = timeSlot.split(":").map(Number);
    endDate.setHours(h, m + dur);
    const endH = String(endDate.getHours()).padStart(2, "0");
    const endM = String(endDate.getMinutes()).padStart(2, "0");
    const endTime = `${dateStr}T${endH}:${endM}:00`;

    const venueNote = cls.title.includes("跑步")
      ? "海濱長廊"
      : cls.title.includes("瑜伽")
        ? "瑜伽教室"
        : cls.title.includes("HIIT")
          ? "健身室"
          : cls.title.includes("木柱") || cls.title.includes("Mölkky")
            ? "戶外草地"
            : "";

    schedules.push({
      id: uuidv4(),
      class_id: cls.id,
      start_time: startTime,
      end_time: endTime,
      max_participants: maxP,
      notes: venueNote || "",
    });
  }

  try {
    insertMany(schedules);
    created += schedules.length;
  } catch (err) {
    console.error(`   ❌ ${cls.title}: ${err.message}`);
    skipped++;
  }
}

console.log(
  `\n✅ Done! Created ${created} new schedules for ${classes.length} classes`,
);
db.close();
