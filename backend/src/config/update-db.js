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

  // ===== Migration: 放寬 bookings.payment_status CHECK 加入 'partial_refund' =====
  // refund.js 會寫 'partial_refund'，但舊 CHECK 唔准 → 部分退款會 throw。
  // SQLite 改唔到 CHECK，所以要重建表（用現有 DDL 改字串，保留所有欄位/index/trigger）。
  try {
    const bk = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'",
      )
      .get();
    if (bk && bk.sql && bk.sql.indexOf("'partial_refund'") === -1) {
      const cols = db
        .prepare("PRAGMA table_info(bookings)")
        .all()
        .map((c) => c.name);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const idxSqls = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='bookings' AND sql IS NOT NULL",
        )
        .all()
        .map((r) => r.sql);
      const trgSqls = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='bookings'",
        )
        .all()
        .map((r) => r.sql);
      const newSql = bk.sql
        .replace(
          /CREATE TABLE\s+(IF NOT EXISTS\s+)?"?bookings"?/i,
          "CREATE TABLE bookings_new",
        )
        .replace("'refunded'", "'refunded','partial_refund'");
      db.pragma("foreign_keys = OFF");
      db.exec("BEGIN");
      try {
        db.exec(newSql);
        db.prepare(
          `INSERT INTO bookings_new (${colList}) SELECT ${colList} FROM bookings`,
        ).run();
        db.exec("DROP TABLE bookings");
        db.exec("ALTER TABLE bookings_new RENAME TO bookings");
        for (const s of idxSqls) db.exec(s);
        for (const s of trgSqls) db.exec(s);
        db.exec("COMMIT");
        console.log(
          "✅ Migration: bookings payment_status CHECK 加入 partial_refund",
        );
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        db.pragma("foreign_keys = ON");
      }
    }
  } catch (e) {
    console.log("⚠️ partial_refund migration skip:", e.message);
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

  // ============ 商戶加盟系統 Migration ============

  // Table: partner_venues — 商戶/場地資料
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_venues (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      contact_person TEXT,
      commission_rate REAL DEFAULT 0.3,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','suspended','rejected')),
      logo_url TEXT,
      category TEXT,
      district TEXT,
      tags TEXT,
      business_hours TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Table: partner_payouts — 商戶結算記錄
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_payouts (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      total_revenue REAL DEFAULT 0,
      platform_commission REAL DEFAULT 0,
      venue_earned REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid')),
      paid_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES partner_venues(id)
    );
  `);

  // Add venue_partner columns to bookings (ALTER TABLE)
  try {
    db.exec("ALTER TABLE bookings ADD COLUMN venue_partner_id TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE bookings ADD COLUMN platform_commission_rate REAL");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE bookings ADD COLUMN venue_earned_amount REAL");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE bookings ADD COLUMN platform_earned_amount REAL");
  } catch (e) {}

  // Indexes for partner tables
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_partner_venues_status ON partner_venues(status)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_partner_venues_category ON partner_venues(category)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_partner_venues_user ON partner_venues(user_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_partner_payouts_venue ON partner_payouts(venue_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_partner_payouts_status ON partner_payouts(status)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_bookings_venue_partner ON bookings(venue_partner_id)",
    );
  } catch (e) {}

  console.log("✅ 商戶加盟系統 migration 完成");

  // ===== Migration 8: 加入 penalty_consent 同 agree_terms 欄位 =====
  try {
    db.exec("ALTER TABLE users ADD COLUMN penalty_consent INTEGER DEFAULT 0");
    console.log("✅ 加入 users.penalty_consent");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN agree_terms INTEGER DEFAULT 0");
    console.log("✅ 加入 users.agree_terms");
  } catch (e) {}

  // ===== Migration 9: 補回生產已有嘅 users 欄位（schema parity） =====
  // 呢啲欄位喺生產已存在（wallet-service / auth 有用），但 repo schema 漏咗 →
  // 令 fresh / CI DB 會 missing column。喺度冪等補回。
  const userCols = [
    ["wallet_balance", "REAL DEFAULT 0"],
    ["bank_name", "TEXT"],
    ["bank_account", "TEXT"],
    ["bank_code", "TEXT"],
    ["reset_token", "TEXT"],
    ["reset_token_expires", "TEXT"],
    ["plan_id", "TEXT"],
  ];
  for (const [name, def] of userCols) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
      console.log(`✅ 加入 users.${name}`);
    } catch (e) {
      /* 已存在 → 略過 */
    }
  }
  console.log("✅ users schema parity migration 完成");

  // ===== Migration 10.5: venue_rentals 收款狀態（escrow）=====
  try { db.exec("ALTER TABLE venue_rentals ADD COLUMN payment_status TEXT DEFAULT 'unpaid'"); } catch (e) {}
  try { db.exec("ALTER TABLE venue_rentals ADD COLUMN paid_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE venue_rentals ADD COLUMN payment_method TEXT"); } catch (e) {}
  try {
    db.exec("CREATE TABLE IF NOT EXISTS venue_settlements (id TEXT PRIMARY KEY, venue_id TEXT, month TEXT, gross_hkd REAL DEFAULT 0, commission_hkd REAL DEFAULT 0, penalties_hkd REAL DEFAULT 0, net_hkd REAL DEFAULT 0, status TEXT DEFAULT 'pending', payout_date TEXT, paid_at TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(venue_id, month))");
  } catch (e) {}

  // ===== Migration 11: classes.district（按課程地區自動分區）=====
  try {
    db.exec("ALTER TABLE classes ADD COLUMN district TEXT");
    console.log("✅ 加入 classes.district");
  } catch (e) {
    /* 已存在 */
  }
  try {
    const { resolveDistrict, DISTRICTS } = require("../services/district");
    const names = new Set(DISTRICTS.map((d) => d.name));
    const rows = db
      .prepare("SELECT id, venue_address, venue_name, partner_venue_id, district FROM classes")
      .all();
    const upd = db.prepare("UPDATE classes SET district = ? WHERE id = ?");
    const pvStmt = db.prepare("SELECT district FROM partner_venues WHERE id = ?");
    let n = 0;
    for (const r of rows) {
      let pvDist = "";
      if (r.partner_venue_id) {
        try {
          const pv = pvStmt.get(r.partner_venue_id);
          if (pv && pv.district) pvDist = pv.district;
        } catch (e) {
          /* partner_venues 可能未存在 */
        }
      }
      let dist = resolveDistrict(pvDist);
      if (!dist) dist = resolveDistrict([r.venue_address, r.venue_name].filter(Boolean).join(" "));
      if (!dist && r.district && names.has(r.district)) dist = r.district;
      if (dist && dist !== r.district) {
        upd.run(dist, r.id);
        n++;
      }
    }
    console.log(`✅ classes.district 標準化: ${n} 條`);
  } catch (e) {
    console.log("⚠️ classes.district backfill:", e.message);
  }

  // ===== Migration 12: classes.booking_open（是否開放預約）=====
  try {
    db.exec("ALTER TABLE classes ADD COLUMN booking_open INTEGER DEFAULT 0");
    console.log("✅ 加入 classes.booking_open");
  } catch (e) {
    /* 已存在 */
  }
  try {
    db.prepare("CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))").run();
    const mk = "migration.booking_open_v1";
    const _cnt = db.prepare("SELECT COUNT(*) AS c FROM classes").get().c;
    if (_cnt > 0 && !db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(mk)) {
      const r = db
        .prepare(
          "UPDATE classes SET booking_open = CASE WHEN (category LIKE '%身心%' OR category LIKE '%伸展%' OR title LIKE '%伸展%') THEN 1 ELSE 0 END",
        )
        .run();
      db.prepare("INSERT OR REPLACE INTO platform_settings (key,value,description) VALUES (?,?,?)").run(mk, "1", "booking_open 初始分配：只開放身心伸展");
      if (r.changes) console.log(`✅ booking_open 初始分配 ${r.changes} 條`);
    }
  } catch (e) {
    console.log("⚠️ booking_open backfill:", e.message);
  }

  // ===== Migration 13: Schema parity (prod -> repo) =====
  // 生產有、但 repo schema 未定義嘅表 / 欄位（避免 fresh / CI DB 唔完整）。
  // 表用 schema-parity.sql（CREATE IF NOT EXISTS）；欄用 ALTER（逐條 try/catch）。
  try {
    const fs = require("fs");
    const path = require("path");
    const paritySql = fs.readFileSync(
      path.join(__dirname, "schema-parity.sql"),
      "utf8",
    );
    db.exec(paritySql);
    const alters = JSON.parse(
      fs.readFileSync(path.join(__dirname, "schema-parity-columns.json"), "utf8"),
    );
    let applied = 0;
    for (const a of alters) {
      try {
        db.exec(a);
        applied++;
      } catch (e) {
        /* 已存在 → 略過 */
      }
    }
    // indexes 要喺欄位之後（部分 index 建喺新增欄上）
    try {
      db.exec(
        fs.readFileSync(path.join(__dirname, "schema-parity-indexes.sql"), "utf8"),
      );
    } catch (e) {
      /* ignore */
    }
    console.log(
      `✅ schema parity：tables/indexes 已補；欄位 +${applied}/${alters.length}`,
    );
  } catch (e) {
    console.log("⚠️ schema parity migration：", e.message);
  }

  // ===== Migration 11: 優惠碼 (promo / coupon) =====
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('fixed_price','fixed_discount','percent')),
        value REAL NOT NULL,
        class_id TEXT,
        max_uses INTEGER,
        used_count INTEGER DEFAULT 0,
        per_user_limit INTEGER DEFAULT 1,
        valid_from TEXT,
        valid_to TEXT,
        active INTEGER DEFAULT 1,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS promo_redemptions (
        id TEXT PRIMARY KEY,
        code_id TEXT NOT NULL,
        user_id TEXT,
        booking_id TEXT,
        amount REAL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(code_id)");
    console.log("✅ promo_codes / promo_redemptions ready");
  } catch (e) {
    console.log("⚠️ promo migration:", e.message);
  }

  console.log("✅ 資料庫更新完成");
  db.close();
}

if (require.main === module) updateDatabase();
module.exports = updateDatabase;
