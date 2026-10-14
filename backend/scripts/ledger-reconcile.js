#!/usr/bin/env node
/**
 * ZenPass v2.1 — 影子複式帳對帳 / 補帳
 *
 * 用途：
 *   node scripts/ledger-reconcile.js             → 只報告（trial balance + 覆蓋率）
 *   node scripts/ledger-reconcile.js --backfill  → 為未入帳嘅已付款 booking 補寫 ledger（idempotent）
 *
 * 安全：只新增、唔刪改；postBookingLedger 本身 idempotent（同 booking 已有分錄就唔重複）。
 * 退出碼：0 = balanced；1 = 唔平（需要跟進）。
 */
const path = require("path");
process.chdir(path.join(__dirname, "..")); // 確保 DB 相對路徑正確

const { getDb } = require("../src/services/database");
const accounting = require("../src/services/accounting");

const BACKFILL = process.argv.includes("--backfill");
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function main() {
  const db = getDb();

  // 1) 找出應有 ledger 但未入帳嘅 booking（已付款 / 已出席，amount>0）
  const paidBookings = db
    .prepare(
      `SELECT id, user_id, amount, payment_type, status, payment_status, platform_commission_rate
       FROM bookings
       WHERE status IN ('confirmed','attended','no_show') AND amount > 0`,
    )
    .all();

  const missing = [];
  for (const b of paidBookings) {
    const entries = accounting.getEntriesByBooking(b.id);
    const hasPayment = entries.some((e) => e.transaction_type === "payment");
    if (!hasPayment) missing.push(b);
  }

  let backfilled = 0;
  if (BACKFILL && missing.length) {
    for (const b of missing) {
      try {
        const ok = accounting.postBookingLedger(
          b.id,
          b.user_id,
          b.amount,
          b.payment_type === "credits" ? "credits" : "cash",
          b.platform_commission_rate,
        );
        if (ok) backfilled++;
      } catch (e) {
        console.error(`  ⚠️ backfill ${b.id} failed: ${e.message}`);
      }
    }
  }

  // 2) Trial balance
  const tb = accounting.trialBalance();

  // 3) 報告
  console.log("========================================");
  console.log(" ZenPass 影子複式帳 對帳報告 (v2.1)");
  console.log(" " + new Date().toISOString());
  console.log("========================================");
  console.log(`已付款 booking 數：${paidBookings.length}`);
  console.log(`未入帳 booking 數：${missing.length}${BACKFILL ? `（已補帳 ${backfilled}）` : "（用 --backfill 補帳）"}`);
  if (missing.length && !BACKFILL) {
    console.log("  未入帳例子：");
    missing.slice(0, 10).forEach((b) => console.log(`   - ${b.id}  $${b.amount}  ${b.status}/${b.payment_status}`));
  }
  console.log("----------------------------------------");
  if (!tb) {
    console.log("❌ trial balance 計算失敗");
    process.exit(1);
  }
  console.log(`總借 (Debit)  ：${round2(tb.totalDebit)}`);
  console.log(`總貸 (Credit) ：${round2(tb.totalCredit)}`);
  console.log(`平衡：${tb.balanced ? "✅ 是" : "❌ 否"}`);
  console.log("----------------------------------------");
  if (tb.accounts && tb.accounts.length) {
    console.log("帳戶結餘：");
    tb.accounts.forEach((a) =>
      console.log(`  ${a.account_code} ${a.account_name}  借 ${round2(a.total_debit)} / 貸 ${round2(a.total_credit)}  淨 ${round2(a.balance)}`),
    );
  }
  console.log("========================================");

  const ok = tb.balanced && (!missing.length || BACKFILL);
  process.exit(ok ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error("對帳失敗:", e.message);
  process.exit(1);
}
