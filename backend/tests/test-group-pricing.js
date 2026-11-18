#!/usr/bin/env node
/**
 * test-group-pricing.js — 三人同行套票計價（2026-11-18 修復回歸）
 *
 * 背景：booking.html「三人同行套票」同後端 group_size=3 計 3 個位，
 *      但前端顯示只乘 0.8 冇乘 3 → 顯示 11.2cr，實際扣 33.6cr；
 *      另外後端 single + promo 會將折扣放大 ×2.4（$240 而非 $296）。
 *
 * 覆蓋：
 *  1) credits 三人同行：扣 33.6 credits、amount 336、佔 3 個位
 *  2) single 三人同行：amount 336、佔 3 個位
 *  3) single 三人同行 + SILVER2($40)：amount 296（折扣只一次，唔會被放大）
 *  4) credits 三人同行 + SILVER2：扣 29.6 credits
 *  5) 剩餘名額 < 3 → 409 CLASS_FULL
 *  6) 訪客三人同行：1 張 booking、3 個位、原價 420、實付 336
 *  7) 訪客 3 人同行 × 3 位票（9 位）→ 400 超出上限
 *  8) 訪客三人同行 + SILVER2：人數學驗證用 3 位（唔會因 quantity=1 被拒）
 */
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test_jwt_secret_0123456789abcdefghij";
const TMP = path.join(os.tmpdir(), "zenpass-group-price-" + Date.now() + ".db");
process.env.DB_PATH = TMP;

let pass = 0,
  fail = 0;
const ok = (c, m, x) => {
  if (c) {
    pass++;
    console.log("  ✅ " + m);
  } else {
    fail++;
    console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x));
  }
};

function handlerOf(router, method, p) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === p && l.route.methods[method.toLowerCase()],
  );
  if (!layer) return null;
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function call(handler, { body = {}, query = {}, user = null, params = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(o) {
        resolve({ status: this.statusCode, body: o });
        return this;
      },
      send(o) {
        resolve({ status: this.statusCode, body: o });
        return this;
      },
    };
    handler({ body, query, params, user, headers: {}, ip: "127.0.0.1" }, res, () =>
      resolve({ status: 0, body: "next" }),
    );
  });
}

