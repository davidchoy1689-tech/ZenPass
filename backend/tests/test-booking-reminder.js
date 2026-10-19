/** ZenPass — 1 日前提醒 tests（2026-10-19） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-remind-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active',
    user_id TEXT, owner_id TEXT, commission_rate REAL DEFAULT 0.2, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','u1@x.com')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const db = new Database(tmp);

  console.log("🧪 1 日前提醒 tests");

  const cols = db.prepare("PRAGMA table_info('bookings')").all().map((c) => c.name);
  ok(cols.includes("reminder_sent_1d"), "bookings 有 reminder_sent_1d 欄位");

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,venue_name) VALUES ('c1','u1','明日班','瑜伽',60,150,12,'active','場地A')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+24 hours'),datetime('now','+25 hours'),10,1,'available')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','ZP-1','u1','s1','c1','confirmed','paid',150)").run();
  db.close();

  const { sendDayBeforeReminders } = require("../src/scripts/booking-reminder");
  const r1 = sendDayBeforeReminders();
  ok(r1.checked === 1 && r1.sent === 1, `第一次發送 1 個（got checked=${r1.checked} sent=${r1.sent}）`);

  const chk = new Database(tmp);
  ok(chk.prepare("SELECT reminder_sent_1d FROM bookings WHERE id='b1'").get().reminder_sent_1d === 1, "booking 標記已提醒");
  const nrows = chk.prepare("SELECT id, type FROM notifications").all();
  ok(nrows.filter((n) => n.type === "booking.reminder_1d").length === 1, "有通知記錄");
  chk.close();

  const r2 = sendDayBeforeReminders();
  ok(r2.checked === 0 && r2.sent === 0, `重跑唔會重複（got ${r2.sent}）`);

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
