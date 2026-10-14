/**
 * ZenPass v2.1 — PaymentIntent（統一支付編排）
 *
 * 將所有支付方式（credits / stripe / fps / payme / cash）抽象為一個 intent，
 * 記錄狀態機：requires_payment → processing → succeeded / failed / cancelled。
 * 目的：統一對帳、審計、日後接多個 PSP。
 *
 * 全部 non-throwing + idempotent（以 booking_id 為 key upsert）。
 */
const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

function pspOf(method) {
  switch (method) {
    case "stripe": return "stripe";
    case "fps": return "fps";
    case "payme": return "payme";
    case "credits": return "internal";
    default: return "internal";
  }
}

function upsertIntent({ bookingId, userId, amount, method, pspRef, state }) {
  const db = getDb();
  const psp = pspOf(method);
  const existing = db
    .prepare("SELECT id FROM payment_intents WHERE booking_id = ?")
    .get(bookingId);
  if (existing) {
    db.prepare(
      `UPDATE payment_intents SET amount = ?, method = ?, psp = ?,
         psp_ref = COALESCE(?, psp_ref), state = ?, updated_at = datetime('now')
       WHERE booking_id = ?`,
    ).run(Number(amount) || 0, method || null, psp, pspRef || null, state, bookingId);
    return existing.id;
  }
  const id = uuidv4();
  db.prepare(
    `INSERT INTO payment_intents (id, booking_id, user_id, amount, method, psp, psp_ref, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, bookingId, userId || null, Number(amount) || 0, method || null, psp, pspRef || null, state);
  return id;
}

function getIntent(bookingId) {
  try {
    return getDb()
      .prepare("SELECT * FROM payment_intents WHERE booking_id = ?")
      .get(bookingId);
  } catch (e) {
    return null;
  }
}

module.exports = { upsertIntent, getIntent, pspOf };
