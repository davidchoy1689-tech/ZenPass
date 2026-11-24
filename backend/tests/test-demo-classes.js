/**
 * Test: 示範課程（demo-*）— 大量示範班次、可一次過清除、唔可以真收錢
 *
 * 以 temp DB 驗證：
 *   1. restore 建 40 個 is_demo 課程 + 未來時段（公開展示）
 *   2. 唔會寫入任何金錢表（bookings / wallet_transactions / coach_earnings）
 *   3. purge 一次過清除課程＋時段（連 waitlist）
 *   4. 有真實預約嘅示範課程 → 只設 inactive，保留審計鏈
 *   5. 後端 booking guard（DEMO_CLASS）＋ 前端示範提示存在（靜態檢查）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-demo-" + Date.now() + ".db");
const SCRIPT = path.join(__dirname, "..", "scripts", "demo-data.js");
const run = (cmd) => {
  const r = spawnSync("node", [SCRIPT, cmd], {
    env: { ...process.env, DB_PATH: tmp },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return String(r.stdout || "") + String(r.stderr || "");
};

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log("  ✅ " + msg);
  } else {
    fail++;
    console.log("  ❌ " + msg);
  }
};

// ---- 建 temp DB（最少欄位；模擬生產舊 DB 未有 is_demo 欄）----
const db = new Database(tmp);
db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, password_hash TEXT,
  is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0, role TEXT DEFAULT 'user',
  coach_headline TEXT, coach_slug TEXT, lead_source TEXT, email_verified INTEGER DEFAULT 0,
  agree_terms INTEGER DEFAULT 0, penalty_consent INTEGER DEFAULT 0, tags TEXT);
CREATE TABLE classes (
  id TEXT PRIMARY KEY, coach_id TEXT, title TEXT NOT NULL, category TEXT NOT NULL,
  description TEXT, duration INTEGER, price_hkd REAL, credits_cost INTEGER,
  max_participants INTEGER, min_participants INTEGER, venue_name TEXT, venue_address TEXT,
  district TEXT, target_audience TEXT, target_audience_enum TEXT, target_audience_label TEXT,
  difficulty TEXT, sport_slug TEXT, equipment TEXT, booking_open INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT
);
CREATE TABLE class_schedules (
  id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT,
  max_participants INTEGER, enrolled_count INTEGER DEFAULT 0, status TEXT DEFAULT 'available',
  booking_open INTEGER, min_threshold INTEGER, coach_id TEXT, title TEXT
);
CREATE TABLE bookings (id TEXT PRIMARY KEY, class_id TEXT, schedule_id TEXT, user_id TEXT, status TEXT);
CREATE TABLE coach_earnings (id TEXT PRIMARY KEY, class_id TEXT, coach_id TEXT, amount REAL);
CREATE TABLE waitlist (id TEXT PRIMARY KEY, schedule_id TEXT, user_id TEXT, status TEXT);
`);
db.prepare("INSERT INTO users (id,email,name) VALUES (?,?,?)").run("u1", "coach.mindbody@zenpass.hk", "蔡振輝");
db.prepare("INSERT INTO users (id,email,name) VALUES (?,?,?)").run("u2", "coach@zenpass.hk", "靜儀導師");
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,price_hkd,status,created_at,updated_at) VALUES ('real-1','u1','真實伸展班','身心伸展',140,'active',datetime('now'),datetime('now'))",
).run();
db.close();

// ---- 1) restore ----
console.log("\n[1] restore 建示範課程");
const out1 = run("restore");
ok(/已建立 40 個示範課程/.test(out1), "建立 40 個示範課程");
ok(/公開展示/.test(out1), "預設公開展示");

const DB = new Database(tmp);
const demoCount = DB.prepare("SELECT COUNT(*) c FROM classes WHERE is_demo=1").get().c;
const activeDemo = DB.prepare("SELECT COUNT(*) c FROM classes WHERE is_demo=1 AND status='active' AND booking_open=1").get().c;
const futureSched = DB
  .prepare(
    `SELECT COUNT(*) c FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
      WHERE c.is_demo=1 AND datetime(cs.start_time) > datetime('now') AND cs.status='full' AND cs.booking_open=1`,
  )
  .get().c;
const demoPrefix = DB.prepare("SELECT COUNT(*) c FROM classes WHERE id LIKE 'demo-%'").get().c;
ok(demoCount === 40, "40 個 is_demo=1");
ok(activeDemo === 40, "40 個 active + booking_open=1");
ok(demoPrefix === 40, "40 個 id 前綴 demo-");
ok(futureSched >= 300, `未來可預約時段 >= 300（實際 ${futureSched}）`);

// 全部時段已滿（enrolled = max）→ 只可候補
const notFull = DB
  .prepare(
    `SELECT COUNT(*) c FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
      WHERE c.is_demo=1 AND (cs.status <> 'full' OR cs.enrolled_count <> cs.max_participants)`,
  )
  .get().c;
ok(notFull === 0, "所有示範時段已滿（enrolled = max、status=full）");

// 示範教練：虛構帳號，唔會用真實教練名
const demoCoaches = DB.prepare("SELECT id, name, email FROM users WHERE email LIKE 'demo.coach%@zenpass.hk'").all();
ok(demoCoaches.length === 8, `8 位示範教練（實際 ${demoCoaches.length}）`);
const realCoachUsed = DB
  .prepare(
    `SELECT COUNT(*) c FROM classes c JOIN users u ON u.id=c.coach_id
      WHERE c.is_demo=1 AND u.email IN ('coach@zenpass.hk','coach.mindbody@zenpass.hk')`,
  )
  .get().c;
ok(realCoachUsed === 0, "示範班冇用真實教練（蔡振輝／靜儀）");

const cats = DB.prepare("SELECT COUNT(DISTINCT category) c FROM classes WHERE is_demo=1").get().c;
ok(cats >= 6, `分類 >= 6 種（實際 ${cats}）`);
const districts = DB.prepare("SELECT COUNT(DISTINCT district) c FROM classes WHERE is_demo=1").get().c;
ok(districts >= 10, `地區 >= 10 個（實際 ${districts}）`);
const priceBad = DB.prepare("SELECT COUNT(*) c FROM classes WHERE is_demo=1 AND (price_hkd<=0 OR credits_cost<=0)").get().c;
ok(priceBad === 0, "冇 $0 / 0 credit 示範課程");
const noVenue = DB.prepare("SELECT COUNT(*) c FROM classes WHERE is_demo=1 AND (COALESCE(venue_name,'')='' OR COALESCE(district,'')='')").get().c;
ok(noVenue === 0, "每個示範課程有場地＋地區");

// 時段必須係未來（唔會一排「已完結」）
const pastSched = DB
  .prepare(
    `SELECT COUNT(*) c FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
      WHERE c.is_demo=1 AND datetime(cs.start_time) <= datetime('now')`,
  )
  .get().c;
ok(pastSched === 0, "冇過去時段");

// ---- 2) 金錢表未被寫入 ----
console.log("\n[2] 唔碰金錢表");
["bookings", "coach_earnings"].forEach((t) => {
  ok(DB.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c === 0, `${t} 仍然 0 筆`);
});

// ---- 3) status ----
console.log("\n[3] status 報告");
const out3 = run("status");
ok(/示範課程：40 個（公開中：40）/.test(out3), "status 正確顯示 40／40");
ok(/真實課程：1 個/.test(out3), "status 分得清真實課程");

// ---- 4) 有真實預約 → purge 只隱藏，唔刪 ----
console.log("\n[4] 有預約時 purge 保留審計");
const demoId = DB.prepare("SELECT id FROM classes WHERE is_demo=1 ORDER BY id LIMIT 1").get().id;
DB.prepare("INSERT INTO bookings (id,class_id,user_id,status) VALUES ('bk1',?,?,'confirmed')").run(demoId, "u1");
const out4 = run("purge");
ok(/唔會刪除/.test(out4), "偵測到預約 → 拒絕刪除");
const still = DB.prepare("SELECT status, booking_open, is_demo FROM classes WHERE id=?").get(demoId);
ok(!!still && still.status === "inactive" && still.booking_open === 0 && still.is_demo === 1, "該班設 inactive 並保留 is_demo");

DB.prepare("DELETE FROM bookings WHERE id='bk1'").run(); // 測試清理（temp DB）

// ---- 5) purge 全清 ----
console.log("\n[5] purge 一次過清除");
DB.prepare("INSERT INTO waitlist (id,schedule_id,user_id,status) VALUES ('w1',(SELECT id FROM class_schedules WHERE class_id=? LIMIT 1),'u1','waiting')").run(demoId);
const out5 = run("purge");
ok(/已清除 40 個示範課程/.test(out5), "清除 40 個示範課程");
ok(DB.prepare("SELECT COUNT(*) c FROM classes WHERE is_demo=1").get().c === 0, "冇殘留 is_demo 課程");
ok(DB.prepare("SELECT COUNT(*) c FROM classes WHERE id LIKE 'demo-%'").get().c === 0, "冇殘留 demo- 課程");
ok(DB.prepare("SELECT COUNT(*) c FROM class_schedules WHERE class_id LIKE 'demo-%'").get().c === 0, "冇殘留時段");
ok(DB.prepare("SELECT COUNT(*) c FROM waitlist").get().c === 0, "示範時段嘅候補紀錄亦已清");
ok(DB.prepare("SELECT COUNT(*) c FROM classes WHERE id='real-1'").get().c === 1, "真實課程完好無損");
ok(DB.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE 'demo.coach%@zenpass.hk'").get().c === 0, "示範教練帳號已清");
ok(DB.prepare("SELECT COUNT(*) c FROM users WHERE email IN ('coach@zenpass.hk','coach.mindbody@zenpass.hk')").get().c === 2, "真實教練保留");

// ---- 6) 靜態檢查：後端 + 前端有示範 guard ----
console.log("\n[6] 示範班收款防線");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bookingSvc = read("src/services/booking-service.js");
ok(/DEMO_CLASS/.test(bookingSvc) && /is_demo/.test(bookingSvc), "booking-service 有 DEMO_CLASS guard");
const guest = read("src/routes/guest.js");
ok(/DEMO_CLASS/.test(guest), "guest /book 有 DEMO_CLASS guard");
const bookingHtml = read(path.join("..", "frontend-v2", "booking.html"));
ok(/renderDemoClass/.test(bookingHtml) && /guest-join/.test(bookingHtml), "booking.html 有候補留名表單");
const detailHtml = read(path.join("..", "frontend-v2", "detail.html"));
ok(/applyDemoMode/.test(detailHtml) && /is_demo/.test(detailHtml), "detail.html 示範模式");
ok(/guest-join/.test(detailHtml), "detail.html 免登入候補");
const waitlistRoute = read("src/routes/waitlist.js");
ok(/router\.post\("\/guest-join"/.test(waitlistRoute), "waitlist 有 guest-join API");
const exploreHtml = read(path.join("..", "frontend-v2", "explore.html"));
ok(/allFutureFull/.test(exploreHtml) && /可留名候補/.test(exploreHtml), "explore 卡片顯示已滿／候補");
const migrate = read("src/services/migrate-schema.js");
ok(/addColumnIfMissing\(db, "classes", "is_demo"/.test(migrate), "migrate-schema 有 is_demo 欄");

DB.close();
fs.unlinkSync(tmp);

console.log(`\n📊 結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
