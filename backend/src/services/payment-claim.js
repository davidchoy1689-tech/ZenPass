/**
 * 「我已付款（參考編號後補）」——付款申報鎖位
 * - 標記 payment_claimed=1 / payment_claimed_at
 * - 同一電話最多 2 個未核實「訂單」（同 user+schedule 當 1 單，2 人同行唔會重複計）
 * - 60 分鐘內未核實 → releaseExpiredHolds 會釋放
 */
const { v4: uuidv4 } = require("uuid");

function ensureCols(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    [["payment_claimed", "INTEGER DEFAULT 0"], ["payment_claimed_at", "TEXT"]].forEach(([n, t]) => {
      if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run();
    });
  } catch (e) { console.error("[CLAIM] cols:", e.message); }
}

class ClaimError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function claimPayment(db, { bookingId, userId }) {
  ensureCols(db);
  const run = db.transaction(() => {
    const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId);
    if (!b) throw new ClaimError("BOOKING_NOT_FOUND", "找不到預約", 404);
    if (userId && b.user_id !== userId) throw new ClaimError("FORBIDDEN", "無權操作此預約", 403);
    if (b.status !== "pending_payment") throw new ClaimError("NOT_PENDING", "此預約唔係待付款狀態", 409);
    if (b.fps_reference || b.payme_reference) return { already_reported: true, claimed_at: b.payment_claimed_at };

    const u = db.prepare("SELECT phone FROM users WHERE id=?").get(b.user_id);
    const phone = u && u.phone;
    if (!phone) throw new ClaimError("NO_PHONE", "缺少電話，無法使用此功能");

    const active = db
      .prepare(
        `SELECT COUNT(DISTINCT b2.user_id || ':' || b2.schedule_id) AS n
           FROM bookings b2 JOIN users u2 ON u2.id=b2.user_id
          WHERE u2.phone=? AND b2.status='pending_payment'
            AND COALESCE(b2.payment_claimed,0)=1
            AND b2.payment_claimed_at > datetime('now','-60 minutes')`,
      )
      .get(phone).n;

    // 同一張單（同 user+schedule）已有 claim → 視為同一單，不重複計
    const sameOrderClaimed = db
      .prepare(
        `SELECT 1 FROM bookings WHERE user_id=? AND schedule_id=? AND COALESCE(payment_claimed,0)=1
           AND payment_claimed_at > datetime('now','-60 minutes') LIMIT 1`,
      )
      .get(b.user_id, b.schedule_id);
    if (!sameOrderClaimed && active >= 2) {
      throw new ClaimError("CLAIM_LIMIT", "你已有 2 個未核實的付款佔位，請先完成或取消其中一個", 429);
    }

    db.prepare(
      `UPDATE bookings SET payment_claimed=1, payment_claimed_at=datetime('now'), payment_reported_at=COALESCE(payment_reported_at, datetime('now'))
        WHERE user_id=? AND schedule_id=? AND status='pending_payment'`,
    ).run(b.user_id, b.schedule_id);

    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
       VALUES (?,?,?,?,?,?,?,datetime('now'))`,
    ).run(uuidv4(), "payment.claimed", "booking", b.id, b.user_id,
      JSON.stringify({ schedule_id: b.schedule_id, phone }),
      `學員自報已付款（待補單號）：${b.booking_reference}`);

    return { already_reported: false, claimed_at: new Date().toISOString() };
  });
  return run();
}

module.exports = { claimPayment, ensureCols, ClaimError };
