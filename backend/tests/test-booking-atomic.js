#!/usr/bin/env node
/**
 * test-booking-atomic.js — createBooking 原子性回歸測試 (P1-2)
 *
 * 驗證：booking 流程中途失敗（例如點數不足）時，
 *       class_schedules.enrolled_count 唔會洩漏（會隨 transaction 回滾）。
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const TMP = path.join(os.tmpdir(), "zenpass-booking-atomic-" + Date.now() + ".db");
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

console.log("🧪 createBooking 原子性測試");

initDatabase();
updateDatabase();

const now = new Date().toISOString();
const db = new Database(TMP);
db.pragma("foreign_keys = ON");
db.prepare(
  "INSERT INTO users (id,email,name,credits,role,email_verified) VALUES ('u-poor','poor@test.hk','Poor',0,'user',1)",
).run();
db.prepare(
  "INSERT INTO users (id,email,name,credits,role,email_verified) VALUES ('u-rich','rich@test.hk','Rich',50,'user',1)",
).run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES ('c1','u-rich','班1','新興運動',60,10,120,12,'active')",
).run();
db.prepare(
  "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,2,0,'available')",
).run(now, now);
db.close();

const { createBooking } = require("../src/services/booking-service");

function snapshot() {
  const d = new Database(TMP);
  const r = d.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s1'").get().enrolled_count;
  const c = d.prepare("SELECT credits FROM users WHERE id='u-poor'").get().credits;
  d.close();
  return { enrolled: r, poorCredits: c };
}

// 1. 點數不足 → 400，且 enrolled_count 不變（唔洩漏）
const res1 = createBooking({
  body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", amount: 120, penalty_consent: true },
  user: { id: "u-poor" },
});
assert(res1.status === 400, `點數不足回 400 (got ${res1.status})`);
assert(snapshot().enrolled === 0, `失敗後 enrolled_count = 0 (got ${snapshot().enrolled}) ← 冇洩漏`);

// 2. 成功個案 → 201，enrolled_count = 1
const res2 = createBooking({
  body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", amount: 120, penalty_consent: true },
  user: { id: "u-rich" },
});
assert(res2.status === 201, `成功回 201 (got ${res2.status})`);
assert(snapshot().enrolled === 1, `成功後 enrolled_count = 1 (got ${snapshot().enrolled})`);

// 3. 重複預約 → 409，且 enrolled_count 仍然 = 1（唔會 double count）
const res3 = createBooking({
  body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", amount: 120, penalty_consent: true },
  user: { id: "u-rich" },
});
assert(res3.status === 409, `重複預約回 409 (got ${res3.status})`);
assert(snapshot().enrolled === 1, `重複後 enrolled_count 仍 = 1 (got ${snapshot().enrolled}) ← 冇 double count`);

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
try {
  fs.unlinkSync(TMP);
} catch (e) {}
process.exit(failed ? 1 : 0);
