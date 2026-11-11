/**
 * Phase 3.1 — Studio 三方分帳（平台 / 館方 / 駐場教練），整數 cents、冪等
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const { creditWallet } = require("./wallet-service");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_earnings_ledger (
      id TEXT PRIMARY KEY,
      studio_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      coach_id TEXT,
      gross_cents INTEGER NOT NULL DEFAULT 0,
      platform_fee_cents INTEGER NOT NULL DEFAULT 0,
      coach_payout_cents INTEGER NOT NULL DEFAULT 0,
      studio_payout_cents INTEGER NOT NULL DEFAULT 0,
      payout_month TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_ledger_booking ON studio_earnings_ledger(booking_id);
    CREATE INDEX IF NOT EXISTS idx_studio_ledger_month ON studio_earnings_ledger(studio_id,payout_month);
  `);
}

function settleStudioSchedule(scheduleId) {
  const db = getDb();
  ensureSchema(db);
  try { require("../routes/checkin").ensureSchema(db); } catch (e) {}
  const sched = db
    .prepare(
      `SELECT s.id, s.studio_id, s.coach_id, s.start_time, c.title,
              m.owner_user_id, m.platform_commission_rate, m.studio_name
         FROM class_schedules s
         JOIN classes c ON c.id=s.class_id
         JOIN merchant_studios m ON m.id=s.studio_id
        WHERE s.id=?`,
    )
    .get(scheduleId);
  if (!sched) return { ok: false, error: "STUDIO_SCHEDULE_NOT_FOUND" };

  const bookings = db
    .prepare(
      `SELECT b.*, c.price_hkd FROM bookings b JOIN classes c ON c.id=b.class_id
        WHERE b.schedule_id=? AND b.payment_status='paid'
          AND COALESCE(b.fraud_audit_status,'clean') NOT LIKE 'flagged%'
          AND b.status IN ('attended','confirmed')`,
    )
    .all(scheduleId);
  const month = new Date().toISOString().slice(0, 7);
  const rate = Number(sched.platform_commission_rate) || 0.15;
  const totals = { gross_cents: 0, platform_fee_cents: 0, coach_payout_cents: 0, studio_payout_cents: 0, count: 0 };

  for (const b of bookings) {
    if (b.attendee_type === "studio_internal_student") continue;
    const existing = db.prepare("SELECT id FROM studio_earnings_ledger WHERE booking_id=?").get(b.id);
    if (existing) continue;

    const gross = Number(b.amount_cents) || Math.round(Number(b.amount || b.price_hkd || 0) * 100);
    if (gross <= 0) continue;
    const platformFee = Math.round(gross * rate);
    const netPool = gross - platformFee;
    const rel = db
      .prepare("SELECT coach_payout_rate FROM studio_coaches WHERE studio_id=? AND coach_user_id=? AND status='active'")
      .get(sched.studio_id, sched.coach_id);
    const coachRate = rel ? Number(rel.coach_payout_rate) : 0.5;
    const coachPayout = Math.round(netPool * coachRate);
    const studioPayout = netPool - coachPayout;

    const id = "sel_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO studio_earnings_ledger
         (id,studio_id,schedule_id,booking_id,coach_id,gross_cents,platform_fee_cents,coach_payout_cents,studio_payout_cents,payout_month,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`,
    ).run(id, sched.studio_id, scheduleId, b.id, sched.coach_id, gross, platformFee, coachPayout, studioPayout, month);

    totals.gross_cents += gross;
    totals.platform_fee_cents += platformFee;
    totals.coach_payout_cents += coachPayout;
    totals.studio_payout_cents += studioPayout;
    totals.count++;

    try {
      if (coachPayout > 0) {
        creditWallet({
          userId: sched.coach_id,
          amount: coachPayout / 100,
          type: "class_income",
          sourceType: "studio_coach_teaching",
          sourceId: id,
          description: `Studio 帶班費：${sched.title}`,
        });
      }
      if (studioPayout > 0) {
        creditWallet({
          userId: sched.owner_user_id,
          amount: studioPayout / 100,
          type: "partner_income",
          sourceType: "studio_venue_share",
          sourceId: id,
          description: `Studio 場地分潤：${sched.studio_name}`,
        });
      }
    } catch (e) {
      console.error("[STUDIO LEDGER] wallet:", e.message);
    }
  }
  return { ok: true, ...totals };
}

function monthSummary(studioId, month) {
  const db = getDb();
  ensureSchema(db);
  return db
    .prepare(
      `SELECT COUNT(*) bookings, COALESCE(SUM(gross_cents),0) gross_cents,
              COALESCE(SUM(platform_fee_cents),0) platform_fee_cents,
              COALESCE(SUM(coach_payout_cents),0) coach_payout_cents,
              COALESCE(SUM(studio_payout_cents),0) studio_payout_cents
         FROM studio_earnings_ledger WHERE studio_id=? AND payout_month=?`,
    )
    .get(studioId, month);
}

module.exports = { ensureSchema, settleStudioSchedule, monthSummary };
