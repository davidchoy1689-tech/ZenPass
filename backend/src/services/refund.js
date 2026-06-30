/**
 * ZenPass 禪流 — 退款服務
 *
 * IPO-ready：所有退款有完整 audit trail，自動 create ledger entries
 * 支援：全額退款、部分退款、系統自動退款、管理員退款
 */

const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");
const { writeBlock } = require("./blockchain-audit");

/**
 * 執行退款
 *
 * @param {Object} params
 * @param {string} params.bookingId - 預約 ID
 * @param {number} params.amount - 退款金額
 * @param {string} params.reason - 退款原因
 * @param {string} params.initiatedBy - 操作者 user ID ('system'|admin ID)
 * @param {string} [params.approvedBy] - 審批者 (管理員)
 * @param {string} [params.method] - 原支付方式
 * @returns {Object} 退款結果
 */
function processRefund({
  bookingId,
  amount,
  reason,
  initiatedBy,
  approvedBy,
  method,
}) {
  const db = getDb();
  try {
    // 1. Verify booking exists
    const booking = db
      .prepare("SELECT * FROM bookings WHERE id = ?")
      .get(bookingId);
    if (!booking) {
      return { success: false, error: "預約不存在" };
    }

    // 2. Check refund eligibility
    const refundedSoFar = db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM refund_logs WHERE booking_id = ? AND status = 'completed'",
      )
      .get(bookingId);
    const maxRefund = booking.amount || 0;
    if (refundedSoFar.total + amount > maxRefund) {
      return {
        success: false,
        error: `退款金額超出上限：已退 HK$${refundedSoFar.total}，可退 HK$${maxRefund - refundedSoFar.total}`,
      };
    }

    // 3. Create refund log
    const refundId = uuidv4();
    const payMethod = method || booking.payment_method || "fps";
    db.prepare(
      `
      INSERT INTO refund_logs (id, booking_id, user_id, amount, currency,
        payment_method, reason, initiated_by, approved_by, status, created_at)
      VALUES (?, ?, ?, ?, 'HKD', ?, ?, ?, ?, 'completed', datetime('now'))
    `,
    ).run(
      refundId,
      bookingId,
      booking.user_id,
      amount,
      payMethod,
      reason,
      initiatedBy,
      approvedBy || initiatedBy,
    );

    // 4. Update booking payment status
    const newTotalRefunded = refundedSoFar.total + amount;
    if (newTotalRefunded >= maxRefund) {
      db.prepare(
        "UPDATE bookings SET payment_status = 'refunded', status = 'cancelled' WHERE id = ?",
      ).run(bookingId);
    } else {
      db.prepare(
        "UPDATE bookings SET payment_status = 'partial_refund' WHERE id = ?",
      ).run(bookingId);
    }

    // 5. Release spot
    db.prepare(
      "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?",
    ).run(booking.schedule_id);

    // 6. Create accounting entry (async, non-blocking)
    try {
      const { recordRefund } = require("./accounting");
      recordRefund(bookingId, booking.user_id, amount, payMethod);
    } catch (acctErr) {
      console.error("[REFUND] Accounting entry failed:", acctErr.message);
    }

    // 7. Create audit log (async, non-blocking)
    try {
      const { trackPaymentChange } = require("./audit");
      trackPaymentChange(
        bookingId,
        initiatedBy,
        "paid",
        "refunded",
        amount,
        payMethod,
      );
    } catch (auditErr) {
      console.error("[REFUND] Audit entry failed:", auditErr.message);
    }

    // ⛓️ 區塊鏈：記錄退款
    try {
      writeBlock({
        entityType: "refund",
        entityId: refundId,
        data: {
          refund_id: refundId,
          booking_id: bookingId,
          user_id: booking.user_id,
          amount,
          currency: "HKD",
          payment_method: payMethod,
          reason,
          initiated_by: initiatedBy,
          approved_by: approvedBy || initiatedBy,
          status: "completed",
          new_status:
            newTotalRefunded >= maxRefund ? "fully_refunded" : "partially_refunded",
          total_refunded: newTotalRefunded,
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (refund):", bcErr.message);
    }

    return {
      success: true,
      refund_id: refundId,
      booking_id: bookingId,
      amount,
      reason,
      new_status:
        newTotalRefunded >= maxRefund ? "fully_refunded" : "partially_refunded",
      total_refunded: newTotalRefunded,
    };
  } catch (err) {
    console.error("[REFUND] Failed:", err.message);
    return { success: false, error: err.message };
  } finally {

  }
}

/**
 * 查詢退款記錄
 */
function getRefundLogs(bookingId) {
  const db = getDb();
  try {
    return db
      .prepare(
        "SELECT * FROM refund_logs WHERE booking_id = ? ORDER BY created_at DESC",
      )
      .all(bookingId);
  } catch (err) {
    return [];
  } finally {

  }
}

module.exports = { processRefund, getRefundLogs };
