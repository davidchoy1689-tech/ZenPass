/**
 * ZenPass v2.1 — Ledger Hold（兩階段轉帳 hold 位）
 *
 * 生命週期：pending → committed / voided / expired
 * - 落單（pending_payment）→ createHold
 * - 付款成功 → commitHold
 * - 取消 / 逾時 → voidHold
 *
 * 全部 idempotent、non-throwing（呼叫方仍可再包 try/catch）。
 */
const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

function createHold(bookingId, userId, amount, asset, ttlMin = 15) {
  const db = getDb();
  const existing = db
    .prepare("SELECT id, state FROM ledger_holds WHERE booking_id = ?")
    .get(bookingId);
  if (existing) return existing.state === "pending";
  const expires = new Date(Date.now() + ttlMin * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  db.prepare(
    `INSERT INTO ledger_holds (id, booking_id, user_id, amount, asset, state, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(uuidv4(), bookingId, userId, Number(amount) || 0, asset || "credits", expires);
  return true;
}

function commitHold(bookingId) {
  const db = getDb();
  const r = db
    .prepare(
      "UPDATE ledger_holds SET state='committed', committed_at=datetime('now') WHERE booking_id=? AND state='pending'",
    )
    .run(bookingId);
  return r.changes > 0;
}

function voidHold(bookingId, reason) {
  const db = getDb();
  const r = db
    .prepare(
      "UPDATE ledger_holds SET state='voided', voided_at=datetime('now'), reason=? WHERE booking_id=? AND state='pending'",
    )
    .run(reason || null, bookingId);
  return r.changes > 0;
}

function getHold(bookingId) {
  try {
    return getDb()
      .prepare("SELECT * FROM ledger_holds WHERE booking_id = ?")
      .get(bookingId);
  } catch (e) {
    return null;
  }
}

module.exports = { createHold, commitHold, voidHold, getHold };
