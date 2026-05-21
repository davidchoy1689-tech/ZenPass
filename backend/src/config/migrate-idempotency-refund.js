/**
 * ZenPass 禪流 — Idempotency Keys + Refund Logs Migration
 *
 * Phase 1 Day 5: 重複交易防護 + 退款審計
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function migrate() {
  const db = new Database(DB_PATH);
  console.log(`[MIGRATE] Running idempotency+refund migration on ${DB_PATH}...`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id TEXT PRIMARY KEY,
      response_data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

    CREATE TABLE IF NOT EXISTS refund_logs (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'HKD',
      payment_method TEXT DEFAULT 'fps',
      reason TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      approved_by TEXT,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_refund_booking ON refund_logs(booking_id);
    CREATE INDEX IF NOT EXISTS idx_refund_status ON refund_logs(status);
    CREATE INDEX IF NOT EXISTS idx_refund_created ON refund_logs(created_at);
  `);

  console.log("[MIGRATE] ✓ idempotency_keys + refund_logs tables created");
  db.close();
  return true;
}

if (require.main === module) {
  migrate();
  console.log("[MIGRATE] ✅ Idempotency + Refund migration complete");
}

module.exports = { migrate };
