/**
 * ZenPass — 訪客結賬 / 取消 / 合併 closed-loop tests (2026-10-23)
 * 直接呼叫 route handler，唔需要起 server。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_jwt_secret_0123456789abcdefghij";
const tmp = path.join(os.tmpdir(), "zenpass-guest-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

function handlerOf(router, method, p) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === p && l.route.methods[method.toLowerCase()],
  );
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle; // 跳過 auth middleware
}

function call(handler, { body = {}, query = {}, user = null, params = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      _json: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(o) {
        this._json = o;
        resolve({ status: this.statusCode, body: o });
        return this;
      },
      send(o) {
        this._json = o;
        resolve({ status: this.statusCode, body: o });
        return this;
      },
    };
    const req = { body, query, params, user, headers: {}, ip: "127.0.0.1" };
    handler(req, res, () => resolve({ status: 0, body: "next" }));
  });
}

(async () => {
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active')");
  db.prepare(
    "INSERT INTO users (id,name,email,role,password_hash) VALUES ('admin-1','Admin','a@x.com','admin','x')",
  ).run();
  db.prepare(
    "INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,booking_open) VALUES ('c1','admin-1','伸展班','伸展',120,120,12,'active',1)",
  ).run();
  db.prepare(
    "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','+10 day'),datetime('now','+10 day','+2 hour'),10,0,'available')",
  ).run();

  // migration 會有 refund_state
  require("../src/services/migrate-schema").runMigrations();

  const guest = require("../src/routes/guest");
  const admin = require("../src/routes/admin");

  const book = handlerOf(guest, "post", "/book");
  const session = handlerOf(guest, "get", "/session");
  const cancel = handlerOf(guest, "post", "/cancel");
  const pay = handlerOf(guest, "post", "/payment");
  const merge = handlerOf(admin, "post", "/merge-guest");
  const listMerges = handlerOf(admin, "get", "/guest-merges");

  ok(!!book && !!session && !!cancel && !!pay && !!merge, "route handlers found");

  // 1) 訪客預約
  const r1 = await call(book, {
    body: { name: "陳大文", phone: "61234567", classId: "c1", scheduleIds: ["s1"] },
  });
  ok(r1.status === 201 && r1.body.success && r1.body.token, "訪客預約成功 + 發 token");
  const token = r1.body.token;
  const bookingId = (r1.body.bookings[0] || {}).id;
  ok(!!bookingId, "booking 已建立");

  const guestUser = db.prepare("SELECT id, lead_source, tags FROM users WHERE phone='61234567'").get();
  ok(guestUser && guestUser.lead_source === "guest_checkout", "訪客帳號標記 guest_checkout");
  ok(db.prepare("SELECT COUNT(*) n FROM bookings WHERE schedule_id='s1' AND status='pending_payment'").get().n >= 1, "booking 狀態 pending_payment");
  const adminNotif = db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='guest.new_booking'").get().n;
  ok(adminNotif >= 1, "已通知 admin（guest.new_booking）");

  // 2) 同一電話再預約 → 拒絕
  const r2 = await call(book, {
    body: { name: "陳大文", phone: "+852 6123 4567", classId: "c1", scheduleIds: ["s1"] },
  });
  ok(r2.status === 409 && r2.body.code === "PHONE_EXISTS", "重複電話被拒（防帳號接管）");

  // 3) session 查詢
  const r3 = await call(session, { query: { token } });
  ok(r3.status === 200 && r3.body.bookings.length === 1, "訪客可查自己預約");
  const r3b = await call(session, { query: { token: "invalid" } });
  ok(r3b.status === 401, "無效 token 被拒");

  // 4) 提交付款
  const r4 = await call(pay, { body: { token, booking_id: bookingId, method: "fps", reference: "REF-1" } });
  ok(r4.status === 200 && r4.body.success, "訪客提交 FPS 付款");
  ok(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='payment.new_fps_payme'").get().n >= 1, "已通知 admin 核實付款");

  // 5) 付費後取消 → refund_state pending
  db.prepare("UPDATE bookings SET status='confirmed', payment_status='paid', payment_method='fps' WHERE id=?").run(bookingId);
  const r5 = await call(cancel, { body: { token, booking_id: bookingId } });
  ok(r5.status === 200 && r5.body.success, "訪客自助取消成功");
  const after = db.prepare("SELECT status, refund_state FROM bookings WHERE id=?").get(bookingId);
  ok(after.status === "cancelled", "booking 已取消");
  ok(after.refund_state === "pending", "refund_state = pending（待人手轉賬）");
  const refundRow = db.prepare("SELECT amount, status FROM refund_logs WHERE booking_id=?").get(bookingId);
  ok(refundRow && refundRow.status === "pending" && Number(refundRow.amount) === 120, "refund_logs 已建立（HK$120 pending）");
  ok(
    db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 0,
    "座位已釋放",
  );

  // 6) 正式註冊同電話 → 通知合併
  db.prepare(
    "INSERT INTO users (id,name,email,phone,password_hash,lead_source) VALUES ('u-new','陳大文','new@x.com','61234567','x','')",
  ).run();
  const merges = await call(listMerges, { user: { id: "admin-1", role: "admin" } });
  ok(merges.status === 200 && merges.body.merges.length === 1, "admin 見到可合併訪客帳號");

  const r6 = await call(merge, {
    body: { guest_user_id: guestUser.id, target_user_id: "u-new" },
    user: { id: "admin-1", role: "admin" },
  });
  ok(r6.status === 200 && r6.body.success && r6.body.moved_bookings === 1, "合併成功（1 個預約轉移）");
  ok(
    db.prepare("SELECT COUNT(*) n FROM bookings WHERE user_id='u-new'").get().n === 1,
    "booking 已轉去新帳號",
  );
  ok(
    db.prepare("SELECT lead_source FROM users WHERE id=?").get(guestUser.id).lead_source === "merged_guest",
    "舊訪客帳號標記 merged_guest（保留審計）",
  );
  ok(
    db.prepare("SELECT COUNT(*) n FROM account_merges").get().n === 1,
    "account_merges 有紀錄",
  );

  // 7) 唔可以合併非訪客帳號
  const r7 = await call(merge, {
    body: { guest_user_id: "u-new", target_user_id: guestUser.id },
    user: { id: "admin-1", role: "admin" },
  });
  ok(r7.status === 400, "拒絕合併非訪客帳號");

  if (fail) {
    console.error(`❌ ${fail} 項失敗`);
    process.exit(1);
  }
  console.log("✅ 訪客閉環 tests passed");
})();
