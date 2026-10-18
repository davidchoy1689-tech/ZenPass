/** ZenPass — 空位通知（去重 + 排除已報名）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-vacnotify-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const id of ["u1", "u2", "u3"]) {
    pre.prepare("INSERT INTO users (id,name,email) VALUES (?,?,?)").run(id, id, id + "@x.com");
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { notifyLargeVacancies } = require("../src/services/vacancy-notify");

  const now = new Date();
  const iso = (days) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const isoPast = new Date(now.getTime() - 86400000).toISOString().slice(0, 19).replace("T", " ");

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c1','u3','舊瑜伽','瑜伽',60,150,'active')").run();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c2','u3','新瑜伽','瑜伽',60,150,'active')").run();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c3','u3','煮飯','烹飪',60,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count) VALUES ('s1','c1',?,?,10,10)").run(isoPast, isoPast);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count) VALUES ('s2','c2',?,?,10,0)").run(iso(2), iso(2));
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count) VALUES ('s3','c3',?,?,10,0)").run(iso(2), iso(2));

  // u1 / u2 曾上瑜伽 → 有興趣；u1 已報 c2；u3 教練冇興趣紀錄
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status) VALUES ('b1','Z1','u1','s1','c1','attended')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status) VALUES ('b2','Z2','u2','s1','c1','attended')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status) VALUES ('b3','Z3','u1','s2','c2','confirmed')").run();

  console.log("🧪 空位通知 tests");

  const r1 = notifyLargeVacancies({ now });
  await new Promise((r) => setTimeout(r, 80));
  ok(r1.classes === 2, "2 個高空位課程（瑜伽 + 烹飪）");
  ok(r1.notified === 1, "只通知未報名嘅 u2（u1 已報 c2、u3 冇興趣）");
  const n = db.prepare("SELECT * FROM notifications WHERE user_id='u2' AND type='class.vacancy'").get();
  ok(!!n && /新瑜伽/.test(n.message) && /10 個空位/.test(n.message), "通知內容正確");
  ok(!db.prepare("SELECT 1 FROM notifications WHERE user_id='u1' AND type='class.vacancy'").get(), "已報名用戶唔會收到");

  const r2 = notifyLargeVacancies({ now });
  ok(r2.notified === 0, "同日重複執行 → 唔再發");
  ok(db.prepare("SELECT COUNT(*) c FROM vacancy_notices").get().c === 1, "去重表只有一筆");

  const r3 = notifyLargeVacancies({ now: new Date(now.getTime() + 86400000) });
  await new Promise((r) => setTimeout(r, 60));
  ok(r3.notified === 1, "翌日可以再提醒一次");

  console.log("── 接線 ──");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(__dirname, "../src/config/init-db.js"), "utf8");
  ok(/services\/vacancy-notify/.test(idx), "scheduler 用新 service");
  ok(/vacancy_notices/.test(initSrc), "去重表已建立");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
