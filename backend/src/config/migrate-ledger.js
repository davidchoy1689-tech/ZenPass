/**
 * ZenPass 禪流 — Ledger 會計分錄表 Migration
 *
 * Double-entry bookkeeping table for IPO-ready financial tracking.
 * Every payment/refund/payout creates debit+credit entries.
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function migrate() {
  const db = new Database(DB_PATH);
  console.log(`[MIGRATE] Running ledger migration on ${DB_PATH}...`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('payment','refund','commission','payout')),
      payment_method TEXT DEFAULT 'stripe',
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_booking ON ledger(booking_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_code);
    CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger(reference);
  `);

  const tableInfo = db.prepare("PRAGMA table_info(ledger)").all();
  console.log(
    `[MIGRATE] ✓ ledger table created with ${tableInfo.length} columns`,
  );

  db.close();
  return true;
}

if (require.main === module) {
  migrate();
  console.log("[MIGRATE] ✅ Ledger migration complete");
}

module.exports = { migrate };
