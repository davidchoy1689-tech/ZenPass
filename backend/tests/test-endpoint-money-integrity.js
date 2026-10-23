/** ZenPass — 付款／租場 endpoint 金額完整性 tests（2026-10-19）
 *
 *  1. POST /api/payments/create-payment-intent  唔信 client amount，一律由 booking 計
 *  2. POST /api/payments/create-subscription    未付款唔可以開通會籍（dev mode 已封）
 *  3. POST /api/wallet/pay-rental               已停用（原本 client 自定扣款金額）
 *  4. POST /api/venue-rentals/book              租金由伺服器計，client 改價會被拒
 *  5. POST /api/venue-rentals/:id/pay           錢包交易 type 必須係 rental_payment
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_jwt_secret_0123456789abcdefghij";
const tmp = path.join(os.tmpdir(), "zenpass-moneyint-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, address TEXT,
    category TEXT, commission_plan TEXT DEFAULT 'basic', commission_rate REAL DEFAULT 0.15,
    status TEXT DEFAULT 'active', visibility TEXT DEFAULT 'visible', updated_at TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0,
    membership_type TEXT DEFAULT 'none', membership_expires_at TEXT,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE venue_rentals (id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, coach_id TEXT NOT NULL,
    start_time TEXT NOT NULL, end_time TEXT NOT NULL, price_hkd REAL NOT NULL,
    status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'unpaid', paid_at TEXT, payment_method TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,wallet_balance) VALUES ('u1','甲','u1@x.com',5000)").run();
  pre.prepare("INSERT INTO users (id,name,email,wallet_balance) VALUES ('u2','乙','u2@x.com',5000)").run();
  pre.prepare("INSERT INTO users (id,name,email,role,wallet_balance) VALUES ('coach1','教練','c1@x.com','coach',5000)").run();
  pre.prepare("INSERT INTO partner_venues (id,name,district,commission_rate) VALUES ('v1','場一','中西區',0.15)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  try { db.exec("ALTER TABLE users ADD COLUMN wallet_balance REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN pending_payout REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE partner_venues ADD COLUMN rental_price_per_hour REAL DEFAULT 300"); } catch (e) {}
  db.prepare("UPDATE partner_venues SET rental_price_per_hour = 400 WHERE id='v1'").run();
  db.prepare("UPDATE users SET wallet_balance = 5000").run();

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status) VALUES ('c1','coach1','班','瑜伽',60,150,15,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+1 day'),datetime('now','+1 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','ZP-B1','u1','s1','c1','pending_payment','pending',150)").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b2','ZP-B2','u2','s1','c1','pending_payment','pending',150)").run();

  const pick = (router, p, method = "post") => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (handler, user, body, params = {}) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    await handler({ user, body, headers: {}, params, query: {} }, res);
    return res;
  };

  console.log("🧪 付款／租場 endpoint 金額完整性 tests");

  // ===== 1. create-payment-intent =====
  const payments = require("../src/routes/payments");
  const piHandler = pick(payments, "/create-payment-intent");
  const pi1 = await call(piHandler, { id: "u1", role: "user" }, { amount: 1, booking_id: "b1" });
  ok(pi1.statusCode === 200 && Number(pi1.body.amount) === 150, `payment-intent 金額由 booking 計（got ${pi1.body && pi1.body.amount}）`);
  const pi2 = await call(piHandler, { id: "u2", role: "user" }, { amount: 1, booking_id: "b1" });
  ok(pi2.statusCode === 404, "payment-intent 拒絕他人 booking");
  const pi3 = await call(piHandler, { id: "u1", role: "user" }, { amount: 1 });
  ok(pi3.statusCode === 400, "payment-intent 冇 booking_id → 400");

  // ===== 2. create-subscription（dev mode 唔可以免費開會籍）=====
  const subHandler = pick(payments, "/create-subscription");
  const sub1 = await call(subHandler, { id: "u1", role: "user" }, { plan_id: "gold", price: 2899 });
  ok(sub1.statusCode === 403 && sub1.body.code === "USE_MEMBERSHIP_ORDER", "create-subscription 未付款 → 403");
  const u1row = db.prepare("SELECT membership_type FROM users WHERE id='u1'").get();
  ok(!u1row.membership_type || u1row.membership_type === "none", "會員身份冇被改成 gold");

  // ===== 3. wallet/pay-rental 停用 =====
  const wallet = require("../src/routes/wallet");
  const prHandler = pick(wallet, "/pay-rental");
  db.prepare("INSERT INTO venue_rentals (id,venue_id,coach_id,start_time,end_time,price_hkd,status) VALUES ('r1','v1','coach1',datetime('now','+2 day'),datetime('now','+2 day','+2 hour'),500,'confirmed')").run();
  const pr1 = await call(prHandler, { id: "coach1", role: "coach" }, { rental_id: "r1", amount: 1 });
  ok(pr1.statusCode === 403 && pr1.body.code === "USE_VENUE_RENTAL_PAY", "pay-rental 已停用（403）");
  ok(db.prepare("SELECT wallet_balance FROM users WHERE id='coach1'").get().wallet_balance === 5000, "錢包冇被扣錢");

  // ===== 4. venue-rentals/book 租金由伺服器計 =====
  const vr = require("../src/routes/venue-rentals");
  const bookHandler = pick(vr, "/book");
  const start = new Date(Date.now() + 3 * 86400000); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600000);
  const book1 = await call(bookHandler, { id: "coach1", role: "coach" }, {
    venue_id: "v1", start_time: start.toISOString(), end_time: end.toISOString(), price_hkd: 1,
  });
  ok(book1.statusCode === 409 && book1.body.code === "PRICE_CHANGED", `改細租金被拒（got ${book1.statusCode}）`);
  const book2 = await call(bookHandler, { id: "coach1", role: "coach" }, {
    venue_id: "v1", start_time: start.toISOString(), end_time: end.toISOString(),
  });
  const expected = 800; // HK$400/hr（商戶後台設定）× 2 小時
  ok(book2.statusCode === 200 && Number(book2.body.price_hkd) === expected, `租金 = 場地設定價 ${expected}（got ${book2.body && book2.body.price_hkd}）`);

  // ===== 4b. 商戶後台可設定每小時租金 =====
  const partner = require("../src/routes/partner");
  const getVenue = pick(partner, "/venue", "get");
  const putVenue = pick(partner, "/venue", "put");
  db.prepare("UPDATE users SET partner_id='v1', role='partner_owner' WHERE id='coach1'").run();
  const gv = await call(getVenue, { id: "coach1", role: "partner_owner" }, {});
  ok(gv.statusCode === 200 && Number(gv.body.data.rental_price_per_hour) === 400, `商戶讀到每小時租金 400（got ${gv.body && gv.body.data && gv.body.data.rental_price_per_hour}）`);
  const bad = await call(putVenue, { id: "coach1", role: "partner_owner" }, { rental_price_per_hour: 10 });
  ok(bad.statusCode === 400, "租金低於 HK$100 → 400");
  const tooHigh = await call(putVenue, { id: "coach1", role: "partner_owner" }, { rental_price_per_hour: 9999 });
  ok(tooHigh.statusCode === 400, "租金高於 HK$3,000 → 400");
  const good = await call(putVenue, { id: "coach1", role: "partner_owner" }, { rental_price_per_hour: 550 });
  ok(good.statusCode === 200 && db.prepare("SELECT rental_price_per_hour FROM partner_venues WHERE id='v1'").get().rental_price_per_hour === 550, "商戶改租金 → DB 更新為 550");

  // 改價後新預約用新價（2 小時 = 1100）
  const start2 = new Date(Date.now() + 4 * 86400000); start2.setMinutes(0, 0, 0);
  const end2 = new Date(start2.getTime() + 2 * 3600000);
  const book3 = await call(bookHandler, { id: "coach1", role: "coach" }, {
    venue_id: "v1", start_time: start2.toISOString(), end_time: end2.toISOString(),
  });
  ok(book3.statusCode === 200 && Number(book3.body.price_hkd) === 1100, `新價生效：2 小時 = 1100（got ${book3.body && book3.body.price_hkd}）`);

  // ===== 4c. 超出範圍 → 申請 → admin 審批 =====
  const reqPost = pick(partner, "/venue/price-request", "post");
  const reqGet = pick(partner, "/venue/price-request", "get");
  const adminList = pick(partner, "/admin/rental-price-requests", "get");
  const adminReview = pick(partner, "/admin/rental-price-requests/:id/review", "post");

  const inRangeReq = await call(reqPost, { id: "coach1" }, { requested_price: 500, reason: "測試" });
  ok(inRangeReq.statusCode === 400 && inRangeReq.body.code === "IN_RANGE", "範圍內金額唔需要申請（400 IN_RANGE）");

  const bigReq = await call(reqPost, { id: "coach1" }, { requested_price: 6000, reason: "含器材及教練駐場" });
  ok(bigReq.statusCode === 201, `超範圍申請成功（got ${bigReq.statusCode}）`);
  const reqId = bigReq.body.data.id;
  ok(db.prepare("SELECT status FROM rental_price_requests WHERE id=?").get(reqId).status === "pending", "申請狀態 = pending");

  const dupReq = await call(reqPost, { id: "coach1" }, { requested_price: 8000, reason: "重複" });
  ok(dupReq.statusCode === 409, "已有待審批申請 → 409");

  const ownList = await call(reqGet, { id: "coach1" }, {});
  ok(ownList.statusCode === 200 && ownList.body.data.requests.length === 1, "商戶睇到自己嘅申請");

  const pList = await call(adminList, { id: "admin1", role: "admin" }, {}, {});
  ok(pList.statusCode === 200 && pList.body.data.length === 1, "admin 睇到待審批申請");

  const approve = await call(adminReview, { id: "admin1", role: "admin" }, { action: "approve", note: "OK" }, { id: reqId });
  ok(approve.statusCode === 200, `admin 批准（got ${approve.statusCode}）`);
  const vrow = db.prepare("SELECT rental_price_per_hour, rental_price_exception FROM partner_venues WHERE id='v1'").get();
  ok(Number(vrow.rental_price_per_hour) === 6000 && Number(vrow.rental_price_exception) === 6000, "批准後場地租金 = 6000（例外已記錄）");
  ok(db.prepare("SELECT status FROM rental_price_requests WHERE id=?").get(reqId).status === "approved", "申請狀態 = approved");

  const rePutSame = await call(putVenue, { id: "coach1" }, { rental_price_per_hour: 6000 });
  ok(rePutSame.statusCode === 200, "已批核例外價可以再儲存");
  const rePutOther = await call(putVenue, { id: "coach1" }, { rental_price_per_hour: 7000 });
  ok(rePutOther.statusCode === 400, "未批核嘅超範圍價 → 400");

  const book4start = new Date(Date.now() + 5 * 86400000); book4start.setMinutes(0, 0, 0);
  const book4end = new Date(book4start.getTime() + 3600000);
  const book4 = await call(bookHandler, { id: "coach1", role: "coach" }, {
    venue_id: "v1", start_time: book4start.toISOString(), end_time: book4end.toISOString(),
  });
  ok(book4.statusCode === 200 && Number(book4.body.price_hkd) === 6000, `例外價用於新預約：1 小時 = 6000（got ${book4.body && book4.body.price_hkd}）`);

  // ===== 5. venue-rentals/:id/pay 用合法 wallet type =====
  const payHandler = pick(vr, "/:id/pay");
  const pay1 = await call(payHandler, { id: "coach1", role: "coach" }, {}, { id: "r1" });
  ok(pay1.statusCode === 200 && pay1.body.payment_status === "paid", `租場付款成功（got ${pay1.statusCode} ${JSON.stringify(pay1.body)}）`);
  const tx = db.prepare("SELECT type, amount FROM wallet_transactions WHERE source_id='r1'").get();
  ok(tx && tx.type === "rental_payment" && Number(tx.amount) === 500, `wallet 交易 type=rental_payment, amount=500（got ${tx && tx.type} ${tx && tx.amount}）`);
  ok(db.prepare("SELECT payment_status FROM venue_rentals WHERE id='r1'").get().payment_status === "paid", "租場 payment_status = paid");
  const pay2 = await call(payHandler, { id: "coach1", role: "coach" }, {}, { id: "r1" });
  ok(pay2.statusCode === 200 && pay2.body.already_paid === true, "重複付款 → already_paid，唔會再扣錢");
  ok(db.prepare("SELECT wallet_balance FROM users WHERE id='coach1'").get().wallet_balance === 4500, "錢包只扣一次 500");

  // ===== 靜態檢查：唔好再信 client 金額 =====
  const walletSrc = fs.readFileSync(path.join(__dirname, "../src/routes/wallet.js"), "utf8");
  ok(!/router\.post\("\/pay-rental"[\s\S]{0,400}parseFloat\(amount\)[\s\S]{0,400}\n\s*\}\);/.test(walletSrc) || walletSrc.includes("USE_VENUE_RENTAL_PAY"), "wallet pay-rental 冇再直接用 client amount");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
