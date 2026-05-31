/**
 * ZenPass 禪流 — IPO Audit Log 資料庫遷移
 *
 * 新增 audit_log 表，記錄所有金錢交易、狀態變更、管理員操作。
 * 此表不可刪改 (append-only)，以確保 audit trail 完整性。
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function migrate() {
  const db = new Database(DB_PATH);
  console.log(`[MIGRATE] Running audit_log migration on ${DB_PATH}...`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      user_id TEXT,
      old_values TEXT,
      new_values TEXT,
      description TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_action_type ON audit_log(action_type);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_entity_type ON audit_log(entity_type, created_at DESC);
  `);

  // Verify
  const tableInfo = db.prepare("PRAGMA table_info(audit_log)").all();
  console.log(
    `[MIGRATE] ✓ audit_log table created with ${tableInfo.length} columns`,
  );

  db.close();
  return true;
}

// Run directly or export for use in init-db.js
if (require.main === module) {
  migrate();
  console.log("[MIGRATE] ✅ Audit log migration complete");
}

module.exports = { migrate };
