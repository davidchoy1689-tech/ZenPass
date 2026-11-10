/**
 * payout-disbursements.js — FPS 出糧紀錄（工單二十）
 * 每次平台經 FPS 發放月結後，寫入銀行交易參考編號，供教練 1 秒對數。
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const { audit } = require("./audit");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_payout_disbursements (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      payout_month TEXT NOT NULL,
      gross_earnings_cents INTEGER NOT NULL,
      offset_cash_cents INTEGER DEFAULT 0,
      net_payout_cents INTEGER NOT NULL,
      fps_proxy_id TEXT,
      fps_proxy_type TEXT DEFAULT 'mobile',
      bank_reference_no TEXT UNIQUE,
      disbursed_at DATETIME,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','cleared','failed')),
      failure_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_disb_coach_month ON coach_payout_disbursements(coach_id, payout_month);
    CREATE INDEX IF NOT EXISTS idx_disb_coach ON coach_payout_disbursements(coach_id, status);
  `);
}

function maskProxy(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (s.length >= 8) return s.slice(0, 4) + "****";
  return s ? "****" : "";
}

function makeRef(month, coachId) {
  const m = String(month || "").replace("-", "");
  const code = (String(coachId || "").replace(/-/g, "").slice(0, 4).toUpperCase() || "COAC").padEnd(4, "X");
  const n = String(crypto.randomInt(10000, 100000));
  return `FPS-ZP-${m}-${code}-${n}`;
}

function record(db, { coachId, month, grossCents, offsetCents, netCents, proxyId, refNo, disbursedAt, status }) {
  ensureSchema(db);
  const id = crypto.randomUUID();
  const ref = refNo || makeRef(month, coachId);
  db.prepare(
    `INSERT INTO coach_payout_disbursements
       (id, coach_id, payout_month, gross_earnings_cents, offset_cash_cents, net_payout_cents,
        fps_proxy_id, bank_reference_no, disbursed_at, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    coachId,
    month,
    Math.round(grossCents || 0),
    Math.round(offsetCents || 0),
    Math.round(netCents || 0),
    proxyId || null,
    ref,
    disbursedAt || new Date().toISOString(),
    status || "cleared",
  );
  return { id, bank_reference_no: ref };
}

function listForCoach(coachId) {
  const db = getDb();
  ensureSchema(db);
  const rows = db
    .prepare(
      `SELECT * FROM coach_payout_disbursements WHERE coach_id=? ORDER BY payout_month DESC, datetime(created_at) DESC LIMIT 60`,
    )
    .all(coachId);
  return rows.map((r) => ({
    id: r.id,
    month: r.payout_month,
    gross_earnings_cents: Number(r.gross_earnings_cents) || 0,
    offset_cash_cents: Number(r.offset_cash_cents) || 0,
    net_payout_cents: Number(r.net_payout_cents) || 0,
    net_payout_hkd: (Number(r.net_payout_cents) / 100).toFixed(2),
    gross_earnings_hkd: (Number(r.gross_earnings_cents) / 100).toFixed(2),
    offset_cash_hkd: (Number(r.offset_cash_cents) / 100).toFixed(2),
    fps_proxy_type: r.fps_proxy_type || "mobile",
    fps_proxy_masked: maskProxy(r.fps_proxy_id),
    bank_reference_no: r.bank_reference_no,
    disbursed_at: r.disbursed_at,
    status: r.status,
    failure_reason: r.failure_reason || "",
  }));
}

function getForMonth(db, coachId, month) {
  ensureSchema(db);
  return db
    .prepare("SELECT * FROM coach_payout_disbursements WHERE coach_id=? AND payout_month=?")
    .get(coachId, month);
}

function setStatus(db, id, status, reason) {
  ensureSchema(db);
  const before = db.prepare("SELECT * FROM coach_payout_disbursements WHERE id=?").get(id);
  if (!before) return { ok: false, code: "NOT_FOUND" };
  db.prepare(
    "UPDATE coach_payout_disbursements SET status=?, failure_reason=?, disbursed_at=COALESCE(disbursed_at, datetime('now')) WHERE id=?",
  ).run(status, reason || null, id);
  try {
    audit({
      actionType: "payout.status_changed",
      entityType: "coach_payout_disbursement",
      entityId: id,
      newValues: { from: before.status, to: status, reason: reason || null },
      description: "更新 FPS 出糧狀態",
    });
  } catch (e) {}
  return { ok: true };
}

module.exports = { ensureSchema, record, listForCoach, getForMonth, setStatus, makeRef, maskProxy };
