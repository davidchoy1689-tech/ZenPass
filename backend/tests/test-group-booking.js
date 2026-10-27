/** ZenPass — 三人同行 tests（2026-10-20） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-group-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active', commission_rate REAL DEFAULT 0.2, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 100, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, membership_type TEXT DEFAULT 'none', penalty_consent INTEGER DEFAULT 1,
    loyalty_tier TEXT DEFAULT 'bronze', is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES ('u1','甲','u1@x.com',100)").run();
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES ('u2','乙','u2@x.com',100)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach,coach_verified) VALUES ('coach1','教練','c@x.com','coach',1,1)").run();
  pre.prepare("INSERT INTO partner_venues (id,name) VALUES ('v1','場一')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const db = new Database(tmp);

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,booking_open) VALUES ('c1','coach1','三人班','瑜伽',60,150,12,'active',1)").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+3 day'),datetime('now','+3 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',datetime('now','+4 day'),datetime('now','+4 day','+1 hour'),3,1,'available')").run();
  db.close();

  const svc = require("../src/services/booking-service");
  const book = (uid, sid, groupSize, paymentType = "single") =>
    svc.createBooking({
      body: { schedule_id: sid, class_id: "c1", payment_type: paymentType, group_size: groupSize, penalty_consent: true },
      user: { id: uid },
    });

  console.log("🧪 三人同行 tests");

  const r1 = book("u1", "s1", 3, "single");
  ok(r1.status === 201, `三人同行預約成功（got ${r1.status}）`);
  ok(Number(r1.body.group_size) === 3, "回傳 group_size=3");
  ok(/^ZP[A-Z0-9]{5}$/.test(r1.body.group_invite_code || ""), `有邀請碼（got ${r1.body.group_invite_code}）`);

  const row = new Database(tmp).prepare("SELECT amount, group_size, group_invite_code FROM bookings WHERE id=?").get(r1.body.booking_id);
  ok(Number(row.amount) === 360, `金額 HK$360（got ${row.amount}）`);
  const sched = new Database(tmp).prepare("SELECT enrolled_count FROM class_schedules WHERE id='s1'").get();
  ok(sched.enrolled_count === 4, `名額 +3（1→4，got ${sched.enrolled_count}）`);

  const r2 = book("u2", "s2", 3, "single");
  ok(r2.status === 409 && /滿/.test(r2.body.error || ""), `剩 2 位唔夠 3 人 → 409 CLASS_FULL（got ${r2.status}）`);

  // credits: 12cr × 3 × 0.8 = 28.8 credits
  const r3 = book("u2", "s1", 3, "credits");
  ok(r3.status === 201, `Credits 三人同行成功（got ${r3.status}）`);
  const u2 = new Database(tmp).prepare("SELECT credits FROM users WHERE id='u2'").get();
  ok(Math.abs(u2.credits - (100 - 28.8)) < 0.01, `扣 28.8 credits（got ${u2.credits}）`);

  const r4 = book("u1", "s1", 1, "single");
  ok(r4.status === 409 || r4.status === 200, "同一時段重複預約被阻");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
