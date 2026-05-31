/**
 * ZenPass 禪流 — 聚合平台強化 Migration
 *
 * Phase 2 Day 1: 跨商戶預約流程強化
 * - classes 加入 partner_venue_id FK（取代名配對）
 * - 確保 booking 自動關聯正確商戶
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function migrate() {
  const db = new Database(DB_PATH);
  console.log(`[MIGRATE] Running aggregation migration on ${DB_PATH}...`);

  // Step 1: Add partner_venue_id to classes (if not exists)
  const cols = db.prepare("PRAGMA table_info(classes)").all();
  const hasPartnerFk = cols.some((c) => c.name === "partner_venue_id");
  if (!hasPartnerFk) {
    db.exec(`
      ALTER TABLE classes ADD COLUMN partner_venue_id TEXT REFERENCES partner_venues(id);
      CREATE INDEX IF NOT EXISTS idx_classes_partner ON classes(partner_venue_id);
    `);
    console.log("[MIGRATE] ✓ Added partner_venue_id to classes");

    // Auto-link existing classes to partners by venue_name
    const linked = db
      .prepare(
        `
      UPDATE classes SET partner_venue_id = (
        SELECT id FROM partner_venues 
        WHERE partner_venues.name = classes.venue_name 
        AND partner_venues.status = 'active'
        LIMIT 1
      )
      WHERE partner_venue_id IS NULL
    `,
      )
      .run();
    console.log(
      `[MIGRATE] ✓ Auto-linked ${linked.changes} classes to partners`,
    );
  } else {
    console.log("[MIGRATE] ✓ partner_venue_id column already exists");
  }

  db.close();
  return true;
}

if (require.main === module) {
  migrate();
  console.log("[MIGRATE] ✅ Aggregation migration complete");
}

module.exports = { migrate };
