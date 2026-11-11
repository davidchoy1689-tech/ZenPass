/**
 * Phase 2.1-RECON — 每日三方金流對帳
 *
 * Stripe 實收（payment_intent succeeded）vs user_passes 簽發實收 vs 補償隊列。
 * 差額 ≠ 0 → discrepancy_flagged。
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const stripeSvc = require("./stripe");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_reconciliation_reports (
      id TEXT PRIMARY KEY,
      reconciliation_date TEXT UNIQUE NOT NULL,
      stripe_total_cents INTEGER NOT NULL,
      db_passes_total_cents INTEGER NOT NULL,
      discrepancy_cents INTEGER NOT NULL,
      total_orders_count INTEGER NOT NULL,
      unresolved_queue_count INTEGER NOT NULL,
      status TEXT DEFAULT 'balanced',
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recon_date ON daily_reconciliation_reports(reconciliation_date);
  `);
}

function hktDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function hktRangeUtc(dateStr) {
  const start = new Date(dateStr + "T00:00:00+08:00");
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

async function stripeSucceededTotal(dateStr) {
  const s = stripeSvc.client();
  if (!s) return { total: null, count: 0, unavailable: true };
  const { start, end } = hktRangeUtc(dateStr);
  let total = 0, count = 0, starting_after;
  for (let page = 0; page < 20; page++) {
    const res = await s.paymentIntents.list({
      created: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    });
    for (const pi of res.data) {
      const md = pi.metadata || {};
      const isPassPurchase = md.product_type === "user_pass" || md.kind === "pass_purchase" || !!md.plan_key || md.product_type === "buddy_pass";
      if (!isPassPurchase) continue;
      if (pi.status === "succeeded" && pi.currency === "hkd") { total += Number(pi.amount_received || pi.amount || 0); count++; }
    }
    if (!res.has_more || !res.data.length) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return { total, count, unavailable: false };
}

async function runForDate(dateStr) {
  const db = getDb();
  ensureSchema(db);
  const date = dateStr || hktDate(new Date(Date.now() - 86400000));

  const passes = db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(CAST(ROUND(price_paid*100) AS INTEGER)),0) cents
       FROM user_passes
      WHERE payment_intent_id IS NOT NULL
        AND date(created_at, '+8 hours') = ?`,
  ).get(date);

  const queueRow = db.prepare(
    "SELECT COUNT(*) n FROM payment_fulfillments_queue WHERE status IN ('pending','failed_manual_review') AND date(created_at, '+8 hours') = ?",
  ).get(date);

  const stripe = await stripeSucceededTotal(date);
  const dbTotal = Number(passes.cents || 0);
  const stripeTotal = stripe.unavailable ? dbTotal : Number(stripe.total || 0);
  const discrepancy = stripeTotal - dbTotal;
  const status = discrepancy === 0 ? "balanced" : "discrepancy_flagged";
  const details = {
    stripe_unavailable: stripe.unavailable,
    stripe_orders: stripe.count,
    db_passes: Number(passes.n || 0),
    queue_unresolved: Number(queueRow.n || 0),
    mode: stripeSvc.mode(),
    generated_at: new Date().toISOString(),
  };

  const existing = db.prepare("SELECT id FROM daily_reconciliation_reports WHERE reconciliation_date=?").get(date);
  const id = existing?.id || crypto.randomUUID();
  db.prepare(
    `INSERT INTO daily_reconciliation_reports
       (id,reconciliation_date,stripe_total_cents,db_passes_total_cents,discrepancy_cents,total_orders_count,unresolved_queue_count,status,details)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(reconciliation_date) DO UPDATE SET
       stripe_total_cents=excluded.stripe_total_cents,
       db_passes_total_cents=excluded.db_passes_total_cents,
       discrepancy_cents=excluded.discrepancy_cents,
       total_orders_count=excluded.total_orders_count,
       unresolved_queue_count=excluded.unresolved_queue_count,
       status=excluded.status, details=excluded.details`,
  ).run(id, date, stripeTotal, dbTotal, discrepancy, Number(passes.n || 0), Number(queueRow.n || 0), status, JSON.stringify(details));

  if (status === "discrepancy_flagged") {
    try { require("./notification").sendTelegramAlert(`🚨 金流對帳差額 ${date}：HK$${(discrepancy / 100).toFixed(2)}`); } catch (e) {}
  }
  return db.prepare("SELECT * FROM daily_reconciliation_reports WHERE reconciliation_date=?").get(date);
}

function stats(db) {
  try { require("./marketplace").ensureSchema(db); } catch (e) {}
  const today = hktDate();
  const q = db.prepare("SELECT status, COUNT(*) n FROM payment_fulfillments_queue GROUP BY status").all();
  const get = (s) => Number(q.find((r) => r.status === s)?.n || 0);
  const fam = db.prepare("SELECT COUNT(*) n FROM family_groups").get().n;
  const credits = db.prepare(
    `SELECT COALESCE(SUM(remaining_credits),0) c FROM user_passes
      WHERE family_group_id IS NOT NULL AND status='active' AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
  ).get().c;
  const unbalanced = db.prepare(
    `SELECT COUNT(*) n FROM coach_earnings
      WHERE ABS(COALESCE(gross_amount_cents,0) - COALESCE(net_amount_cents,0)) > 0
        AND COALESCE(earning_type,'class_teaching')='class_teaching'
        AND COALESCE(commission_rate,0) NOT BETWEEN 0 AND 1`,
  ).get().n;
  const orphan = db.prepare(
    "SELECT COUNT(*) n FROM bookings b LEFT JOIN class_schedules s ON s.id=b.schedule_id WHERE s.id IS NULL AND b.status<>'cancelled'",
  ).get().n;
  const last = db.prepare("SELECT * FROM daily_reconciliation_reports ORDER BY reconciliation_date DESC LIMIT 1").get();
  return {
    status: get("failed_manual_review") > 0 ? "attention" : "healthy",
    timestamp: new Date().toISOString(),
    stripe_mode: stripeSvc.mode(),
    queue_metrics: { pending_count: get("pending"), failed_manual_review_count: get("failed_manual_review") },
    family_passes_metrics: { active_family_groups: Number(fam), total_remaining_credits: Number(credits) },
    audit_integrity: { unbalanced_coach_earnings: Number(unbalanced), orphan_bookings_count: Number(orphan) },
    last_reconciliation: last ? { date: last.reconciliation_date, status: last.status, discrepancy_cents: last.discrepancy_cents } : null,
    today,
  };
}

module.exports = { ensureSchema, runForDate, stats, hktDate };
