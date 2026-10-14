/**
 * ZenPass v2.1 — Booking Events（append-only 狀態 timeline）
 *
 * 為每筆 booking 記錄狀態轉換（created / paid / cancelled / attended / no_show …），
 * 令每筆預約有完整、不可改嘅 timeline。non-throwing。
 */
const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

function logBookingEvent({ bookingId, event, fromStatus, toStatus, actor, meta }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO booking_events (id, booking_id, event, from_status, to_status, actor, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uuidv4(),
        bookingId,
        event,
        fromStatus || null,
        toStatus || null,
        actor || null,
        meta ? JSON.stringify(meta) : null,
      );
    return true;
  } catch (e) {
    console.error("⚠️ [BOOKING_EVENT] log failed:", e.message);
    return false;
  }
}

function getEvents(bookingId) {
  try {
    return getDb()
      .prepare("SELECT * FROM booking_events WHERE booking_id = ? ORDER BY created_at")
      .all(bookingId);
  } catch (e) {
    return [];
  }
}

module.exports = { logBookingEvent, getEvents };
