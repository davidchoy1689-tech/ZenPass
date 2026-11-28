/**
 * ZenPass — 課堂取消 FPS 退款登記流程 tests
 * 使用獨立臨時 DB。node backend/tests/test-refund-flow.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-refundflow-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, role] of [["u1","user"],["u2","user"],["admin","admin"]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES (?,?,?,?,?)").run(id, id, id + "@x.hk", "91234567", role);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c1','admin','木柱班','新興運動',120,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count) VALUES ('s1','c1',?,?,10,1)").run(now, now);
  const ins = db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  ins.run("b-paid-cancelled", "ZP-RF1", "u1", "s1", "c1", "cancelled", "paid", 150);   // 可退
  ins.run("b-unpaid", "ZP-RF2", "u1", "s1", "c1", "cancelled", "pending", 150);        // 未付款
  ins.run("b-active", "ZP-RF3", "u1", "s1", "c1", "confirmed", "paid", 150);           // 未取消

  const bookingsRouter = require("../src/routes/bookings");
  const adminRouter = require("../src/routes/admin");
  const handler = (router, p, method) => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const reqRefund = handler(bookingsRouter, "/:id/request-refund", "post");
  const markRefunded = handler(adminRouter, "/bookings/:id/mark-refunded", "post");

  const call = (fn, params, body, user) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    return Promise.resolve(fn({ params, body: body || {}, user }, res)).then(() => res);
  };

  console.log("\n🧪 課堂取消 FPS 退款流程\n");

  console.log("📋 1. 前置條件");
  const r1 = await call(reqRefund, { id: "b-unpaid" }, { fps_id: "9123 4567", fps_name: "陳大文" }, { id: "u1" });
  ok(r1.statusCode === 400 && r1.body.code === "NOT_PAID", "未付款預約 → 400 NOT_PAID");

  const r2 = await call(reqRefund, { id: "b-active" }, { fps_id: "9123 4567", fps_name: "陳大文" }, { id: "u1" });
  ok(r2.statusCode === 400 && r2.body.code === "NOT_CANCELLED", "課堂未取消 → 400 NOT_CANCELLED");

  const r3 = await call(reqRefund, { id: "b-paid-cancelled" }, { fps_id: "9123 4567", fps_name: "陳大文" }, { id: "u2" });
  ok(r3.statusCode === 403, "其他人申請 → 403");

  console.log("\n📋 2. 參數驗證");
  const r4 = await call(reqRefund, { id: "b-paid-cancelled" }, { fps_id: "1", fps_name: "陳大文" }, { id: "u1" });
  ok(r4.statusCode === 400 && r4.body.code === "FPS_ID_INVALID", "FPS 無效 → 400");
  const r5 = await call(reqRefund, { id: "b-paid-cancelled" }, { fps_id: "91234567", fps_name: "陳" }, { id: "u1" });
  ok(r5.statusCode === 400 && r5.body.code === "FPS_NAME_INVALID", "收款人姓名太短 → 400");

  console.log("\n📋 3. 正常登記");
  const r6 = await call(reqRefund, { id: "b-paid-cancelled" }, { fps_id: "9123 4567", fps_name: "陳大文" }, { id: "u1" });
  ok(r6.statusCode === 200 && r6.body.refund_status === "requested", "已付款＋已取消 → requested");
  const row = db.prepare("SELECT * FROM bookings WHERE id='b-paid-cancelled'").get();
  ok(row.refund_status === "requested", "DB refund_status = requested");
  ok(String(row.refund_fps_id || "").replace(/\s/g, "") === "91234567", "FPS 號碼已儲存");
  ok(row.refund_fps_name === "陳大文", "收款人姓名已儲存");
  ok(!!row.refund_reported_at, "已記錄登記時間");
  ok(row.payment_status === "paid", "未確認前 payment_status 仍為 paid");

  console.log("\n📋 4. 重複申請");
  const r7 = await call(reqRefund, { id: "b-paid-cancelled" }, { fps_id: "91234567", fps_name: "陳大文" }, { id: "u1" });
  ok(r7.statusCode === 409 && r7.body.code === "ALREADY_REQUESTED", "重複提交 → 409");

  console.log("\n📋 5. 管理員確認退款");
  const r8 = await call(markRefunded, { id: "b-paid-cancelled" }, { transfer_reference: "FPS-REF-001" }, { id: "admin", role: "admin" });
  ok(r8.statusCode === 200 && r8.body.refund_status === "refunded", "admin 確認 → refunded");
  const row2 = db.prepare("SELECT * FROM bookings WHERE id='b-paid-cancelled'").get();
  ok(row2.refund_status === "refunded", "DB refund_status = refunded");
  ok(row2.payment_status === "refunded", "payment_status = refunded");
  ok(!!row2.refunded_at, "已記錄退款時間");
  const log = db.prepare("SELECT * FROM refund_logs WHERE booking_id='b-paid-cancelled'").get();
  ok(!!log && Number(log.amount) === 150 && log.status === "completed", "refund_logs 有 completed 紀錄（對賬用）");
  ok(!!log && log.transfer_reference === "FPS-REF-001", "轉賬參考已儲存");
  const tx = db.prepare("SELECT * FROM transactions WHERE refund_id=?").get(log.id);
  ok(!!tx && tx.status === "completed", "學員交易紀錄見到已退款");
  const audit = db.prepare("SELECT * FROM audit_log WHERE entity_id='b-paid-cancelled' AND action_type='refund.completed'").get();
  ok(!!audit, "已寫入 audit_log");

  const r9 = await call(markRefunded, { id: "b-paid-cancelled" }, {}, { id: "admin", role: "admin" });
  ok(r9.statusCode === 409, "已退款再確認 → 409");
  const r10 = await call(markRefunded, { id: "b-active" }, {}, { id: "admin", role: "admin" });
  ok(r10.statusCode === 400, "冇申請的預約 → 400");

  console.log("\n📋 5.1 取消時已自動開 pending 退款 → 確認時唔可以再插一筆（防雙倍退款）");
  ins.run("b-auto-refund", "ZP-RF5", "u1", "s1", "c1", "cancelled", "paid", 150);
  db.prepare("UPDATE bookings SET refund_status='requested', refund_channel='fps' WHERE id='b-auto-refund'").run();
  db.prepare(
    `INSERT INTO refund_logs (id, booking_id, user_id, amount, currency, payment_method, reason, initiated_by, approved_by, status, created_at)
     VALUES ('rf-auto-1','b-auto-refund','u1',150,'HKD','fps','取消自動退款','system','system','pending',datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (id,user_id,type,amount,payment_method,description,status,refund_id,created_at)
     VALUES ('tx-auto-1','u1','refund',150,'fps','自動退款待轉賬','pending','rf-auto-1',datetime('now'))`,
  ).run();
  const r11 = await call(markRefunded, { id: "b-auto-refund" }, { transfer_reference: "FPS-REF-002" }, { id: "admin", role: "admin" });
  ok(r11.statusCode === 200, "確認退款成功");
  const autoLogs = db.prepare("SELECT * FROM refund_logs WHERE booking_id='b-auto-refund'").all();
  ok(autoLogs.length === 1, "refund_logs 仍然只有 1 筆（冇重複插入）");
  ok(Number(autoLogs[0].amount) === 150 && autoLogs[0].status === "completed", "原 pending 紀錄已轉 completed");
  ok(autoLogs[0].transfer_reference === "FPS-REF-002", "轉賬參考寫入原紀錄");
  ok(db.prepare("SELECT status FROM transactions WHERE refund_id='rf-auto-1'").get().status === "completed", "完成 pending 退款時交易紀錄同步 completed");

  console.log("\n📋 5.2 Stripe 卡退款要真正 call Stripe（唔可以假標已退款）");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ins.run("b-stripe", "ZP-RF6", "u1", "s1", "c1", "cancelled", "paid", 200);
  db.prepare("UPDATE bookings SET payment_method='stripe', stripe_payment_intent_id='pi_test_123' WHERE id='b-stripe'").run();
  const stripeSvc = require("../src/services/stripe");
  const origClient = stripeSvc.client;
  let stripeCalled = 0;
  stripeSvc.client = () => ({ refunds: { create: async () => { stripeCalled++; return { id: "re_test_1" }; } } });
  const { processRefund } = require("../src/services/refund");
  const pr = processRefund({
    bookingId: "b-stripe", amount: 200, reason: "測試", initiatedBy: "admin", approvedBy: "admin", method: "stripe",
  });
  ok(pr.success && pr.refund_status === "pending", "Stripe 退款先標 pending（未 call 完唔可以話已退）");
  ok(db.prepare("SELECT payment_status p FROM bookings WHERE id='b-stripe'").get().p === "paid", "Stripe 未成功前 payment_status 仍 paid");
  await sleep(30);
  ok(stripeCalled === 1, "有真正 call Stripe refunds.create");
  const stLog = db.prepare("SELECT status, transfer_reference FROM refund_logs WHERE booking_id='b-stripe'").get();
  ok(stLog && stLog.status === "completed" && stLog.transfer_reference === "re_test_1", "Stripe 成功後 refund_logs = completed + re id");
  ok(db.prepare("SELECT payment_status p FROM bookings WHERE id='b-stripe'").get().p === "refunded", "Stripe 成功後才轉 refunded");
  stripeSvc.client = origClient;
  // 信用卡付款唔應該叫客人填 FPS
  ins.run("b-card-req", "ZP-RF7", "u1", "s1", "c1", "cancelled", "paid", 150);
  db.prepare("UPDATE bookings SET payment_method='stripe' WHERE id='b-card-req'").run();
  const r12 = await call(reqRefund, { id: "b-card-req" }, { fps_id: "91234567", fps_name: "陳大文" }, { id: "u1" });
  ok(r12.statusCode === 400 && r12.body.code === "CARD_AUTO_REFUND", "信用卡付款 → 唔收 FPS 退款登記");
  // Stripe 退款失敗 → 浮上後台待退款，唔可以靜靜雞
  ins.run("b-stripe-fail", "ZP-RF8", "u1", "s1", "c1", "cancelled", "paid", 200);
  db.prepare("UPDATE bookings SET payment_method='stripe', stripe_payment_intent_id='pi_test_456' WHERE id='b-stripe-fail'").run();
  stripeSvc.client = () => ({ refunds: { create: async () => { throw new Error("card_declined"); } } });
  processRefund({ bookingId: "b-stripe-fail", amount: 200, reason: "測試失敗", initiatedBy: "admin", method: "stripe" });
  await sleep(30);
  ok(db.prepare("SELECT refund_status r FROM bookings WHERE id='b-stripe-fail'").get().r === "processing", "Stripe 失敗 → booking 標 processing（後台待退款見到）");
  ok(db.prepare("SELECT status s FROM refund_logs WHERE booking_id='b-stripe-fail'").get().s === "failed", "refund_logs 記 failed");
  stripeSvc.client = origClient;

  console.log("\n📋 6. 接線檢查");
  const adminSrc = fs.readFileSync(path.join(__dirname, "../src/routes/admin.js"), "utf8");
  ok(/requirePermission\("finance\.refund\.complete"\)/.test(adminSrc), "確認退款有權限閘門");
  ok(/pending-refunds/.test(adminSrc), "有 GET /admin/pending-refunds");
  const bookSrc = fs.readFileSync(path.join(__dirname, "../src/routes/bookings.js"), "utf8");
  ok(/request-refund/.test(bookSrc), "有 POST /bookings/:id/request-refund");
  const pageSrc = fs.readFileSync(path.join(__dirname, "../../frontend-v2/my-bookings.html"), "utf8");
  ok(/submitRefund/.test(pageSrc) && /refund_status/.test(pageSrc), "學員頁有退款登記介面");
  const opsSrc = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/loadRefunds/.test(opsSrc) && /mark-refunded/.test(opsSrc), "後台有待退款面板");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
