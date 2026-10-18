#!/usr/bin/env node
/**
 * test-refund-cents.js — 退款上限用整數 cents 判斷 (Phase 1 / S3)
 *
 * 邊界案例：booking amount = 0.3，分兩次退 0.1 + 0.2。
 * 浮點：0.1 + 0.2 = 0.30000000000000004 > 0.3 → 會誤判「超出上限」而拒絕。
 * 整數 cents：10 + 20 = 30 = 30 → 正確允許，並標記全退。
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const TMP = path.join(os.tmpdir(), "zenpass-refund-cents-" + Date.now() + ".db");
process.env.DB_PATH = TMP;

const Database = require("better-sqlite3");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  ✅ " + msg);
    passed++;
  } else {
    console.log("  ❌ " + msg);
    failed++;
  }
}

console.log("🧪 退款 cents 測試");

initDatabase();
updateDatabase();

const now = new Date().toISOString();
const db = new Database(TMP);
db.pragma("foreign_keys = ON");
db.prepare(
  "INSERT INTO users (id,email,name,role,email_verified) VALUES ('u1','u1@test.hk','U1','user',1)",
).run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES ('c1','u1','班1','新興運動',60,10,0.3,0,'active')",
).run();
db.prepare(
  "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,5,1,'available')",
).run(now, now);
db.prepare(
  "INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount) VALUES ('b1','ZP-1','u1','s1','c1','single','paid','confirmed',0.3)",
).run();
db.close();

const { processRefund } = require("../src/services/refund");

// 超額 → 拒絕（0.31 > 0.30）
const r1 = processRefund({ bookingId: "b1", amount: 0.31, reason: "test", initiatedBy: "system" });
assert(r1.success === false, "退 0.31 超出上限 → 拒絕");

// float 陷阱：0.30000001 > 0.3 會誤判超額；cents(30) > cents(30) = false → 應接受
const r2 = processRefund({ bookingId: "b1", amount: 0.30000001, reason: "test", initiatedBy: "system" });
assert(r2.success === true, "退 0.30000001 應接受（float 會誤判超額）");
assert(r2.new_status === "fully_refunded", `標記 fully_refunded（got ${r2.new_status}）`);

// 退款通知會員
const dbCheck = new Database(TMP);
const refundNotif = dbCheck.prepare("SELECT * FROM notifications WHERE user_id='u1' AND type='booking.refunded'").get();
dbCheck.close();
assert(!!refundNotif && /退款已處理/.test(refundNotif.title) && /0\.3/.test(refundNotif.message), "退款後通知會員（金額）");

// 已全退 → 再退拒絕
const r3 = processRefund({ bookingId: "b1", amount: 0.01, reason: "test", initiatedBy: "system" });
assert(r3.success === false, "再退 0.01 → 正確拒絕（已達上限）");

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
try {
  fs.unlinkSync(TMP);
} catch (e) {}
process.exit(failed ? 1 : 0);
