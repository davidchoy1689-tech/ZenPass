/**
 * Install SQLite DELETE triggers on financial tables (IPO audit protection)
 */
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "zenpass.db");

function installTriggers() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const FINANCIAL_TABLES = [
    "wallet_transactions",
    "coach_earnings",
    "coach_payouts",
    "bookings",
    "ledger",
    "audit_log",
    "refund_logs",
    "idempotency_keys",
    "booking_payments",
    "memberships",
    "corporate_companies",
    "corporate_members",
  ];

  let count = 0;
  for (const table of FINANCIAL_TABLES) {
    // Check table exists first
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!exists) {
      console.log(`[FIN-TRIGGER] ⏭️ Table ${table} doesn't exist, skipping`);
      continue;
    }

    try {
      db.prepare(`
        CREATE TRIGGER IF NOT EXISTS prevent_delete_${table}
        BEFORE DELETE ON ${table}
        BEGIN
          SELECT RAISE(ABORT, 'DELETE blocked on financial table: ${table}');
        END
      `).run();
      console.log(`[FIN-TRIGGER] ✅ Trigger installed on ${table}`);
      count++;
    } catch (err) {
      console.error(`[FIN-TRIGGER] ❌ Failed on ${table}: ${err.message}`);
    }
  }

  db.close();
  console.log(`[FIN-TRIGGER] ✅ ${count} triggers installed`);
  return count;
}

if (require.main === module) {
  installTriggers();
}

module.exports = { installTriggers };
