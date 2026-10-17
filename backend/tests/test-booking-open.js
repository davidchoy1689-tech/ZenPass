/**
 * Test: 未開放預約 / 過期課程（booking_open + is_expired + 7 日保留）
 * 以 temp DB 驗證 SQL 語意（NULL 處理）+ 前端標記
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-booking-open-" + Date.now() + ".db");
process.env.DB_PATH = tmp;
process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : "test_secret_key_0123456789abcdef";

const db = new Database(tmp);
db.exec(`
CREATE TABLE classes (id TEXT PRIMARY KEY, coach_id TEXT, title TEXT, category TEXT, status TEXT, booking_open INTEGER DEFAULT 0, district TEXT);
CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT, enrolled_count INTEGER, max_participants INTEGER, status TEXT);
`);
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString().replace("T", " ").replace("Z", "");

// 1) 未來課程 + 開放預約
db.prepare("INSERT INTO classes (id,title,category,status,booking_open) VALUES (?,?,?,?,?)").run("open", "伸展班", "伸展", "active", 1);
db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?)").run("s1", "open", iso(86400000), iso(86400000 + 3600000), 0, 10, "available");
// 2) 未來課程但未開放（其他活動）
db.prepare("INSERT INTO classes (id,title,category,status,booking_open) VALUES (?,?,?,?,?)").run("locked", "匹克球", "新興運動", "active", 0);
db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?)").run("s2", "locked", iso(2 * 86400000), iso(2 * 86400000 + 3600000), 0, 10, "available");
// 3) 已完結 3 日（仍保留，灰色）
db.prepare("INSERT INTO classes (id,title,category,status,booking_open) VALUES (?,?,?,?,?)").run("recent", "完結班", "伸展", "active", 1);
db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?)").run("s3", "recent", iso(-3 * 86400000), iso(-3 * 86400000 + 3600000), 5, 10, "available");
// 4) 已完結 10 日（應被隱藏）
db.prepare("INSERT INTO classes (id,title,category,status,booking_open) VALUES (?,?,?,?,?)").run("old", "過期班", "伸展", "active", 1);
db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?)").run("s4", "old", iso(-10 * 86400000), iso(-10 * 86400000 + 3600000), 5, 10, "available");
// 5) 完全冇時段（應保留，未開放）
db.prepare("INSERT INTO classes (id,title,category,status,booking_open) VALUES (?,?,?,?,?)").run("nosched", "即將推出", "新興運動", "active", 0);
db.close();

// === 與 backend/src/routes/classes.js 相同嘅 predicate ===
const DB = new Database(tmp);
const LAST_END = "(SELECT MAX(cs.end_time) FROM class_schedules cs WHERE cs.class_id = c.id)";
const rows = DB.prepare(`
  SELECT c.id, c.booking_open,
    ${LAST_END} as last_session_end,
    CASE WHEN ${LAST_END} IS NOT NULL AND ${LAST_END} < datetime('now') THEN 1 ELSE 0 END as is_expired
  FROM classes c
  WHERE c.status = 'active' AND (${LAST_END} IS NULL OR ${LAST_END} >= datetime('now','-7 days'))
  ORDER BY c.id
`).all();

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };
const ids = rows.map((r) => r.id).sort();
eq(ids.join(","), "locked,nosched,open,recent", "visible classes (old 10d hidden)");

const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
eq(byId.open.is_expired, 0, "open not expired");
eq(byId.open.booking_open, 1, "open bookable");
eq(byId.locked.booking_open, 0, "locked not bookable");
eq(byId.recent.is_expired, 1, "recent (3d) expired=1 but still visible");
eq(byId.nosched.is_expired, 0, "no-schedule not expired");
eq(byId.nosched.booking_open, 0, "no-schedule not bookable");
DB.close();

// 自動歸檔 predicate（只歸檔完結 >7 日）
const DB2 = new Database(tmp);
const arc = DB2.prepare(`
  UPDATE classes SET status='inactive'
  WHERE status='active'
    AND EXISTS (SELECT 1 FROM class_schedules cs WHERE cs.class_id = classes.id)
    AND (SELECT MAX(cs.end_time) FROM class_schedules cs WHERE cs.class_id = classes.id) < datetime('now','-7 days')
`).run();
eq(arc.changes, 1, "archive only the >7d class");
eq(DB2.prepare("SELECT status FROM classes WHERE id='recent'").get().status, "active", "3d class stays active");
eq(DB2.prepare("SELECT status FROM classes WHERE id='old'").get().status, "inactive", "10d class archived");
DB2.close();

// 前端標記
const root = path.join(__dirname, "../../frontend-v2");
const exp = fs.readFileSync(path.join(root, "explore.html"), "utf8");
const det = fs.readFileSync(path.join(root, "class-detail.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");
const has = (s, m, l) => { if (!s.includes(m)) fails.push("missing " + (l || "") + ": " + m); };
has(exp, "暫未開放預約", "explore locked label");
has(exp, "expired ? \" expired\"", "explore expired class");
has(exp, 'tag-gray', "expired tag");
has(exp, 'tag-lock', "lock tag");
has(det, "暫未開放預約", "detail locked label");
has(det, "已完結", "detail expired label");
has(css, ".card.expired", "grey css");
has(css, ".tag-lock", "tag css");

fs.unlinkSync(tmp);
if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ 未開放預約 / 過期課程 tests passed");
