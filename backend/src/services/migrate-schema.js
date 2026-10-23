/**
 * 輕量 schema migration（idempotent）
 * 只做 additive 變更（ADD COLUMN / CREATE TABLE IF NOT EXISTS），
 * 唔會重建任何金融表，避免影響 audit trail。
 */
const { getDb } = require("./database");

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (e) {
    return false;
  }
}

function addColumnIfMissing(db, table, col, ddl) {
  if (!hasColumn(db, table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    console.log(`[migrate] ${table}.${col} added`);
  }
}

function runMigrations() {
  const db = getDb();

  // 2026-10-23：退款狀態（唔改 payment_status 嘅 CHECK constraint，避免重建 bookings 表）
  // NULL = 無退款；pending = 待人手轉賬；completed = 已退款
  addColumnIfMissing(db, "bookings", "refund_state", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "bookings", "refund_requested_at", "TEXT DEFAULT NULL");

  // 訪客 session
  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_guest_sessions_user ON guest_sessions(user_id);
  `);

  // 訪客帳號合併紀錄（audit）
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_merges (
      id TEXT PRIMARY KEY,
      guest_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      moved_bookings INTEGER DEFAULT 0,
      merged_by TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { runMigrations };