(async () => {
  require("../src/config/init-db")();
  try {
    require("../src/config/update-db")();
  } catch (e) {}
  try {
    require("../src/services/migrate-schema").runMigrations();
  } catch (e) {}

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { randomUUID } = require("crypto");

  // 教練 + 學員
  db.prepare(
    "INSERT INTO users (id,name,email,role,password_hash,credits,phone,email_verified,created_at) VALUES ('coach1','教練','c@x.hk','coach','x',0,'90000001',1,datetime('now'))",
  ).run();
  const mkStudent = (id, phone, credits) =>
    db
      .prepare(
        "INSERT INTO users (id,name,email,role,password_hash,credits,phone,email_verified,created_at) VALUES (?,?,?,'user','x',?,?,1,datetime('now'))",
      )
      .run(id, id, id + "@x.hk", credits, phone);

  mkStudent("st1", "91110001", 100);
  mkStudent("st2", "91110002", 100);
  mkStudent("st3", "91110003", 100);
  mkStudent("st4", "91110004", 100);

  db.prepare(
    "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,booking_open) VALUES ('cls1','coach1','伸展班','伸展',120,20,140,14,'active',1)",
  ).run();
  const insertSchedule = (id, seats) =>
    db
      .prepare(
        "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES (?, 'cls1', ?, ?, ?, 0, 'available')",
      )
      .run(
        id,
        new Date(Date.now() + 10 * 864e5).toISOString(),
        new Date(Date.now() + 10 * 864e5 + 7200e3).toISOString(),
        seats,
      );
  ["s1", "s2", "s3", "s4", "sSmall", "gs1", "gs2"].forEach((id, i) =>
    insertSchedule(id, id === "sSmall" ? 2 : 20),
  );

  // 優惠碼 SILVER2（二人同行減 $40，最少 2 人）
  db.prepare(
    "INSERT INTO promo_codes (id, code, type, value, min_participants, per_user_limit, active, description) VALUES (?, 'SILVER2', 'fixed_discount', 40, 2, 1, 1, '二人同行優惠')",
  ).run(randomUUID());

  const { createBooking } = require("../src/services/booking-service");
  const makeReq = (userId, sid, paymentType, extra = {}) => ({
    body: {
      schedule_id: sid,
      class_id: "cls1",
      payment_type: paymentType,
      penalty_consent: true,
      group_size: 3,
      ...extra,
    },
    user: { id: userId, name: userId },
    headers: {},
    ip: "1.2.3.4",
  });

  console.log("\n[1] credits 三人同行");
  const r1 = createBooking(makeReq("st1", "s1", "credits"));
  ok(r1.status === 201, "預約成功 201", r1.status);
  const b1 = db.prepare("SELECT amount, group_size FROM bookings WHERE id = ?").get(r1.body.booking_id);
  ok(b1.group_size === 3, "booking.group_size = 3", b1);
  ok(b1.amount === 336, "amount = 336", b1.amount);
  ok(db.prepare("SELECT credits FROM users WHERE id='st1'").get().credits === 66.4, "扣 33.6 credits（100 → 66.4）", {
    credits: db.prepare("SELECT credits FROM users WHERE id='st1'").get().credits,
  });
  ok(
    db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s1'").get().enrolled_count === 3,
    "enrolled_count +3",
  );

  console.log("\n[2] single 三人同行");
  const r2 = createBooking(makeReq("st2", "s2", "single"));
  ok(r2.status === 201, "預約成功 201", r2.status);
  const b2 = db.prepare("SELECT amount FROM bookings WHERE id = ?").get(r2.body.booking_id);
  ok(b2.amount === 336, "amount = 336", b2.amount);
  ok(
    db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s2'").get().enrolled_count === 3,
    "enrolled_count +3",
  );

  console.log("\n[3] single 三人同行 + SILVER2");
  const r3 = createBooking(makeReq("st3", "s3", "single", { promo_code: "SILVER2" }));
  ok(r3.status === 201, "預約成功 201", r3.status);
  const b3 = db.prepare("SELECT amount FROM bookings WHERE id = ?").get(r3.body.booking_id);
  ok(b3.amount === 296, "amount = 296（336 − 40，折扣唔會被 ×2.4）", b3.amount);

  console.log("\n[4] credits 三人同行 + SILVER2");
  const r4 = createBooking(makeReq("st4", "s4", "credits", { promo_code: "SILVER2" }));
  ok(r4.status === 201, "預約成功 201", r4.status);
  ok(
    db.prepare("SELECT credits FROM users WHERE id='st4'").get().credits === 70.4,
    "扣 29.6 credits（33.6 − 4）",
    { credits: db.prepare("SELECT credits FROM users WHERE id='st4'").get().credits },
  );

  console.log("\n[5] 名額不足");
  const r5 = createBooking(makeReq("st1", "sSmall", "credits"));
  ok(r5.status === 409 && r5.body.code === "CLASS_FULL", "剩 2 位但需要 3 位 → 409", r5);

  console.log("\n[6] 訪客三人同行");
  const guest = require("../src/routes/guest");
  const book = handlerOf(guest, "post", "/book");
  ok(!!book, "guest /book handler 存在");
  const g1 = await call(book, {
    body: {
      name: "陳大文",
      phone: "92220001",
      classId: "cls1",
      scheduleIds: ["gs1"],
      groupSize: 3,
      quantity: 1,
    },
  });
  ok(g1.status === 201 && g1.body.success, "訪客預約成功", g1.status);
  ok(g1.body.booking_ids.length === 1, "只有 1 張 booking（包 3 位）", g1.body.booking_ids);
  ok(g1.body.payable_amount === 336, "實付 336", g1.body.payable_amount);
  ok(g1.body.original_amount === 420, "原價 420（3 位 × 140）", g1.body.original_amount);
  ok(
    db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='gs1'").get().enrolled_count === 3,
    "佔 3 個位",
  );

  console.log("\n[7] 訪客 3 人同行 × 3 位票 → 超出上限");
  const g2 = await call(book, {
    body: { name: "李小明", phone: "92220002", classId: "cls1", scheduleIds: ["gs2"], groupSize: 3, quantity: 3 },
  });
  ok(g2.status === 400 && g2.body.code === "GUEST_BOOK_BATCH_LIMIT", "9 位 > 上限 6 → 400", g2);

  console.log("\n[8] 訪客三人同行 + SILVER2");
  const g3 = await call(book, {
    body: {
      name: "黃小華",
      phone: "92220003",
      classId: "cls1",
      scheduleIds: ["gs2"],
      groupSize: 3,
      quantity: 1,
      promoCode: "SILVER2",
    },
  });
  ok(g3.status === 201, "最少 2 人門檻用 3 位計 → 通過", g3);
  ok(g3.body.payable_amount === 296, "實付 296", g3.body.payable_amount);

  console.log("\n[9] 前端顯示一致性（原始碼）");
  const html = require("fs").readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "booking.html"), "utf8");
  ok(/base \* n \* q \* gs \* \(gs === 3 \? 0\.8 : 1\)/.test(html), "orderParts 有乘 groupSize");
  ok(html.includes('if (card.dataset.grp === "3" && isGuest && guestQty > 1) setGuestQty(1)'), "三人票會重置同行人數，避免 3×3");

  db.close();
  console.log(`\n${fail ? "❌" : "✅"} 三人同行計價：${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})();
