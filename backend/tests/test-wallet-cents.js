#!/usr/bin/env node
/**
 * test-wallet-cents.js — 錢包結餘整數 cents 運算測試 (Phase 1 / S3)
 *
 * 驗證：creditCoachEarning / debitWallet 用整數 cents 計結餘 → 唔會出現
 *       浮點累積誤差（例如 0.1 + 0.2 = 0.30000000000000004）。
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const TMP = path.join(os.tmpdir(), "zenpass-wallet-cents-" + Date.now() + ".db");
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

console.log("🧪 錢包結餘 cents 測試");

initDatabase();
updateDatabase();

const db = new Database(TMP);
db.pragma("foreign_keys = ON");
db.prepare(
  "INSERT INTO users (id,email,name,role,email_verified,wallet_balance) VALUES ('coach1','c1@test.hk','C1','coach',1,0.1)",
).run();
db.close();

const { creditCoachEarning, debitWallet } = require("../src/services/wallet-service");

// 0.1 + 0.2 → 一定要 0.3（float 會 0.30000000000000004）
const c = creditCoachEarning({
  coachId: "coach1",
  scheduleId: "s1",
  coachEarningId: "e1",
  netAmount: 0.2,
  description: "test",
});
assert(c.success === true, "creditCoachEarning 成功");
assert(c.balance_after === 0.3, `0.1 + 0.2 = 0.3（got ${c.balance_after}）`);

// 扣 0.15 + 0.05 fee → 0.30 - 0.20 = 0.10
const d = debitWallet({
  userId: "coach1",
  amount: 0.15,
  fee: 0.05,
  type: "withdrawal",
  description: "test debit",
});
assert(d.success === true, "debitWallet 成功");
assert(d.balance_after === 0.1, `0.30 - (0.15+0.05) = 0.10（got ${d.balance_after}）`);

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
try {
  fs.unlinkSync(TMP);
} catch (e) {}
process.exit(failed ? 1 : 0);
