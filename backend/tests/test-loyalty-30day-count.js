/** ZenPass — 30 日 booking 計數（SQLite 字串格式）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-loy30-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0, monthly_bookings INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','a@x.com')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c1','u1','班','瑜伽',60,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time) VALUES ('s1','c1',datetime('now'),datetime('now','+1 hour'))").run();

  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const add = (id, days, status = "attended") => db.prepare(
    "INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, "Z-" + id, "u1", "s1", "c1", status, ago(days));

  add("b29", 29);
  add("b31", 31);
  add("b0", 0);
  add("bcancel", 5, "cancelled");

  const { updateUserTier, getUserTierInfo } = require("../src/services/loyalty");

  console.log("🧪 30 日 booking 計數 tests");

  const r = updateUserTier("u1");
  ok(r.booking_count === 2, `29 日 + 今日 = 2（實際 ${r.booking_count}）`);
  ok(r.tier === "bronze", "2 堂 → 銅牌");

  const info = getUserTierInfo("u1");
  ok(info.this_month_bookings === 2, `getUserTierInfo 本月 = 2（實際 ${info.this_month_bookings}）`);
  ok(info.booking_count === 2, "booking_count = 2");

  const src = fs.readFileSync(path.join(__dirname, "../src/services/loyalty.js"), "utf8");
  const isoCount = (src.match(/30 \* 86400000/g) || []).length;
  ok(isoCount === 2, "兩個 30 日查詢都轉用 SQLite 格式");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
