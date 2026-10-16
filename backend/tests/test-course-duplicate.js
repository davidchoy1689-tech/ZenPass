/**
 * Test: 課程一鍵複製 duplicateCourse（連時段、按期間搬移）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-dup-test-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, partner_id TEXT);
CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, email TEXT, user_id TEXT, status TEXT);
CREATE TABLE classes (id TEXT PRIMARY KEY, coach_id TEXT, title TEXT, description TEXT, category TEXT, difficulty TEXT,
  duration INTEGER, max_participants INTEGER, price_hkd REAL, credits_cost INTEGER, venue_name TEXT, venue_address TEXT,
  target_audience TEXT, image_url TEXT, partner_venue_id TEXT, partner_id TEXT, district TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT, max_participants INTEGER,
  enrolled_count INTEGER, status TEXT, created_at TEXT);
`);
db.prepare("INSERT INTO users VALUES (?,?,?)").run("u1", "owner@example.com", "v1");
db.prepare("INSERT INTO partner_venues VALUES (?,?,?,?,?,?)").run("v1", "康樂中心", "1 號街", "owner@example.com", "u1", "active");
db.prepare("INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
  "c1", "co1", "芬蘭木柱班", "desc", "新興運動", "beginner", 60, 12, 120, 12, "康樂中心", "1 號街", "成人", null, "v1", "v1", "沙田", "active", "2026-10-01", "2026-10-01",
);
db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?,?)").run("s1", "c1", "2026-10-06T11:00:00.000Z", "2026-10-06T12:00:00.000Z", 12, 0, "available", "2026-10-01");
db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?,?)").run("s2", "c1", "2026-10-13T11:00:00.000Z", "2026-10-13T12:00:00.000Z", 12, 0, "available", "2026-10-01");
db.close();

const svc = require("/Users/user/.openclaw/workspace/zenpass-platform/backend/src/services/partner-service.js");

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

// 1. 複製 1 期，間隔 7 日
const r1 = svc.duplicateCourse("u1", "c1", { copies: 1, shift_days: 7, title_suffix: "（11 月）" });
eq(r1.status, 201, "status 201");
eq(r1.body.schedules_count, 2, "copied 2 schedules");
if (!/（11 月）/.test(r1.body.title)) fails.push("title suffix not applied: " + r1.body.title);

const db2 = new Database(tmp);
const sched = db2.prepare("SELECT * FROM class_schedules WHERE class_id = ? ORDER BY start_time").all(r1.body.class_id);
eq(sched.length, 2, "new class has 2 schedules");
eq(sched[0].start_time, "2026-10-13T11:00:00.000Z", "s1 shifted +7d");
eq(sched[1].start_time, "2026-10-20T11:00:00.000Z", "s2 shifted +7d");
// 原課程不受影響
eq(db2.prepare("SELECT COUNT(*) c FROM class_schedules WHERE class_id='c1'").get().c, 2, "source unchanged");
// 新課程 metadata 一致
const nc = db2.prepare("SELECT * FROM classes WHERE id = ?").get(r1.body.class_id);
eq(nc.category, "新興運動", "category copied");
eq(nc.price_hkd, 120, "price copied");
eq(nc.partner_id, "v1", "partner_id set");
eq(nc.district, "沙田", "district copied");
db2.close();

// 2. 複製 2 期 → 4 個時段
const r2 = svc.duplicateCourse("u1", "c1", { copies: 2, shift_days: 14 });
eq(r2.body.schedules_count, 4, "copies=2 → 4 schedules");

// 3. 非本人課程 → 404
const r3 = svc.duplicateCourse("u1", "nonexistent", {});
eq(r3.status, 404, "unknown course 404");

// 4. 唔複製時段
const r4 = svc.duplicateCourse("u1", "c1", { copy_schedules: false });
eq(r4.body.schedules_count, 0, "copy_schedules=false → 0");

fs.unlinkSync(tmp);
if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ duplicateCourse tests passed");
