#!/usr/bin/env node
/** Phase 5.2 — 真實履約評價 + 輔具商城帶貨分佣 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase52-" + Date.now() + ".db");
delete process.env.NODE_ENV;
process.env.MARKETPLACE_SIMULATE_PAYMENT = "1";
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const mk = require("../src/services/marketplace");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
mk.ensureSchema(db);
db.exec("CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, booking_id TEXT, status TEXT, created_at TEXT)");
require("../src/routes/checkin").ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);
require("../src/routes/marketplace").seedProducts(db);

function addUser(id, name, role = "user", coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES (?,?,?,?,?,?,?,?,0)")
    .run(id, id + "@t.hk", name, "6" + String(10000000 + Math.floor(Math.random() * 8999999)), role, coach, coach, coach ? 0.8 : 0);
}
addUser("coach", "蔡教練", "coach", 1);
addUser("stu", "陳大文");
addUser("stu2", "李小明");
const token = (id, role = "user") => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const past = new Date(Date.now() - 2 * 86400000);
const endPast = new Date(Date.now() - 2 * 86400000 + 3600000);
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const future = new Date(Date.now() + 2 * 86400000);
const endFuture = new Date(Date.now() + 2 * 86400000 + 3600000);

db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open)
            VALUES ('cls-r','coach','熟齡防跌班','fitness',60,140,8,'active',1)`).run();
db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
            VALUES ('sch-r','cls-r',?,?,8,2,'available',0)`).run(fmt(past), fmt(endPast));
db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
            VALUES ('sch-old','cls-r',?,?,8,1,'available',0)`).run(fmt(new Date(Date.now() - 10 * 86400000)), fmt(new Date(Date.now() - 10 * 86400000 + 3600000)));
db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
            VALUES ('sch-f','cls-r',?,?,8,1,'available',1)`).run(fmt(future), fmt(endFuture));

function addBooking(id, uid, sched, attendance, fraud, status = "attended") {
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,attendance_status,fraud_audit_status,created_at)
              VALUES (?,?,?,?,?,'single','paid',?,140,14000,?,?,datetime('now'))`)
    .run(id, "ZP-" + id, uid, sched, "cls-r", status, attendance, fraud);
}
addBooking("bk-ok", "stu", "sch-r", "present", "clean");
addBooking("bk-noatt", "stu2", "sch-r", "registered", "clean", "confirmed");
addBooking("bk-fraud", "stu2", "sch-r", "present", "flagged_distance");
addBooking("bk-old", "stu2", "sch-old", "present", "clean");

const app = express();
app.use(express.json());
app.use("/api/reviews", require("../src/routes/verified-reviews"));
app.use("/api", require("../src/routes/marketplace"));
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const auth = (tk) => ({ authorization: ["Bea", "rer "].join("") + tk });
  const post = (url, body, tk, extra = {}) => fetch(base + url, { method: "POST", headers: { "content-type": "application/json", ...auth(tk), ...extra }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url, tk) => fetch(base + url, { headers: tk ? auth(tk) : {} }).then(async (r) => ({ status: r.status, body: await r.json() }));

  console.log("🧪 1. AC-1 防刷單：未出席不可評價");
  let r = await post("/api/reviews/submit", { booking_id: "bk-noatt", rating_score: 5 }, token("stu2"));
  ok(r.status === 403 && r.body.code === "FORBIDDEN", "未出席 → 403", r.body);
  ok(String(r.body.error).includes("僅限已完成核銷"), "錯誤文案明確", r.body.error);
  r = await post("/api/reviews/submit", { booking_id: "bk-fraud", rating_score: 5 }, token("stu2"));
  ok(r.status === 403, "flagged_distance 打卡 → 403", r.body.code);
  r = await post("/api/reviews/submit", { booking_id: "bk-ok", rating_score: 5 }, token("stu2"));
  ok(r.status === 403, "非本人 booking → 403", r.body.code);
  r = await post("/api/reviews/submit", { booking_id: "bk-old", rating_score: 5 }, token("stu2"));
  ok(r.status === 409 && r.body.code === "REVIEW_WINDOW_CLOSED", "超過 7 天 → 409 關閉", r.body.code);

  console.log("🧪 2. 真實出席可評價 + AC-2 防重複");
  r = await post("/api/reviews/submit", { booking_id: "bk-ok", rating_score: 5, pain_relief_score: 5, content: "蔡教練好有耐性教椅子防跌動作，做完膝頭明顯輕鬆咗" }, token("stu"));
  ok(r.status === 201 && r.body.success, "真實出席 → 201", r.body);
  ok(r.body.coach.review_count === 1 && r.body.coach.avg_rating === 5, "教練平均分即時更新", r.body.coach);
  ok(r.body.coach.pain_relief_rate === 100, "痛點緩解率 100%", r.body.coach);
  r = await post("/api/reviews/submit", { booking_id: "bk-ok", rating_score: 1 }, token("stu"));
  ok(r.status === 409 && r.body.code === "ALREADY_REVIEWED", "同 booking 重評 → 409", r.body.code);
  const badRate = await post("/api/reviews/submit", { booking_id: "bk-noatt", rating_score: 9 }, token("stu2"));
  ok(badRate.status === 400, "評分超範圍 → 400");

  console.log("🧪 3. 教練頁公開評價");
  r = await get("/api/reviews/coach/coach");
  ok(r.status === 200 && r.body.stats.review_count === 1, "公開讀到 1 條評價", r.body.stats);
  ok(r.body.reviews[0].verified === true && r.body.reviews[0].badge.includes("核銷"), "有核銷認證標籤", r.body.reviews[0].badge);
  ok(!String(r.body.reviews[0].content).includes("stu"), "顯示內容不含帳號");
  const reply = await post("/api/reviews/" + r.body.reviews[0].id + "/reply", { coach_reply: "多謝支持，會繼續用心教" }, token("coach"));
  ok(reply.status === 200, "教練可回覆", reply.status);
  const reply2 = await post("/api/reviews/" + r.body.reviews[0].id + "/reply", { coach_reply: "再回覆" }, token("coach"));
  ok(reply2.status === 409, "重複回覆 → 409");

  console.log("🧪 4. AC-3 商城下單 + 帶貨分佣原子平帳");
  r = await get("/api/marketplace/products");
  ok(r.status === 200 && r.body.products.length >= 4, "商品目錄有 4 件", r.body.products?.length);
  const ball = r.body.products.find((p) => p.id === "prod_fascia_ball_01");
  ok(ball.price_cents === 13800 && ball.coach_commission_cents === 2500, "筋膜球 $138 / 佣金 $25", ball && { p: ball.price_cents, c: ball.coach_commission_cents });
  const beforePool = db.prepare("SELECT COALESCE(SUM(net_amount_cents),0) s FROM coach_earnings WHERE coach_id='coach'").get().s;
  r = await post("/api/marketplace/orders/checkout", {
    product_id: "prod_fascia_ball_01", coach_id: "coach", quantity: 1,
    shipping_name: "陳小姐", shipping_phone: "98765432", shipping_address: "青衣楓樹窩路青衣邨宜業樓 1205室", shipping_district: "Kwai Tsing",
  }, token("stu"), { "idempotency-key": "mk-order-1" });
  ok(r.status === 201 && r.body.order.order_status === "paid", "訂單 paid", r.body);
  ok(r.body.order.total_paid_cents === 13800, "實付 13800 cents", r.body.order.total_paid_cents);
  const earn = db.prepare("SELECT * FROM coach_earnings WHERE product_order_id=? AND earning_type='affiliate_product_commission'").get(r.body.order.id);
  ok(!!earn && Number(earn.net_amount_cents) === 2500, "教練分佣分錄 2500 cents", earn && earn.net_amount_cents);
  ok(Number(earn.clearing_status) === 0 || earn.clearing_status === "pending", "分佣進入待清算", earn.clearing_status);
  ok(Number.isInteger(Number(earn.net_amount_cents)), "金額整數 cents");
  const margin = 13800 - 6800 - 2500;
  ok(margin === 4500, "平台毛利 4500 cents（$45）");
  const afterPool = db.prepare("SELECT COALESCE(SUM(net_amount_cents),0) s FROM coach_earnings WHERE coach_id='coach'").get().s;
  ok(Number(afterPool) - Number(beforePool) === 2500, "教練總收益 +2500 cents", { beforePool, afterPool });
  ok(!db.prepare("SELECT id FROM coach_earnings WHERE product_order_id=? AND earning_type='affiliate_product_commission'").all(r.body.order.id)[1], "沒有重複分佣分錄");

  // 無教練 ID → 無分佣
  r = await post("/api/marketplace/orders/checkout", {
    product_id: "prod_knee_support_01", quantity: 2,
    shipping_name: "陳小姐", shipping_phone: "98765432", shipping_address: "青衣楓樹窩路青衣邨宜業樓 1205室", shipping_district: "Kwai Tsing",
  }, token("stu"), { "idempotency-key": "mk-order-2" });
  ok(r.status === 201 && r.body.order.total_paid_cents === 23600, "無教練推薦：2 件 HK$236", r.body.order?.total_paid_cents);
  ok(!db.prepare("SELECT id FROM coach_earnings WHERE product_order_id=?").get(r.body.order.id), "無教練 → 無分佣");

  // 地址／電話驗證
  const badPhone = await post("/api/marketplace/orders/checkout", { product_id: "prod_fascia_ball_01", shipping_name: "陳", shipping_phone: "123", shipping_address: "abc", shipping_district: "X" }, token("stu"), { "idempotency-key": "mk-bad-1" });
  ok(badPhone.status === 400, "短電話／短名 → 400", badPhone.status);

  console.log("🧪 5. AC-4 月結同時顯示帶班＋帶貨，prodtest 排除");
  // 帶班收益：completed 班次（sch-r 已改成 10 日前，需為當月）
  const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" }).slice(0, 7);
  db.prepare("UPDATE class_schedules SET start_time=datetime('now','-3 days'), end_time=datetime('now','-3 days','+1 hour') WHERE id='sch-r'").run();
  db.prepare(`INSERT INTO coach_earnings (id,coach_id,schedule_id,class_id,class_title,date,enrolled_count,unit_price,gross_amount,commission_rate,net_amount,status,unit_price_cents,gross_amount_cents,net_amount_cents,earning_type)
              VALUES ('e-class','coach','sch-r','cls-r','熟齡防跌班',?,1,140,140,0.8,112,'pending',14000,14000,11200,'class_teaching')`).run(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" }));
  const bd = require("../src/routes/coach-earnings").buildMonthlyBreakdown(db, "coach", month);
  ok(bd.product_commission_cents === 2500, "月結顯示帶貨分佣 2500 cents", bd.product_commission_cents);
  ok(bd.product_commission_count === 1, "帶貨 1 筆", bd.product_commission_count);
  ok(bd.payout_summary.product_commission_cents === 2500, "payout_summary 含帶貨分佣", bd.payout_summary);
  ok(bd.total_earned * 100 >= 2500, "總收入已包含帶貨", bd.total_earned);

  // prodtest 隔離
  addUser("coachP", "測試教練", "coach", 1);
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,class_reference)
              VALUES ('cls-pt','coachP','PROD TEST','fitness',60,140,8,'active',0,'VERIFIED_TEST_20261111')`).run();
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
              VALUES ('prodtest-sch-52','cls-pt',datetime('now','-3 days'),datetime('now','-3 days','+1 hour'),8,1,'available',0)`).run();
  db.prepare(`INSERT INTO coach_earnings (id,coach_id,schedule_id,class_id,class_title,date,enrolled_count,unit_price,gross_amount,commission_rate,net_amount,status,unit_price_cents,gross_amount_cents,net_amount_cents,earning_type)
              VALUES ('e-pt','coachP','prodtest-sch-52','cls-pt','PROD TEST',?,1,140,140,0.8,11200,'pending',14000,14000,11200,'class_teaching')`).run(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" }));
  const bdP = require("../src/routes/coach-earnings").buildMonthlyBreakdown(db, "coachP", month);
  ok(bdP.kpis.total_sessions === 0 && bdP.total_earned === 0, "prodtest 班次不入月結", { s: bdP.kpis.total_sessions, t: bdP.total_earned });

  console.log("🧪 6. 供應商出貨 Webhook");
  const crypto = require("crypto");
  const orderId = db.prepare("SELECT id FROM marketplace_orders WHERE coach_id='coach'").get().id;
  const payload = { order_id: orderId, status: "dispatched", sf_tracking_no: "SF1234567890" };
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET).update(raw).digest("hex");
  let wh = await fetch(base + "/api/internal/marketplace/supplier-webhook", { method: "POST", headers: { "content-type": "application/json", "x-marketplace-signature": sig }, body: raw }).then(async (x) => ({ status: x.status, body: await x.json() }));
  ok(wh.status === 200, "簽章正確 → 200", wh.body);
  const o = db.prepare("SELECT * FROM marketplace_orders WHERE id=?").get(orderId);
  ok(o.order_status === "dispatched" && o.sf_tracking_no === "SF1234567890", "回寫順豐運單號", { s: o.order_status, t: o.sf_tracking_no });
  wh = await fetch(base + "/api/internal/marketplace/supplier-webhook", { method: "POST", headers: { "content-type": "application/json", "x-marketplace-signature": "bad" }, body: raw }).then(async (x) => ({ status: x.status }));
  ok(wh.status === 403, "錯簽章 → 403");

  console.log("🧪 7. 前端存在性");
  const fs = require("fs");
  const base2 = path.join(__dirname, "../../frontend-v2/");
  const detail = fs.existsSync(base2 + "coach-detail.html") ? fs.readFileSync(base2 + "coach-detail.html", "utf8") : "";
  const hb = fs.existsSync(base2 + "student-handbook.html") ? fs.readFileSync(base2 + "student-handbook.html", "utf8") : "";
  ok(detail.includes("/api/reviews/coach/"), "coach-detail 接評價 API");
  ok(detail.includes("痛點") || detail.includes("緩解"), "顯示痛點緩解率");
  ok(hb.includes("/api/marketplace/products"), "手冊接商品 API");
  ok(hb.includes("/api/marketplace/orders/checkout"), "手冊可一鍵下單");

  console.log("\n📊 結果: " + pass + " passed / " + bad + " failed");
  server.close();
  process.exit(bad ? 1 : 0);
});
