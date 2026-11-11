/**
 * Phase 5.2 — 真實履約信譽 + 輔具商城（Drop-shipping）
 *
 * 評價閘門：attendance_status='present' AND fraud_audit_status='clean'，課後 7 天內，一單一評。
 * 商城：平台零庫存，教練帶貨分佣寫入 coach_earnings（affiliate_product_commission），
 *       與帶班收益同一月結 FPS 清算。
 */
const { v4: uuidv4 } = require("uuid");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verified_reviews (
      id TEXT PRIMARY KEY,
      booking_id TEXT UNIQUE NOT NULL,
      schedule_id TEXT,
      coach_id TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      rating_score INTEGER NOT NULL,
      pain_relief_score INTEGER,
      content TEXT,
      coach_reply TEXT,
      coach_replied_at TEXT,
      is_anonymous INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_coach ON verified_reviews(coach_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reviews_schedule ON verified_reviews(schedule_id);

    CREATE TABLE IF NOT EXISTS marketplace_products (
      id TEXT PRIMARY KEY,
      supplier_name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      recommended_audiences TEXT,
      cost_price_cents INTEGER NOT NULL,
      retail_price_cents INTEGER NOT NULL,
      coach_commission_cents INTEGER NOT NULL,
      platform_margin_cents INTEGER NOT NULL,
      image_url TEXT,
      stock_quantity INTEGER DEFAULT 999,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON marketplace_products(category, is_active);

    CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      coach_id TEXT,
      product_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price_cents INTEGER NOT NULL,
      total_paid_cents INTEGER NOT NULL,
      commission_cents INTEGER DEFAULT 0,
      shipping_name TEXT NOT NULL,
      shipping_phone TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      shipping_district TEXT NOT NULL,
      sf_tracking_no TEXT,
      supplier_order_ref TEXT,
      order_status TEXT DEFAULT 'pending_payment',
      payment_intent_id TEXT,
      paid_at TEXT,
      dispatched_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pi ON marketplace_orders(payment_intent_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON marketplace_orders(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_coach ON marketplace_orders(coach_id, created_at);
  `);

  const cols = db.prepare("PRAGMA table_info(coach_earnings)").all().map((c) => c.name);
  [['earning_type', "TEXT DEFAULT 'class_teaching'"], ['payout_month', 'TEXT'], ['product_order_id', 'TEXT'], ['clearing_batch_id', 'TEXT'], ['bank_tx_id', 'TEXT'], ['clearing_status', "TEXT DEFAULT 'pending'"], ['held_reason', 'TEXT']].forEach(([n, t]) => {
    if (!cols.includes(n)) db.exec(`ALTER TABLE coach_earnings ADD COLUMN ${n} ${t}`);
  });
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_earnings_type ON coach_earnings(earning_type, payout_month)"); } catch (e) {}
}

function monthKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit" }).format(d);
}

function maskName(name) {
  const s = String(name || "").trim();
  if (!s) return "匿名學員";
  if (/^[A-Za-z]/.test(s)) return s.slice(0, 2) + "***";
  return s.slice(0, 1) + "＊" + (s.length > 2 ? "＊" : "");
}

function coachStats(db, coachId) {
  const row = db.prepare(
    `SELECT COUNT(*) n, AVG(rating_score) avg_rating,
            SUM(CASE WHEN pain_relief_score >= 4 THEN 1 ELSE 0 END) relief_hits,
            SUM(CASE WHEN pain_relief_score IS NOT NULL THEN 1 ELSE 0 END) relief_total
       FROM verified_reviews WHERE coach_id=?`,
  ).get(coachId);
  const n = Number(row.n || 0);
  return {
    review_count: n,
    avg_rating: n ? Math.round(Number(row.avg_rating) * 10) / 10 : 0,
    pain_relief_rate: Number(row.relief_total) > 0 ? Math.round((Number(row.relief_hits) / Number(row.relief_total)) * 1000) / 10 : null,
    pain_relief_samples: Number(row.relief_total || 0),
  };
}

function recalcCoachRating(db, coachId) {
  const s = coachStats(db, coachId);
  try { db.prepare("UPDATE users SET rating=? WHERE id=?").run(s.avg_rating, coachId); } catch (e) {}
  return s;
}

module.exports = { ensureSchema, monthKey, maskName, coachStats, recalcCoachRating, uuidv4 };
