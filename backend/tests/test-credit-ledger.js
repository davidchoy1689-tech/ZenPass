/** ZenPass — Credits 流水賬 tests（2026-10-19） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_jwt_secret_0123456789abcdefghij";
const tmp = path.join(os.tmpdir(), "zenpass-credledger-" + Date.now() + ".db");
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
    membership_expires_at TEXT, penalty_consent INTEGER DEFAULT 1, loyalty_tier TEXT DEFAULT 'bronze',
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES ('u1','甲','u1@x.com',0)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,is_coach,coach_verified) VALUES ('coach1','教練','c@x.com','coach',1,1)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const { getDb } = require("../src/services/database");
  const db = getDb();

  const ledger = require("../src/services/credit-ledger");

  console.log("🧪 Credits 流水賬 tests");

  const r1 = ledger.applyCredits(db, { userId: "u1", credits: 20, type: "earn", source: "test", description: "測試加點" });
  ok(r1.balance === 20, `加 20 → 結餘 20（got ${r1.balance}）`);
  const r2 = ledger.applyCredits(db, { userId: "u1", credits: -5, type: "spend", source: "test", description: "測試扣點" });
  ok(r2.balance === 15, `扣 5 → 結餘 15（got ${r2.balance}）`);
  let threw = false;
  try { ledger.applyCredits(db, { userId: "u1", credits: -999, type: "spend" }); } catch (e) { threw = e.code === "INSUFFICIENT_CREDITS"; }
  ok(threw, "餘額不足 → 拒絕");
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 15, "拒絕後結餘不變");

  const rows = db.prepare("SELECT type, credits, balance_after FROM credit_transactions WHERE user_id='u1' AND source='test' ORDER BY rowid").all();
  ok(rows.length === 2 && rows[0].balance_after === 20 && rows[1].balance_after === 15, "每筆有 balance_after");
  ok(rows.every((r) => r.credits > 0), "credits 記錄為正數（方向由 type 表示）");
  const ts = db.prepare("SELECT created_at FROM credit_transactions WHERE user_id='u1' LIMIT 1").get();
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts.created_at), `有完整時間（got ${ts.created_at}）`);

  // 預約扣分 → 取消退款（透過 booking service）
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,booking_open) VALUES ('c1','coach1','班','瑜伽',60,150,12,'active',1)").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+5 day'),datetime('now','+5 day','+1 hour'),10,1,'available')").run();

  const svc = require("../src/services/booking-service");
  const out = svc.createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", penalty_consent: true }, user: { id: "u1" } });
  ok(out.status === 200 || out.status === 201, `預約成功（got ${out.status}）`);
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 3, "扣 12 credits → 結餘 3");
  const spend = db.prepare("SELECT * FROM credit_transactions WHERE user_id='u1' AND type='spend' AND source='booking'").get();
  ok(!!spend && Number(spend.credits) === 12 && Number(spend.balance_after) === 3, "流水有 booking spend 12 / 結餘 3");
  const bookingId = db.prepare("SELECT id FROM bookings WHERE user_id='u1'").get().id;
  ok(spend.reference_id === bookingId, "流水 reference = booking id");

  svc.cancelBooking({ params: { id: bookingId }, body: { reason: "test" }, user: { id: "u1" }, headers: {} });
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 15, "取消 → 退回 12（結餘 15）");
  const refund = db.prepare("SELECT * FROM credit_transactions WHERE user_id='u1' AND type='refund'").get();
  ok(!!refund && Number(refund.credits) === 12 && Number(refund.balance_after) === 15, "流水有 refund 12 / 結餘 15");

  // 現金退款亦要有交易紀錄（用戶可見）
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',datetime('now','+6 day'),datetime('now','+6 day','+1 hour'),10,1,'available')").run();
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,payment_method,amount)
              VALUES ('b2','ZP-B2','u1','s2','c1','confirmed','paid','single','fps',150)`).run();
  svc.cancelBooking({ params: { id: "b2" }, body: { reason: "test cash" }, user: { id: "u1" }, headers: {} });
  const cashRefund = db.prepare("SELECT type, amount FROM transactions WHERE user_id='u1' AND type='refund' AND description LIKE '%ZP-B2%'").get();
  ok(!!cashRefund && Number(cashRefund.amount) === 150, `現金退款有交易紀錄（got ${cashRefund && cashRefund.amount}）`);
  const rl = db.prepare("SELECT amount, status FROM refund_logs WHERE booking_id='b2'").get();
  ok(!!rl && Number(rl.amount) === 150 && rl.status === "completed", "refund_logs 完整");

  // 流水受保護：唔可以 DELETE / UPDATE
  require("../src/services/financial-protection").installDeleteTriggers();
  let delBlocked = false, updBlocked = false;
  try { db.prepare("DELETE FROM credit_transactions WHERE user_id='u1'").run(); } catch (e) { delBlocked = /禁止刪除/.test(e.message); }
  try { db.prepare("UPDATE credit_transactions SET credits=999 WHERE user_id='u1'").run(); } catch (e) { updBlocked = /禁止修改/.test(e.message); }
  ok(delBlocked, "credit_transactions 禁止 DELETE");
  ok(updBlocked, "credit_transactions 禁止 UPDATE");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
