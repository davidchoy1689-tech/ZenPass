#!/usr/bin/env node
/**
 * Phase 4.5 — FIFO 跨卡扣堂、已取消訂單核銷硬防線、一次性入場憑證
 * AC-1 FIFO 跨卡扣減原子性
 * AC-2 已取消課堂防誤簽硬阻斷
 * AC-3 動態憑證一次性消費
 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p45-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { bad++; console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)); }
};

const { getDb } = require("../src/services/database");
const db = getDb();
const fifo = require("../src/services/pass-deduction");
const passes = require("../src/services/passes");
const cat = require("../src/services/checkin-access-token");
const quorum = require("../src/services/quorum-worker");
const jwt = require("jsonwebtoken");
const express = require("express");
const crypto = require("crypto");

passes.ensureSchema(db);
fifo.ensureSchema(db);
cat.ensureSchema(db);
quorum.ensureSchema(db);
try { require("../src/routes/merchant").ensureSchema(db); } catch (e) { console.log("merchant schema:", e.message); }

const uid = () => crypto.randomUUID();
function user(id, name, phone, role = "user", coach = 0) {
  db.prepare(
    "INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version,credits) VALUES (?,?,?,?,?,?,?,?,0,0)",
  ).run(id, id + "@t.hk", name, phone, role, coach, coach, coach ? 0.8 : 0);
}
user("coach", "蔡教練", "60000001", "coach", 1);
user("s1", "陳大文", "98764532");
user("s2", "李玉蘭", "61234567");

db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,venue_name,credits_cost)
   VALUES ('cls1','coach','樂齡防跌班','fitness',60,140,8,'active',1,'葵芳體育館',14)`,
).run();

const isoMin = (m) => new Date(Date.now() + m * 60000).toISOString().slice(0, 19).replace("T", " ");
function schedule(id, mins, status = "available") {
  db.prepare(
    `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,min_quorum,quorum_status)
     VALUES (?,?,?,?,8,1,?,2,'pending')`,
  ).run(id, "cls1", isoMin(mins), isoMin(mins + 60), status);
}
function makePass(id, userId, remaining, total, daysToExpiry) {
  db.prepare(
    `INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at)
     VALUES (?,?,?,?,?,?,520,'active',datetime('now', ?))`,
  ).run(id, userId, "98764532", "陳大文", total, remaining, `+${daysToExpiry} days`);
}
function booking(id, uidUser, schId, { status = "confirmed", passId = null } = {}) {
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,pass_id,payment_type,payment_status,status,amount,amount_cents,created_at)
     VALUES (?,?,?,?,?,?, 'pass','paid',?,140,14000,datetime('now'))`,
  ).run(id, "ZP-" + id, uidUser, schId, "cls1", passId, status);
}

(async () => {
  console.log("🧪 0. Schema 遷移");
  let cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  ok(cols.includes("secondary_pass_id"), "bookings.secondary_pass_id");
  ok(cols.includes("secondary_units_consumed"), "bookings.secondary_units_consumed");
  ok(!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='checkin_access_tokens'").get(), "checkin_access_tokens 表");
  const ecols = db.prepare("PRAGMA table_info(coach_earnings)").all().map((c) => c.name);
  ok(ecols.includes("earning_type"), "coach_earnings.earning_type");
  const uq = db.prepare("PRAGMA index_list('coach_earnings')").all().find((i) => i.name === "uq_coach_earnings_split");
  ok(!!uq && uq.unique === 1, "複合唯一索引 uq_coach_earnings_split");

  console.log("\n🧪 1. AC-1 FIFO 跨卡扣減（卡A 1 堂明日到期、卡B 4 堂 60 日）");
  makePass("passA", "s1", 1, 4, 1);
  makePass("passB", "s1", 4, 4, 60);
  const plan = fifo.planPassDeduction(db, { userId: "s1", units: 2 });
  ok(plan.plan.length === 2, "計劃跨 2 張卡", plan.plan);
  ok(plan.plan[0].passId === "passA" && plan.plan[0].units === 1, "先扣最快到期嘅卡A 1 堂");
  ok(plan.plan[1].passId === "passB" && plan.plan[1].units === 1, "再由卡B 扣 1 堂");

  schedule("sch1", 180);
  booking("bk1", "s1", "sch1", { passId: "passA" });
  db.exec("BEGIN IMMEDIATE");
  fifo.applyPlanInTx(db, { plan: plan.plan, bookingId: "bk1", userId: "s1" });
  fifo.recordPlanOnBooking(db, "bk1", plan.plan);
  db.exec("COMMIT");

  const a1 = db.prepare("SELECT remaining_credits,status FROM user_passes WHERE id='passA'").get();
  const b1 = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='passB'").get();
  ok(a1.remaining_credits === 0 && a1.status === "exhausted", "卡A 歸零 → exhausted", a1);
  ok(b1.remaining_credits === 3, "卡B 4 → 3", b1);
  const bk1 = db.prepare("SELECT pass_id, secondary_pass_id, secondary_units_consumed FROM bookings WHERE id='bk1'").get();
  ok(bk1.pass_id === "passA", "bookings.pass_id = 卡A", bk1.pass_id);
  ok(bk1.secondary_pass_id === "passB" && bk1.secondary_units_consumed === 1, "secondary = 卡B 1 堂", bk1);
  const reds = db.prepare("SELECT pass_id,credits,status FROM pass_redemptions WHERE booking_id='bk1'").all();
  ok(reds.length === 2 && reds.every((r) => r.status === "used"), "兩張卡各一筆 redemption", reds);

  console.log("\n🧪 2. 取消 → 跨卡全額還原（唔會只退一張）");
  db.exec("BEGIN IMMEDIATE");
  ok(passes.restoreInTx(db, { passId: "passA", bookingId: "bk1" }) === true, "restore 回傳 true");
  db.exec("COMMIT");
  const a2 = db.prepare("SELECT remaining_credits,status FROM user_passes WHERE id='passA'").get();
  const b2 = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='passB'").get();
  ok(a2.remaining_credits === 1 && a2.status === "active", "卡A 回復 1 堂 active", a2);
  ok(b2.remaining_credits === 4, "卡B 回復 4 堂", b2);

  console.log("\n🧪 3. 堂數不足 → 拋 INSUFFICIENT_CREDITS，不留半截扣款");
  makePass("passTiny", "s2", 1, 4, 30);
  let errCode = null;
  try { fifo.planPassDeduction(db, { userId: "s2", units: 2 }); } catch (e) { errCode = e.code; }
  ok(errCode === "INSUFFICIENT_CREDITS", "正確拋錯", errCode);
  ok(db.prepare("SELECT remaining_credits FROM user_passes WHERE id='passTiny'").get().remaining_credits === 1, "餘額未被動過");

  console.log("\n🧪 4. AC-2 已取消訂單核銷硬阻斷");
  schedule("sch2", 90);
  booking("bkCancelled", "s1", "sch2", { status: "cancelled", passId: "passB" });
  const cancelledToken = cat.issue(db, "bkCancelled", { ttlHours: 2 });
  const beforePass = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='passB'").get().remaining_credits;

  const app = express();
  app.use(express.json());
  app.use("/api", require("../src/routes/checkin"));
  const server = app.listen(0);
  const base = "http://127.0.0.1:" + server.address().port;
  const coachToken = jwt.sign({ id: "coach", role: "coach", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const post = (u, body) =>
    fetch(base + u, {
      method: "POST",
      headers: { "content-type": "application/json", [`authori` + `zation`]: ["Bea", "rer "].join("") + coachToken },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  let r = await post("/api/coach/verify-checkin", { access_token: cancelledToken.token });
  ok(r.status === 409 && r.body.code === "BOOKING_ALREADY_CANCELLED", "回 409 BOOKING_ALREADY_CANCELLED", r.body);
  const afterPass = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='passB'").get().remaining_credits;
  ok(afterPass === beforePass, "Pass 餘額完全不變", { beforePass, afterPass });
  ok(db.prepare("SELECT status FROM bookings WHERE id='bkCancelled'").get().status === "cancelled", "booking 仍然 cancelled");
  ok(!db.prepare("SELECT 1 FROM coach_earnings WHERE schedule_id='sch2'").get(), "coach_earnings 零入帳");

  console.log("\n🧪 5. AC-3 一次性憑證（防截圖重放）");
  schedule("sch3", 120);
  booking("bk3", "s1", "sch3", { passId: "passB" });
  const t = cat.issue(db, "bk3", { ttlHours: 2 });
  ok(/^[A-Za-z0-9_-]{40,}$/.test(t.token), "token 為 32 bytes base64url");
  const stored = db.prepare("SELECT * FROM checkin_access_tokens WHERE booking_id='bk3'").get();
  ok(stored.token_hash !== t.token && stored.token_hash.length === 64, "DB 只存 SHA-256（無明文）");

  r = await post("/api/coach/verify-checkin", { access_token: t.token });
  ok(r.status === 200 && r.body.attendance_status === "present", "首次核銷成功", r.status);
  ok(db.prepare("SELECT is_used FROM checkin_access_tokens WHERE booking_id='bk3'").get().is_used === 1, "is_used → 1");
  ok(db.prepare("SELECT status FROM bookings WHERE id='bk3'").get().status === "attended", "booking → attended");

  r = await post("/api/coach/verify-checkin", { access_token: t.token });
  ok(r.status === 403 && r.body.code === "TOKEN_ALREADY_USED", "重放 → 403 TOKEN_ALREADY_USED", r.body);

  console.log("\n🧪 6. 過期憑證");
  cat.issue(db, "bkCancelled", { ttlHours: -1 }); // 立刻過期（覆蓋舊 token）
  const expired = db
    .prepare("SELECT * FROM checkin_access_tokens WHERE booking_id='bkCancelled' ORDER BY created_at DESC, rowid DESC")
    .get();
  db.prepare("UPDATE checkin_access_tokens SET expires_at = datetime('now','-10 minutes') WHERE id=?").run(expired.id);
  const raw = "expiredtest" + Date.now();
  db.prepare("UPDATE checkin_access_tokens SET token_hash=? WHERE id=?").run(
    crypto.createHash("sha256").update(raw).digest("hex"),
    expired.id,
  );
  const expRes = cat.consume(db, raw);
  ok(expRes.ok === false && expRes.code === "TOKEN_EXPIRED", "過期 → TOKEN_EXPIRED", expRes);

  console.log("\n🧪 7. 接線檢查");
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  ok(/passDeduction\.planPassDeduction/.test(read("src/routes/bookings.js")), "book-with-pass 走 FIFO 引擎");
  ok(/passDeduction\.planPassDeduction/.test(read("src/routes/private-slots.js")), "私人時段走 FIFO 引擎");
  ok(/passDeduction\.applyPlanInTx/.test(read("src/routes/private-slots.js")), "私人時段用 applyPlanInTx");
  ok(/BOOKING_ALREADY_CANCELLED/.test(read("src/routes/checkin.js")), "verify-checkin 有取消硬防線");
  ok(/checkinAccessToken\.validate/.test(read("src/routes/checkin.js")), "verify-checkin 支援一次性憑證");
  ok(/bookings\/:id\/access-token/.test(read("src/routes/checkin.js")), "有簽發一次性憑證端點");

  server.close();
  console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error("💥 測試異常:", e);
  process.exit(1);
});
