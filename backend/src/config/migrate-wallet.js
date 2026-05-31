/**
 * ZenPass 禪流 — Wallet 資料庫遷移 v2
 *
 * 升級 wallet_transactions 表，加入：
 * - source_type / source_id：追蹤交易來源（booking、class、partner）
 * - coach_earning_id：連結教練收入記錄
 * - description：人類可讀描述
 * - 更新 type CHECK constraint 支援 class_income / partner_income / adjustment
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function migrate() {
  const db = new Database(DB_PATH);
  console.log(`[MIGRATE] Running wallet v2 migration on ${DB_PATH}...`);

  // Check current schema
  const columns = db.prepare("PRAGMA table_info(wallet_transactions)").all();
  const hasSourceType = columns.some((c) => c.name === "source_type");

  if (hasSourceType) {
    console.log("[MIGRATE] ✓ wallet_transactions already v2, skipping");
    db.close();
    return true;
  }

  // SQLite can't ALTER TABLE to add columns with CHECK constraints easily.
  // Since table is empty (0 rows), drop and recreate.
  db.exec("DROP TABLE IF EXISTS wallet_transactions");

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('class_income','rental_payment','withdrawal','refund','partner_income','adjustment')),
      amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      source_type TEXT DEFAULT '',
      source_id TEXT DEFAULT '',
      coach_earning_id TEXT DEFAULT '',
      description TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      fee REAL DEFAULT 0,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','failed')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Indexes for fast queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_type ON wallet_transactions(type);
    CREATE INDEX IF NOT EXISTS idx_wallet_source ON wallet_transactions(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_created ON wallet_transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wallet_earning ON wallet_transactions(coach_earning_id);
  `);

  const tableInfo = db.prepare("PRAGMA table_info(wallet_transactions)").all();
  console.log(
    `[MIGRATE] ✓ wallet_transactions table recreated with ${tableInfo.length} columns`,
  );

  db.close();
  return true;
}

if (require.main === module) {
  migrate();
  console.log("[MIGRATE] ✅ Wallet v2 migration complete");
}

module.exports = { migrate };
