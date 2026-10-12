#!/usr/bin/env node
/**
 * test-money-cents-sync.js — 金額 cents trigger 同步測試 (Phase 1 / S2)
 *
 * 驗證：建立了 cents-sync trigger 之後，
 *   任何 INSERT / UPDATE（包括經 createBooking）都會自動更新 <col>_cents，
 *   令 cents 欄永遠跟 REAL 欄一致。
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const BACKEND = path.join(__dirname, "..");
const TMP = path.join(os.tmpdir(), "zenpass-cents-sync-" + Date.now() + ".db");
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

console.log("🧪 money cents trigger 同步測試");

initDatabase();
updateDatabase();

// S1（加 _cents 欄）→ S2（建 trigger）
execFileSync("node", ["src/scripts/migrate-money-to-cents.js"], {
  cwd: BACKEND,
  env: { ...process.env, DB_PATH: TMP },
  stdio: "ignore",
});
execFileSync("node", ["src/scripts/sync-money-cents-triggers.js"], {
  cwd: BACKEND,
  env: { ...process.env, DB_PATH: TMP },
  stdio: "ignore",
});

const now = new Date().toISOString();
const db = new Database(TMP);
db.pragma("foreign_keys = ON");
db.prepare(
  "INSERT INTO users (id,email,name,credits,role,email_verified,penalty_consent) VALUES ('u1','u1@test.hk','U1',50,'user',1,1)",
).run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES ('c1','u1','班1','新興運動',60,10,120,12,'active')",
).run();
db.prepare(
  "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,5,0,'available')",
).run(now, now);

// 1. trigger 已建立
const trig = db
  .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%_cents_%'")
  .get().c;
assert(trig > 0, `已建立 cents-sync trigger (${trig} 個)`);

// 2. INSERT 自動寫 cents
db.prepare(
  "INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount) VALUES ('b1','ZP-1','u1','s1','c1','credits','paid','confirmed',120)",
).run();
assert(
  db.prepare("SELECT amount_cents c FROM bookings WHERE id='b1'").get().c === 12000,
  "INSERT amount=120 → amount_cents=12000",
);

// 3. UPDATE 自動更新 cents
db.prepare("UPDATE bookings SET amount=? WHERE id='b1'").run(99.5);
assert(
  db.prepare("SELECT amount_cents c FROM bookings WHERE id='b1'").get().c === 9950,
  "UPDATE amount=99.5 → amount_cents=9950",
);

// 4. 只改非金額欄 → cents 不變
db.prepare("UPDATE bookings SET status='attended' WHERE id='b1'").run();
assert(
  db.prepare("SELECT amount_cents c FROM bookings WHERE id='b1'").get().c === 9950,
  "UPDATE status（非金額）→ amount_cents 不變",
);

// 5. 經 createBooking 建 booking → bookings.amount_cents 同步
db.close();
const { createBooking } = require("../src/services/booking-service");
const res = createBooking({
  body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", amount: 120, penalty_consent: true },
  user: { id: "u1" },
});
const d2 = new Database(TMP);
const row = d2
  .prepare("SELECT amount, amount_cents FROM bookings WHERE user_id='u1' AND id!='b1'")
  .get();
assert(res.status === 201, `createBooking 回 201 (got ${res.status})`);
assert(
  row && row.amount_cents === Math.round(row.amount * 100),
  `經 createBooking 嘅 booking，amount_cents (${row && row.amount_cents}) = ROUND(amount*100)`,
);
d2.close();

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
try {
  fs.unlinkSync(TMP);
} catch (e) {}
process.exit(failed ? 1 : 0);
