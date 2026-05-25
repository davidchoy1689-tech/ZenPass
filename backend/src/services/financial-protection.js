/**
 * ZenPass 禪流 — 金融記錄保護系統（IPO Audit 級別）
 *
 * 核心規則：
 * - wallet_transactions, coach_earnings, coach_payouts, bookings,
 *   audit_log, ledger, transactions 等金錢相關 table
 * - 只准 INSERT / UPDATE status
 * - 禁止 DELETE row
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../data/zenpass.db");

// 所有受保護嘅金融 table
const PROTECTED_TABLES = [
  "wallet_transactions",
  "coach_earnings",
  "coach_payouts",
  "bookings",
  "audit_log",
  "ledger",
  "transactions",
  "private_income",
  "venue_rentals",
  "partner_payouts",
  "refund_logs",
  "idempotency_keys",
];

/**
 * 安裝 SQLite trigger — 防止 DELETE 金錢記錄
 */
function installDeleteTriggers() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  let installed = 0;
  for (const table of PROTECTED_TABLES) {
    try {
      // 檢查 trigger 是否已存在
      const existing = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
        )
        .get(`protect_${table}_delete`);

      if (!existing) {
        db.exec(`
          CREATE TRIGGER protect_${table}_delete
          BEFORE DELETE ON ${table}
          BEGIN
            SELECT RAISE(ABORT, '❌ 禁止刪除 ${table} 記錄 — 只准 UPDATE status');
          END;
        `);
        installed++;
      }
    } catch (err) {
      console.error(`[PROTECT] Failed to install trigger for ${table}:`, err.message);
    }
  }

  console.log(`[PROTECT] ✅ ${installed} DELETE triggers installed`);
  db.close();
  return installed;
}

/**
 * 檢查金融記錄完整性 — 每日維護用
 */
function verifyFinancialIntegrity() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const results = {};
  let hasError = false;

  for (const table of PROTECTED_TABLES) {
    try {
      const count = db
        .prepare(`SELECT COUNT(*) as count FROM ${table}`)
        .get().count;
      results[table] = { status: "ok", rows: count };

      // 檢查 trigger 是否存在
      const trigger = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
        )
        .get(`protect_${table}_delete`);

      if (!trigger) {
        results[table].warning = "⚠️ DELETE trigger missing";
        hasError = true;
      }
    } catch (err) {
      results[table] = { status: "error", error: err.message };
      hasError = true;
    }
  }

  db.close();
  return { success: !hasError, tables: results };
}

/**
 * 驗證 booking 四邊拆賬數據一致性
 */
function verifyBookingIntegrity() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const issues = [];

  // 檢查每個 booking 嘅 amount = platform_earned + venue_earned + coach_earnings?
  // 注意：coach_earnings 唔係直接放喺 booking，係喺 coach_earnings table
  // 所以用 coach_earnings 做 cross-reference
  const rows = db
    .prepare(
      `
    SELECT b.id, b.booking_reference, b.amount, b.platform_earned_amount,
           b.venue_earned_amount,
           COALESCE((SELECT SUM(net_amount) FROM coach_earnings WHERE schedule_id = b.schedule_id), 0) as coach_amount
    FROM bookings b
    WHERE b.status IN ('confirmed', 'attended')
      AND (b.platform_earned_amount > 0 OR b.amount > 0)
  `,
    )
    .all();

  for (const row of rows) {
    // 四邊總和應該約等於 amount
    const totalSplit =
      (row.platform_earned_amount || 0) +
      (row.venue_earned_amount || 0) +
      (row.coach_amount || 0);

    // 容許微小誤差（四捨五入）
    const diff = Math.abs(totalSplit - (row.amount || 0));
    if (diff > 0.1 && row.amount > 0) {
      issues.push({
        booking_id: row.id,
        reference: row.booking_reference,
        amount: row.amount,
        platform: row.platform_earned_amount,
        venue: row.venue_earned_amount,
        coach: row.coach_amount,
        total_split: totalSplit,
        diff: diff,
      });
    }
  }

  db.close();
  return { issues, total_checked: rows.length };
}

module.exports = {
  installDeleteTriggers,
  verifyFinancialIntegrity,
  verifyBookingIntegrity,
  PROTECTED_TABLES,
};
