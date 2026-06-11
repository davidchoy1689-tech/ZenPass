/**
 * ZenPass 生產環境 DB 修復 — 補充缺失欄位
 * 某些 migration 未在 production DB 執行，導致 code error
 */
const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/zenpass.db');

console.log(`DB: ${DB_PATH}`);

const db = new Database(DB_PATH);

const migrations = [
  { table: 'users', column: 'penalty_consent', type: 'INTEGER DEFAULT 0' },
  { table: 'users', column: 'agree_terms', type: 'INTEGER DEFAULT 0' },
];

for (const m of migrations) {
  try {
    // Check if column exists
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all();
    const exists = cols.some(c => c.name === m.column);
    
    if (!exists) {
      db.prepare(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`).run();
      console.log(`✅ Added ${m.table}.${m.column}`);
    } else {
      console.log(`ℹ️  ${m.table}.${m.column} already exists`);
    }
  } catch (e) {
    console.error(`❌ Migration failed: ${m.table}.${m.column} - ${e.message}`);
  }
}

db.close();
console.log('\n✅ DB migration check complete');
