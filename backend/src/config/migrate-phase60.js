/**
 * Phase 6.0 — 驗收後封網與每日平帳：資料庫遷移
 *
 * 設計原則（David 2026-11-12）：
 *  1) 只做「加欄／建表」，永不 DROP、永不改歷史資料
 *  2) 完全 idempotent，可以重複執行
 *  3) 由 `scripts/post-acceptance-lockdown.js --confirm` 或
 *     `node src/config/migrate-phase60.js` 手動觸發，
 *     **唔會** 喺 server 啟動時自動跑（避免未驗收就改生產 schema）
 */

const ADDED_COLUMNS = [
  ["user_passes", "is_acceptance_test", "INTEGER DEFAULT 0"],
  ["bookings", "is_acceptance_test", "INTEGER DEFAULT 0"],
  ["coach_earnings", "is_acceptance_test", "INTEGER DEFAULT 0"],
];

function tableColumns(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  } catch (e) {
    return [];
  }
}

function run(db) {
  const report = { addedColumns: [], createdTable: false };

  for (const [table, col, ddl] of ADDED_COLUMNS) {
    const cols = tableColumns(db, table);
    if (!cols.length) continue; // 表唔存在（例如精簡測試 DB）→ 跳過
    if (cols.includes(col)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    report.addedColumns.push(`${table}.${col}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_reconciliation_logs (
      id TEXT PRIMARY KEY,
      audit_date TEXT UNIQUE NOT NULL,
      total_passes_sold INTEGER DEFAULT 0,
      total_stripe_cents INTEGER DEFAULT 0,
      total_bookings_present INTEGER DEFAULT 0,
      total_coach_earnings_cents INTEGER DEFAULT 0,
      discrepancy_count INTEGER DEFAULT 0,
      discrepancy_details TEXT,
      status TEXT CHECK(status IN ('balanced','discrepancy_detected')) NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  report.createdTable = true;
  return report;
}

module.exports = { run, ADDED_COLUMNS, tableColumns };

if (require.main === module) {
  const { getDb } = require("../services/database");
  const db = getDb();
  const r = run(db);
  console.log("✅ Phase 6.0 migration 完成");
  console.log("   新增欄位:", r.addedColumns.length ? r.addedColumns.join(", ") : "（已存在，無需變更）");
  console.log("   稽核表 daily_reconciliation_logs: 已就緒");
}
