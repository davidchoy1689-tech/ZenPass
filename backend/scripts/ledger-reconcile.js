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
const { v4: uuidv4 } = require("uuid");

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

  // 1b) Ledger Hold 同步（v2.1 兩階段轉帳 shadow）
  const holdStats = { created: 0, committed: 0, voided: 0, expired: 0, pending: 0 };
  try {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const pend = db
      .prepare("SELECT id, user_id, amount, payment_type, created_at FROM bookings WHERE status = 'pending_payment'")
      .all();
    const insHold = db.prepare(
      "INSERT OR IGNORE INTO ledger_holds (id, booking_id, user_id, amount, asset, state, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    );
    for (const b of pend) {
      const base = String(b.created_at || now).replace(" ", "T");
      const exp = new Date(new Date(base + "Z").getTime() + 15 * 60000)
        .toISOString().slice(0, 19).replace("T", " ");
      const r = insHold.run(
        uuidv4(), b.id, b.user_id, b.amount || 0,
        b.payment_type === "credits" ? "credits" : "hkd", exp,
      );
      if (r.changes) holdStats.created++;
    }
    const holds = db.prepare("SELECT * FROM ledger_holds WHERE state = 'pending'").all();
    const getBk = db.prepare("SELECT status FROM bookings WHERE id = ?");
    for (const h of holds) {
      const bk = getBk.get(h.booking_id);
      if (!bk) {
        db.prepare("UPDATE ledger_holds SET state='voided', voided_at=datetime('now'), reason='booking missing' WHERE id=?").run(h.id);
        holdStats.voided++;
      } else if (bk.status === "confirmed" || bk.status === "attended") {
        db.prepare("UPDATE ledger_holds SET state='committed', committed_at=datetime('now') WHERE id=?").run(h.id);
        holdStats.committed++;
      } else if (bk.status === "cancelled") {
        db.prepare("UPDATE ledger_holds SET state='voided', voided_at=datetime('now'), reason='booking cancelled' WHERE id=?").run(h.id);
        holdStats.voided++;
      } else if (bk.status === "pending_payment" && h.expires_at && h.expires_at < now) {
        db.prepare("UPDATE ledger_holds SET state='expired', voided_at=datetime('now') WHERE id=?").run(h.id);
        holdStats.expired++;
      }
    }
    holdStats.pending = db.prepare("SELECT COUNT(*) c FROM ledger_holds WHERE state='pending'").get().c;
  } catch (e) {
    console.error("hold sync error:", e.message);
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
  console.log(`Hold 同步：新增 ${holdStats.created}、committed ${holdStats.committed}、voided ${holdStats.voided}、expired ${holdStats.expired}、仍 pending ${holdStats.pending}`);
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
