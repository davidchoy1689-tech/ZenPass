/**
 * ZenPass — 場地結算（Escrow settlement）
 *
 * 流程（2026-10-17 David 定）：
 *  1. 教練預約場地時，平台即時收取全額租金（錢包扣款）→ payment_status='paid'
 *  2. 場地使用完成（end_time 過去）→ status='completed'（交易完結）
 *  3. 月底結算（按完成月份，HKT），扣平台佣金 + 罰款後 = 場地應得
 *  4. 下月 15 號過數到場地指定銀行戶口
 */

const crypto = require("crypto");
const { getDb } = require("./database");

function monthKey(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  const hk = new Date(d.getTime() + 8 * 3600 * 1000);
  return hk.toISOString().slice(0, 7);
}

/** 結算月 → 過數日（下月 15 號，HKT 00:00 表示） */
function payoutDate(month) {
  const [y, m] = month.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-15`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function _ensureTables(db) {
  db.prepare(
    "CREATE TABLE IF NOT EXISTS venue_settlements (id TEXT PRIMARY KEY, venue_id TEXT, month TEXT, gross_hkd REAL DEFAULT 0, commission_hkd REAL DEFAULT 0, penalties_hkd REAL DEFAULT 0, net_hkd REAL DEFAULT 0, status TEXT DEFAULT 'pending', payout_date TEXT, paid_at TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(venue_id, month))",
  ).run();
  db.prepare(
    "CREATE TABLE IF NOT EXISTS venue_penalties (id TEXT PRIMARY KEY, rental_id TEXT, venue_id TEXT, coach_id TEXT, type TEXT, amount_hkd REAL, status TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now')))",
  ).run();
}

/**
 * 計算某場地某月結算（不寫入）
 */
function computeSettlement(venueId, month) {
  const db = getDb();
  _ensureTables(db);

  const venue = db.prepare("SELECT id, name, bank_name, bank_account FROM partner_venues WHERE id = ?").get(venueId) || { id: venueId, name: "" };

  const rows = db
    .prepare(
      `SELECT id, price_hkd, commission_rate, commission_amount, venue_earned, end_time, status, payment_status
         FROM venue_rentals
        WHERE venue_id = ?
          AND status = 'completed'
          AND COALESCE(payment_status,'paid') = 'paid'
          AND strftime('%Y-%m', datetime(end_time, '+8 hours')) = ?
        ORDER BY end_time ASC`,
    )
    .all(venueId, month);

  const defaultRate = Number(
    (db.prepare("SELECT commission_rate FROM partner_venues WHERE id = ?").get(venueId) || {}).commission_rate,
  ) || 0.15;

  let gross = 0, commission = 0, net = 0;
  for (const r of rows) {
    const g = round2(r.price_hkd);
    const rate = Number(r.commission_rate) || defaultRate;
    const c = r.commission_amount && Number(r.commission_amount) > 0 ? round2(r.commission_amount) : round2(g * rate);
    gross = round2(gross + g);
    commission = round2(commission + c);
    net = round2(net + (Number(r.venue_earned) > 0 ? round2(r.venue_earned) : round2(g - c)));
  }

  // 罰款（同月）
  const pen = db
    .prepare(
      `SELECT id, type, amount_hkd, status, note, created_at FROM venue_penalties
        WHERE venue_id = ? AND status IN ('pending_charge','applied')
          AND strftime('%Y-%m', datetime(created_at, '+8 hours')) = ?`,
    )
    .all(venueId, month);
  const penalties = round2(pen.reduce((a, x) => a + (Number(x.amount_hkd) || 0), 0));

  const existing = db
    .prepare("SELECT * FROM venue_settlements WHERE venue_id = ? AND month = ?")
    .get(venueId, month);

  return {
    venue,
    month,
    rental_count: rows.length,
    gross_hkd: gross,
    commission_hkd: commission,
    penalties_hkd: penalties,
    net_hkd: round2(Math.max(0, net - penalties)),
    carry_forward_hkd: round2(Math.max(0, penalties - net)),
    payout_date: payoutDate(month),
    status: existing ? existing.status : "pending",
    settlement_id: existing ? existing.id : null,
    paid_at: existing ? existing.paid_at : null,
  };
}

/** 建立／更新某月所有場地結算（admin 用） */
function runMonth(month) {
  const db = getDb();
  _ensureTables(db);
  const venues = db.prepare("SELECT id FROM partner_venues WHERE status = 'active'").all();
  let created = 0, updated = 0;
  for (const v of venues) {
    const s = computeSettlement(v.id, month);
    if (s.rental_count === 0 && s.penalties_hkd === 0) continue;
    const existing = db.prepare("SELECT id, status FROM venue_settlements WHERE venue_id = ? AND month = ?").get(v.id, month);
    if (existing) {
      if (existing.status === "paid") continue; // 已過數不改
      db.prepare(
        "UPDATE venue_settlements SET gross_hkd=?, commission_hkd=?, penalties_hkd=?, net_hkd=?, payout_date=? WHERE id=?",
      ).run(s.gross_hkd, s.commission_hkd, s.penalties_hkd, s.net_hkd, s.payout_date, existing.id);
      updated++;
    } else {
      db.prepare(
        "INSERT INTO venue_settlements (id, venue_id, month, gross_hkd, commission_hkd, penalties_hkd, net_hkd, status, payout_date) VALUES (?,?,?,?,?,?,?, 'pending', ?)",
      ).run(crypto.randomUUID(), v.id, month, s.gross_hkd, s.commission_hkd, s.penalties_hkd, s.net_hkd, s.payout_date);
      created++;
    }
  }
  return { month, created, updated };
}

function markPaid(settlementId, note) {
  const db = getDb();
  _ensureTables(db);
  const s = db.prepare("SELECT * FROM venue_settlements WHERE id = ?").get(settlementId);
  if (!s) return { ok: false, error: "結算不存在" };
  if (s.status === "paid") return { ok: false, error: "已標記過數" };
  db.prepare("UPDATE venue_settlements SET status='paid', paid_at=datetime('now'), note=? WHERE id=?").run(note || null, settlementId);
  // 罰款標記已抵扣
  try {
    db.prepare(
      "UPDATE venue_penalties SET status='deducted' WHERE venue_id = ? AND status IN ('pending_charge','applied') AND strftime('%Y-%m', datetime(created_at,'+8 hours')) = ?",
    ).run(s.venue_id, s.month);
  } catch (e) {}
  return { ok: true, settlement: { ...s, status: "paid" } };
}

module.exports = { computeSettlement, runMonth, markPaid, payoutDate, monthKey };
