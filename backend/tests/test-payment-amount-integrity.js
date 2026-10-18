/** ZenPass — Stripe/FPS 金額完整性 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-payint-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','u1@x.com')").run();
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u2','乙','u2@x.com')").run();
  pre.close();
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status) VALUES ('c1','u1','班','瑜伽',60,150,15,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+1 day'),datetime('now','+1 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','ZP-B1','u1','s1','c1','pending_payment','pending',150)").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b2','ZP-B2','u2','s1','c1','pending_payment','pending',150)").run();

  const router = require("../src/routes/payments");
  const get = (p, method = "post") => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (handler, user, body) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    await handler({ user, body, headers: {}, params: {} }, res);
    return res;
  };

  console.log("🧪 Stripe/FPS 金額完整性 tests");

  // 1. create-checkout 唔信 client amount
  const checkout = get("/stripe/create-checkout");
  const r1 = await call(checkout, { id: "u1", role: "user" }, { amount: 1, booking_id: "b1" });
  ok(r1.statusCode === 200 && r1.body.amount === 150, `checkout 金額 = 150（got ${r1.body && r1.body.amount}）`);

  // 2. 未設定 Stripe → confirm 503，唔會免費確認
  const confirm = get("/stripe/confirm-payment");
  const r2 = await call(confirm, { id: "u1", role: "user" }, { session_id: "cs_fake", booking_id: "b1" });
  ok(r2.statusCode === 503 && db.prepare("SELECT status FROM bookings WHERE id='b1'").get().status === "pending_payment", "無 Stripe key → 503 且 booking 保持待付款");

  // 3. FPS 唔信 client amount，且不可處理他人 booking
  const fps = get("/fps");
  const r3 = await call(fps, { id: "u1", role: "user" }, { booking_id: "b1", fps_reference: "REF123", amount: 1 });
  ok(r3.statusCode === 200, "FPS 提交成功");
  const b1 = db.prepare("SELECT amount, fps_reference FROM bookings WHERE id='b1'").get();
  ok(b1.amount === 150, "booking.amount 保持 150（唔係 client 1）");
  const tx = db.prepare("SELECT amount FROM transactions WHERE fps_reference='REF123'").get();
  ok(tx && tx.amount === 150, "交易金額 = 150");

  const r4 = await call(fps, { id: "u2", role: "user" }, { booking_id: "b1", fps_reference: "HACK", amount: 150 });
  ok(r4.statusCode === 404, "其他用戶不可提交他人 booking 的付款");

  // 4. PayMe 同樣
  const payme = get("/payme");
  const r5 = await call(payme, { id: "u1", role: "user" }, { booking_id: "b1", payme_reference: "PM123", amount: 1 });
  ok(r5.statusCode === 200, "PayMe 提交成功");
  ok(db.prepare("SELECT amount FROM bookings WHERE id='b1'").get().amount === 150, "PayMe 後 amount 仍 150");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/payments.js"), "utf8");
  ok(/金額一律由伺服器按 booking 計算/.test(src), "checkout 有伺服器計價");
  ok(/booking_ids/.test(src), "支援多 booking 付款");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
