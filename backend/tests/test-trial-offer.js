/** ZenPass — 迎新半價優惠 tests（2026-10-19，David 定：新用戶只限一次、半價） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_j…ghij";
const tmp = path.join(os.tmpdir(), "zenpass-trial-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0, membership_type TEXT DEFAULT 'none',
    membership_expires_at TEXT, penalty_consent INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0, partner_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,role,credits) VALUES ('u1','新人','u1@x.com','user',12)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,credits) VALUES ('u2','窮新人','u2@x.com','user',5)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,credits,created_at) VALUES ('u3','舊用戶','u3@x.com','user',50,datetime('now','-30 day'))").run();
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach,coach_verified) VALUES ('coach1','教練','c@x.com','coach',1,1)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const { getDb } = require("../src/services/database");
  const db = getDb();

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,booking_open) VALUES ('c1','coach1','班','瑜伽',60,150,12,'active',1)").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+3 day'),datetime('now','+3 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',datetime('now','+4 day'),datetime('now','+4 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s3','c1',datetime('now','+5 day'),datetime('now','+5 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s4','c1',datetime('now','+6 day'),datetime('now','+6 day','+1 hour'),10,1,'available')").run();

  const svc = require("../src/services/booking-service");
  const book = (userId, scheduleId) =>
    svc.createBooking({
      body: { schedule_id: scheduleId, class_id: "c1", payment_type: "membership_trial", penalty_consent: true },
      user: { id: userId },
    });

  console.log("🧪 迎新半價 tests");

  const r1 = book("u1", "s1");
  ok(r1.status === 200 || r1.status === 201, `第一次迎新預約成功（got ${r1.status} ${JSON.stringify(r1.body && r1.body.error || "")}）`);
  const u1 = db.prepare("SELECT credits FROM users WHERE id='u1'").get();
  ok(u1.credits === 6, `扣半價 6 credits（got ${u1.credits}）`);
  const b1 = db.prepare("SELECT amount, status, payment_status FROM bookings WHERE user_id='u1'").get();
  ok(Number(b1.amount) === 60 && b1.status === "confirmed" && b1.payment_status === "paid", `金額 HK$60、confirmed/paid（got ${b1.amount}/${b1.status}/${b1.payment_status}）`);

  const r2 = book("u1", "s2");
  ok(r2.status === 403, `第二次迎新 → 拒絕（got ${r2.status}）`);
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 6, "第二次冇再扣 credits");

  const r3 = book("u2", "s3");
  ok(r3.status === 400 && /6 Credits/.test(r3.body.error || ""), `不足 6 credits → 400（got ${r3.status}）`);

  const r4 = book("u3", "s4");
  ok(r4.status === 403, `註冊超過 7 日 → 唔可以用迎新（got ${r4.status}）`);

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
