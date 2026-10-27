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
  const audit = db.prepare("SELECT * FROM audit_log WHERE entity_id='b-paid-cancelled' AND action_type='refund.completed'").get();
  ok(!!audit, "已寫入 audit_log");

  const r9 = await call(markRefunded, { id: "b-paid-cancelled" }, {}, { id: "admin", role: "admin" });
  ok(r9.statusCode === 409, "已退款再確認 → 409");
  const r10 = await call(markRefunded, { id: "b-active" }, {}, { id: "admin", role: "admin" });
  ok(r10.statusCode === 400, "冇申請的預約 → 400");

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
