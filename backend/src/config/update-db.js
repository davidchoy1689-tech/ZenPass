const Database = require("better-sqlite3");
const path = require("path");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function updateDatabase() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Add commission_rate column to users (for coach commission)
  try {
    db.exec("ALTER TABLE users ADD COLUMN commission_rate REAL DEFAULT 0.75");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN total_earnings REAL DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN pending_payout REAL DEFAULT 0");
  } catch (e) {}

  // Coach earnings table — auto-calculated from schedules
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_earnings (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      schedule_id TEXT,
      class_id TEXT,
      class_title TEXT,
      date TEXT NOT NULL,
      enrolled_count INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      gross_amount REAL DEFAULT 0,
      commission_rate REAL DEFAULT 0.75,
      net_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','paid','cancelled')),
      payout_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id),
      FOREIGN KEY (schedule_id) REFERENCES class_schedules(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
  `);

  // Coach payout requests
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_payouts (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      net_amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'bank' CHECK(payment_method IN ('bank','fps','payme')),
      bank_name TEXT,
      bank_account TEXT,
      bank_code TEXT,
      fps_phone TEXT,
      payme_phone TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','rejected','cancelled')),
      notes TEXT,
      processed_by TEXT,
      processed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id)
    );
  `);

  // Indexes
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_earnings_coach ON coach_earnings(coach_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_earnings_date ON coach_earnings(date)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_earnings_status ON coach_earnings(status)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_payouts_coach ON coach_payouts(coach_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_payouts_status ON coach_payouts(status)",
    );
  } catch (e) {}

  // ===== Migration: Add pending_payment status to bookings =====
  try {
    // SQLite can't ALTER CHECK constraint, so we rebuild the table
    const bookingSchema = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'",
      )
      .get();
    if (
      bookingSchema &&
      bookingSchema.sql &&
      bookingSchema.sql.indexOf("pending_payment") === -1
    ) {
      db.exec(`
        CREATE TABLE bookings_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          schedule_id TEXT NOT NULL,
          class_id TEXT NOT NULL,
          payment_type TEXT CHECK(payment_type IN ('single','credits','membership_trial','membership_standard','membership_unlimited')),
          payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','refunded','cancelled')),
          amount REAL,
          stripe_payment_intent_id TEXT,
          fps_reference TEXT,
          payme_reference TEXT,
          status TEXT DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','confirmed','attended','cancelled','no_show')),
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (schedule_id) REFERENCES class_schedules(id),
          FOREIGN KEY (class_id) REFERENCES classes(id)
        );
      `);
      db.exec("INSERT INTO bookings_new SELECT * FROM bookings");
      db.exec("DROP TABLE bookings");
      db.exec("ALTER TABLE bookings_new RENAME TO bookings");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_bookings_schedule ON bookings(schedule_id)",
      );
      console.log(
        "✅ Migration: bookings table updated with pending_payment status",
      );
    }
  } catch (e) {
    console.log("⚠️ Migration skip (maybe already applied):", e.message);
  }

  // ===== Migration: Auto-set old pending bookings to pending_payment =====
  try {
    db.exec(
      "UPDATE bookings SET status = 'pending_payment' WHERE status = 'confirmed' AND payment_status = 'pending'",
    );
    console.log(
      "✅ Migration: Updated old pending bookings to pending_payment status",
    );
  } catch (e) {
    console.log("⚠️ Migration skip:", e.message);
  }

  console.log("✅ 資料庫更新完成");
  db.close();
}

if (require.main === module) updateDatabase();
module.exports = updateDatabase;
