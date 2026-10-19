/** ZenPass — 重複取消／舊提款 route 安全 tests（2026-10-19） */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_jwt_secret_for_cancel_idempotency_123456";
const tmp = path.join(os.tmpdir(), "zenpass-cancelidem-" + Date.now() + ".db");
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
    membership_expires_at TEXT, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0, partner_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,credits,wallet_balance) VALUES ('u1','甲','u1@x.com',0,0)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach,coach_verified,wallet_balance) VALUES ('coach1','教練','c@x.com','coach',1,1,500)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  try { db.exec("ALTER TABLE users ADD COLUMN partner_id TEXT"); } catch (e) {}

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status) VALUES ('c1','coach1','班','瑜伽',60,150,12,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+5 day'),datetime('now','+5 day','+1 hour'),10,1,'available')").run();
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,amount)
              VALUES ('b1','ZP-B1','u1','s1','c1','confirmed','paid','credits',120)`).run();

  const svc = require("../src/services/booking-service");

  console.log("🧪 重複取消 / 舊提款 route tests");

  const req = { params: { id: "b1" }, body: { reason: "test" }, user: { id: "u1", role: "user" }, headers: {} };
  const r1 = svc.cancelBooking(req);
  ok(r1.status === 200, `第一次取消成功（got ${r1.status}）`);
  const c1 = db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits;
  ok(c1 === 12, `退回 12 credits（got ${c1}）`);

  const r2 = svc.cancelBooking(req);
  ok(r2.status === 400, `第二次取消被拒（got ${r2.status}）`);
  const c2 = db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits;
  ok(c2 === 12, `credits 冇再增加（got ${c2}）`);
  const enrolled = db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s1'").get().enrolled_count;
  ok(enrolled === 0, `enrolled_count 只減一次（got ${enrolled}）`);

  // 已完成嘅預約唔可以取消
  db.prepare("UPDATE bookings SET status='attended', payment_type='single' WHERE id='b1'").run();
  const r3 = svc.cancelBooking(req);
  ok(r3.status === 400, "已出席／完成 → 唔可以取消");

  // 舊 payout-request 已封
  const ce = require("../src/routes/coach-earnings");
  const layer = ce.stack.find((l) => l.route && l.route.path === "/payout-request" && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (x) => { res.body = x; return res; };
  await handler({ user: { id: "coach1", role: "coach" }, body: { amount: 100 }, params: {}, headers: {} }, res);
  ok(res.statusCode === 403 && res.body.code === "USE_PAYOUTS_REQUEST", "舊 /coach/payout-request → 403");
  ok(db.prepare("SELECT COUNT(*) c FROM coach_payouts").get().c === 0, "冇建立 payout 記錄");
  ok(db.prepare("SELECT wallet_balance FROM users WHERE id='coach1'").get().wallet_balance === 500, "錢包冇變");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/coach-earnings.js"), "utf8");
  ok(src.includes("USE_PAYOUTS_REQUEST"), "有指引去新版 /payouts/request");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
