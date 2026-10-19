/**
 * ZenPass 禪流 — 退款服務
 *
 * IPO-ready：所有退款有完整 audit trail，自動 create ledger entries
 * 支援：全額退款、部分退款、系統自動退款、管理員退款
 */

const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");
const { writeBlock } = require("./blockchain-audit");
const { toCents, fromCents } = require("../lib/money");

// 即時完成嘅退款方式（網上付款／錢包）；FPS／PayMe 要人手轉賬 → pending
const INSTANT_REFUND_METHODS = ["stripe", "card", "credit_card", "wallet", "credits", "free"];
function isInstantRefund(method) {
  return INSTANT_REFUND_METHODS.includes(String(method || "").toLowerCase());
}

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
        // pending（待轉賬）都要計入上限，避免重複退款
        "SELECT COALESCE(SUM(amount), 0) as total FROM refund_logs WHERE booking_id = ? AND status IN ('completed','pending')",
      )
      .get(bookingId);
    // 用整數 cents 比較，避免浮點誤判（例如差一分就判定超額）
    const maxRefundCents = toCents(booking.amount || 0);
    const refundedCents = toCents(refundedSoFar.total);
    const amountCents = toCents(amount);
    if (refundedCents + amountCents > maxRefundCents) {
      return {
        success: false,
        error: `退款金額超出上限：已退 HK$${fromCents(refundedCents)}，可退 HK$${fromCents(maxRefundCents - refundedCents)}`,
      };
    }

    // 3. Create refund log
    const refundId = uuidv4();
    const payMethod = method || booking.payment_method || "fps";
    const instant = isInstantRefund(payMethod);
    const refundStatus = instant ? "completed" : "pending";
    db.prepare(
      `
      INSERT INTO refund_logs (id, booking_id, user_id, amount, currency,
        payment_method, reason, initiated_by, approved_by, status, created_at)
      VALUES (?, ?, ?, ?, 'HKD', ?, ?, ?, ?, ?, datetime('now'))
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
      refundStatus,
    );

    // 🧾 2026-10-19：寫入用戶交易紀錄（俾用戶喺「交易紀錄」睇到退款）
    try {
      db.prepare(
        `INSERT INTO transactions (id, user_id, type, amount, payment_method, description, status, refund_id, created_at)
         VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(
        uuidv4(),
        booking.user_id,
        amount,
        payMethod,
        `退款 HK$${Number(amount).toFixed(2)}（${booking.booking_reference || bookingId}）${reason ? " — " + reason : ""}`,
        instant ? "completed" : "pending",
        refundId,
      );
    } catch (txErr) {
      console.error("[REFUND] transactions record failed:", txErr.message);
    }

    // 4. Update booking payment status（即時退款才更新；待轉賬完成時才更新）
    const newTotalCents = refundedCents + amountCents;
    const newTotalRefunded = fromCents(newTotalCents);
    const fullyRefunded = newTotalCents >= maxRefundCents;
    if (instant) {
      if (fullyRefunded) {
        db.prepare(
          "UPDATE bookings SET payment_status = 'refunded', status = 'cancelled' WHERE id = ?",
        ).run(bookingId);
      } else {
        db.prepare(
          "UPDATE bookings SET payment_status = 'partial_refund' WHERE id = ?",
        ).run(bookingId);
      }
    }

    // 5. 座位已由取消流程釋放（唔喺呢度再減，避免重複扣）

    // 6. Create accounting entry（待轉賬完成後才入賬）
    if (instant) {
      try {
        const { recordRefund } = require("./accounting");
        recordRefund(bookingId, booking.user_id, amount, payMethod);
      } catch (acctErr) {
        console.error("[REFUND] Accounting entry failed:", acctErr.message);
      }
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
          status: refundStatus,
          new_status: fullyRefunded ? "fully_refunded" : "partially_refunded",
          total_refunded: newTotalRefunded,
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (refund):", bcErr.message);
    }

    // 通知會員（即時 → 已退款；FPS/PayMe → 處理中）
    try {
      const { sendNotification } = require("./notification");
      sendNotification(instant ? "booking.refunded" : "booking.refund_pending", {
        recipient: booking.user_id,
        data: {
          amount,
          reason,
          booking_reference: booking.booking_reference,
          method: payMethod,
        },
      });
    } catch (e) {
      console.error("[REFUND] notify error:", e.message);
    }

    return {
      success: true,
      refund_id: refundId,
      booking_id: bookingId,
      amount,
      reason,
      refund_status: refundStatus,
      new_status: fullyRefunded ? "fully_refunded" : "partially_refunded",
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

/**
 * 管理員確認已人手轉賬（FPS／PayMe 退款）
 */
function completeRefund(refundId, adminId, { transferReference = null, note = null } = {}) {
  const db = getDb();
  try {
    const row = db.prepare("SELECT * FROM refund_logs WHERE id = ?").get(refundId);
    if (!row) return { success: false, error: "退款記錄不存在" };
    if (row.status !== "pending") return { success: false, error: "此退款唔係待轉賬狀態" };
    if (!transferReference) return { success: false, error: "請填寫轉賬參考編號" };

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE refund_logs SET status='completed', completed_at=datetime('now'), completed_by=?, transfer_reference=? WHERE id=? AND status='pending'`,
      ).run(adminId, transferReference, refundId);

      const totals = db
        .prepare("SELECT COALESCE(SUM(amount),0) AS total FROM refund_logs WHERE booking_id = ? AND status = 'completed'")
        .get(row.booking_id);
      const booking = db.prepare("SELECT amount FROM bookings WHERE id = ?").get(row.booking_id);
      const fully = toCents(totals.total) >= toCents(booking ? booking.amount : 0);
      db.prepare("UPDATE bookings SET payment_status = ? WHERE id = ?").run(
        fully ? "refunded" : "partial_refund",
        row.booking_id,
      );
      db.prepare("UPDATE transactions SET status='completed' WHERE refund_id = ?").run(refundId);
    });
    tx();

    try {
      require("./accounting").recordRefund(row.booking_id, row.user_id, row.amount, row.payment_method);
    } catch (e) {}

    try {
      writeBlock({
        entityType: "refund",
        entityId: refundId,
        data: {
          refund_id: refundId,
          booking_id: row.booking_id,
          user_id: row.user_id,
          amount: row.amount,
          status: "completed",
          transfer_reference: transferReference,
          completed_by: adminId,
          note,
        },
      });
    } catch (e) {}

    try {
      const { sendNotification } = require("./notification");
      sendNotification("booking.refunded", {
        recipient: row.user_id,
        data: {
          amount: row.amount,
          reason: note || row.reason,
          method: row.payment_method,
        },
      });
    } catch (e) {}

    return { success: true, refund_id: refundId, status: "completed" };
  } catch (err) {
    console.error("[REFUND] complete failed:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { processRefund, completeRefund, getRefundLogs };
