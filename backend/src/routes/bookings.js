/**
 * ZenPass 禪流 - 預約路由
 * Routes → Service → Model pattern
 * Thin router, thick service, clean model
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireCoach, hasMinimumRole } = require("../middleware/auth");
const { scalpGuard } = require("../middleware/anti-scalping");
const { validate, schemas } = require("../middleware/validate");
const { requireIdempotency } = require("../middleware/idempotency");
const bookingService = require("../services/booking-service");
const { validatePromo } = require("../services/promo");
const Booking = require("../models/Booking");

const router = express.Router();

// ===== POST /api/bookings — 建立預約 =====
router.post(
  "/",
  authenticateToken,
  scalpGuard,
  requireIdempotency,
  validate(schemas.booking),
  async (req, res) => {
    try {
      // 1. Check availability via model（兼容 camelCase / snake_case）
      const scheduleId = req.body.scheduleId || req.body.schedule_id;
      const classId = req.body.classId || req.body.class_id;
      const paymentType = req.body.paymentType || req.body.payment_type;
      const penaltyConsent = req.body.penaltyConsent !== undefined ? req.body.penaltyConsent : req.body.penalty_consent;
      const avail = Booking.checkAvailability(scheduleId);
      if (!avail.available) {
        const full = avail.reason === "full";
        return res.status(full ? 409 : 400).json({
          success: false,
          error: full ? "該時段名額已滿" : "該時段不存在或已滿",
          code: full ? "CLASS_FULL" : "SLOT_UNAVAILABLE",
        });
      }

      // 2. Validate penalty consent
      const consent = Booking.validatePenaltyConsent(req.user.id, penaltyConsent);
      if (!consent.ok) {
        return res.status(400).json({ error: consent.error, code: consent.code });
      }

      // 3. Business logic via service
      const result = await bookingService.createBooking(req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error("預約錯誤:", err);
      res.status(500).json({ success: false, error: "預約失敗，請稍後再試" });
    }
  }
);

// ===== POST /api/bookings/batch — 一次過建立多筆預約（多選時段／按月） =====
router.post(
  "/batch",
  authenticateToken,
  requireIdempotency,
  async (req, res) => {
    try {
      const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
      if (!items.length) {
        return res.status(400).json({ success: false, error: "冇選擇任何時段" });
      }
      if (items.length > 40) {
        return res.status(400).json({ success: false, error: "一次最多 40 個時段" });
      }
      // 優惠碼：一次過驗證，適用於全個 batch（每堂折後價），只兌換一次。
      // 之前逐個 item 帶 promo_code → per_user_limit=1 會令第 2 堂起 fail。
      let batchPromo = null;
      const promoCode = items.map((it) => it.promoCode).find((c) => c && String(c).trim());
      const firstBillable = items.find((it) => ["single", "credits"].includes(it.paymentType || "single"));
      if (promoCode && firstBillable) {
        const db = getDb();
        const clsRow = db
          .prepare("SELECT price_hkd FROM classes WHERE id = ?")
          .get(firstBillable.classId);
        const v = validatePromo(db, {
          code: promoCode,
          basePrice: clsRow ? clsRow.price_hkd : 0,
          classId: firstBillable.classId,
          userId: req.user.id,
        });
        if (!v.ok) return res.status(400).json({ success: false, error: v.error });
        batchPromo = { final_price: v.final_price };
      }

      const results = [];
      let promoRedeemed = false;
      const promoCr = batchPromo ? Math.round((batchPromo.final_price / 10) * 10) / 10 : null;
      for (const it of items) {
        const isSingle = (it.paymentType || "single") === "single";
        const isCredits = it.paymentType === "credits";
        const discounted = batchPromo && (isSingle || isCredits);
        const usePromo = !!discounted && !promoRedeemed;
        const fakeReq = {
          body: {
            schedule_id: it.scheduleId,
            class_id: it.classId,
            payment_type: it.paymentType || "single",
            penalty_consent: it.penaltyConsent,
            promo_code: usePromo ? promoCode : undefined,
            amount: discounted ? batchPromo.final_price : it.amount,
            group_size: Number(it.groupSize) === 3 ? 3 : 1,
            attendee: it.attendee || null,
          },
          user: req.user,
        };
        let r;
        try {
          r = await bookingService.createBooking(fakeReq, {
            creditsOverride: discounted && isCredits ? promoCr : undefined,
          });
        } catch (e) {
          r = { status: 500, body: { success: false, error: "預約失敗" } };
        }
        if (usePromo && r.status === 201) promoRedeemed = true;
        results.push({ scheduleId: it.scheduleId, status: r.status, body: r.body });
      }
      const created = results.filter((x) => x.status === 201).length;
      res.json({ success: true, created, total: items.length, results });
    } catch (e) {
      console.error("批量預約錯誤:", e);
      res.status(500).json({ success: false, error: "批量預約失敗" });
    }
  }
);

// 只准本人／該班教練／管理員睇 booking 詳情
function canAccessBooking(booking, user) {
  const role = (user && user.role) || "";
  if (["admin", "super_admin", "platform_manager", "platform_staff"].includes(role)) return true;
  if (!booking || !user) return false;
  if (booking.user_id === user.id) return true;
  if (booking.coach_id && booking.coach_id === user.id) return true;
  return false;
}

// ===== GET /api/bookings/trial-status — 試玩資格 =====
router.get("/trial-status", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const result = bookingService.getTrialStatus(db, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/bookings/my — 我的預約 =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const { status, page = 1, limit = 20 } = req.query;
    let whereConditions = ["b.user_id = ?"];
    let params = [req.user.id];

    if (status) {
      whereConditions.push("b.status = ?");
      params.push(status);
    }

    const whereClause = whereConditions.join(" AND ");
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const bookings = db
      .prepare(
        `SELECT b.*, c.title, c.category, c.duration, c.price_hkd, c.venue_name, c.venue_address, c.latitude, c.longitude, c.coach_id, c.partner_venue_id, cs.start_time, cs.end_time, u.name as coach_name
         FROM bookings b
         JOIN classes c ON b.class_id = c.id
         JOIN class_schedules cs ON b.schedule_id = cs.id
         LEFT JOIN users u ON c.coach_id = u.id
         WHERE ${whereClause}
         ORDER BY cs.start_time DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, parseInt(limit), offset);

    res.json({ bookings });
  } catch (err) {
    console.error("獲取預約錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取預約記錄" });
  }
});

// ===== POST /api/bookings/:id/request-refund — 學員登記 FPS 退款（2026-10-28）=====
// 只限「已付款 + 已取消」的預約；登記後由管理員人手轉賬並確認
router.post("/:id/request-refund", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    bookingService.ensureRefundColumns(db);
    const b = db
      .prepare(
        `SELECT b.id, b.user_id, b.status, b.payment_status, b.amount, b.booking_reference,
                COALESCE(b.refund_status,'none') AS refund_status, b.cancel_reason
           FROM bookings b WHERE b.id = ?`,
      )
      .get(req.params.id);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });
    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id) || {};
    const isAdmin = ["admin", "super_admin", "platform_manager"].includes(me.role);
    if (b.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ success: false, error: "只可為自己的預約登記退款" });
    }
    if (b.status !== "cancelled") {
      return res.status(400).json({
        success: false,
        error: "課堂未取消，暫時無需退款。如需取消請到「我的預約」申請取消。",
        code: "NOT_CANCELLED",
      });
    }
    if (b.payment_status !== "paid") {
      return res.status(400).json({
        success: false,
        error: "此預約未確認收款，無款項可退（如已轉賬請聯絡客服核實）",
        code: "NOT_PAID",
      });
    }
    if (["requested", "processing", "refunded"].includes(String(b.refund_status))) {
      return res.status(409).json({
        success: false,
        error: b.refund_status === "refunded" ? "此預約已完成退款" : "退款申請已提交，正處理中",
        code: "ALREADY_REQUESTED",
        refund_status: b.refund_status,
      });
    }

    const { normalizeFpsId } = require("../lib/fps");
    const fpsId = normalizeFpsId((req.body && (req.body.fps_id || req.body.fpsId)) || "").slice(0, 64);
    const fpsName = String((req.body && (req.body.fps_name || req.body.fpsName)) || "").trim().slice(0, 64);
    const looksPhone = /^\+?\d[\d\s-]{5,19}$/.test(fpsId);
    const looksEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fpsId);
    if (fpsId.length < 6 || (!looksPhone && !looksEmail && fpsId.length < 8)) {
      return res.status(400).json({ success: false, error: "請填寫有效的 FPS 收款識別（手機號碼／電郵／FPS ID）", code: "FPS_ID_INVALID" });
    }
    if (fpsName.replace(/\s/g, "").length < 2) {
      return res.status(400).json({ success: false, error: "請填寫 FPS 收款人姓名（需與銀行紀錄一致）", code: "FPS_NAME_INVALID" });
    }

    const reason =
      String(b.cancel_reason || "").trim() ||
      "平台／課堂取消（天氣或人數不足）";

    db.prepare(
      `UPDATE bookings
          SET refund_status = 'requested', refund_channel = 'fps',
              refund_fps_id = ?, refund_fps_name = ?, refund_reason = ?,
              refund_reported_at = datetime('now'),
              refund_requested_at = COALESCE(refund_requested_at, datetime('now'))
        WHERE id = ?`,
    ).run(fpsId, fpsName, reason, b.id);

    // 通知管理員（站內）
    try {
      require("../services/notify-admins").notifyAdmins("refund.pending", {
        booking_reference: b.booking_reference || b.id,
        amount: Number(b.amount || 0),
        fps_name: fpsName,
        fps_id: fpsId,
        booking_id: b.id,
      });
    } catch (e) {}

    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
         VALUES (?, 'refund.requested', 'booking', ?, ?, ?, ?, datetime('now'))`,
      ).run(
        require("crypto").randomUUID(), b.id, req.user.id,
        JSON.stringify({ fps_id: fpsId, fps_name: fpsName, reason, amount: b.amount }),
        `學員登記 FPS 退款（HK$${Number(b.amount || 0).toFixed(2)}）`,
      );
    } catch (e) {}

    res.json({
      success: true,
      message: "✅ 已登記退款，平台將於 1–2 個工作天內經 FPS 退回",
      refund_status: "requested",
      amount: Number(b.amount || 0),
    });
  } catch (err) {
    console.error("退款登記失敗:", err);
    res.status(500).json({ success: false, error: "退款登記失敗，請稍後再試" });
  }
});

// ===== POST /api/bookings/:id/complete-payment — 完成付款 =====
router.post(
  "/:id/complete-payment",
  authenticateToken,
  scalpGuard,
  requireIdempotency,
  validate(schemas.payment_confirm),
  (req, res) => {
    try {
      const result = bookingService.completePayment(req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error("完成付款錯誤:", err);
      res.status(500).json({ success: false, error: "完成付款失敗" });
    }
  }
);

// ===== POST /api/bookings/:id/cancel — 取消預約 =====
router.post("/:id/cancel", authenticateToken, scalpGuard, (req, res) => {
  try {
    const result = bookingService.cancelBooking(req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取消預約錯誤:", err);
    res.status(500).json({ success: false, error: "取消預約失敗" });
  }
});

// ===== GET /api/bookings/:id/checkin-status — 簽到狀態 =====
router.get("/:id/checkin-status", authenticateToken, (req, res) => {
  try {
    const result = bookingService.getCheckinStatus(req.params.id, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("檢查簽到狀態錯誤:", err);
    res.status(500).json({ success: false, error: "檢查簽到狀態失敗" });
  }
});

// ===== POST /api/bookings/:id/attend — 標記已出席 =====
router.post("/:id/attend", authenticateToken, (req, res) => {
  try {
    const result = bookingService.attendBooking(req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("簽到錯誤:", err);
    res.status(500).json({ success: false, error: "簽到失敗" });
  }
});

// ===== GET /api/bookings/today — 今日課堂（教練用）=====
router.get("/today", authenticateToken, requireCoach, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 🔒 2026-10-19：教練只睇自己嘅班（原本任何登入用戶可睇全平台今日課堂＋學生姓名）
    const me = db.prepare("SELECT role, is_coach, coach_verified FROM users WHERE id = ?").get(req.user.id);
    const isAdmin = me && ["admin", "super_admin", "platform_manager", "platform_staff"].includes(me.role);

    const today = new Date().toISOString().split("T")[0];
    const schedules = db
      .prepare(
        `SELECT cs.id as schedule_id, cs.start_time, cs.end_time, c.id as class_id, c.title, c.venue_name,
          (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'attended') as attended_count,
          (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'confirmed') as confirmed_count
         FROM class_schedules cs
         JOIN classes c ON cs.class_id = c.id
         WHERE date(cs.start_time) = date(?) AND cs.start_time > datetime('now', '-3 hours')
           ${isAdmin ? "" : "AND c.coach_id = ?"}
         ORDER BY cs.start_time`
      )
      .all(...(isAdmin ? [today] : [today, req.user.id]));

    const result = schedules.map((s) => {
      const students = db
        .prepare(
          `SELECT b.id as booking_id, u.id, u.name, b.status, b.created_at as booked_at
           FROM bookings b JOIN users u ON b.user_id = u.id
           WHERE b.schedule_id = ? AND b.status IN ('confirmed', 'attended')
           ORDER BY b.created_at`
        )
        .all(s.schedule_id);
      return { ...s, students };
    });

    res.json({ schedules: result, date: today });
  } catch (err) {
    console.error("獲取今日課堂錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得今日課堂" });
  }
});

// ===== GET /api/bookings/:id — 單一預約詳情 =====
router.get("/:id", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const booking = db
      .prepare(
        `SELECT b.*, c.title, c.coach_id, c.price_hkd, u.name as coach_name, u2.name as student_name,
                cs.start_time, cs.end_time
         FROM bookings b
         JOIN classes c ON b.class_id = c.id
         LEFT JOIN users u ON c.coach_id = u.id
         JOIN users u2 ON b.user_id = u2.id
         LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
         WHERE b.id = ?`
      )
      .get(req.params.id);

    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });
    if (!canAccessBooking(booking, req.user)) {
      return res.status(403).json({ success: false, error: "無權查看此預約" });
    }
    res.json(booking);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/bookings/:id/qr — QR Code =====
router.get("/:id/qr", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const booking = db
      .prepare(
        `SELECT b.*, cs.id as schedule_id, c.coach_id
         FROM bookings b
         JOIN class_schedules cs ON b.schedule_id = cs.id
         JOIN classes c ON b.class_id = c.id
         WHERE b.id = ?`
      )
      .get(req.params.id);

    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });
    if (!canAccessBooking(booking, req.user)) {
      return res.status(403).json({ success: false, error: "無權取得此預約 QR" });
    }

    // 2026-10-24：改用角色層級（原本硬編碼 "admin" → platform_manager/staff 反而被拒）
    if (booking.user_id !== req.user.id && !hasMinimumRole(req.user.role, "admin")) {
      const cls = db.prepare("SELECT coach_id FROM classes WHERE id = ?").get(booking.class_id);
      if (!cls || cls.coach_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "無權限存取此 QR Code" });
      }
    }

    const qrData = `zenpass-checkin:${booking.booking_reference || booking.id}:${booking.schedule_id}`;
    const checkinCode = bookingService.checkinCodeFor(booking);
    const base = {
      qr_text: qrData,
      checkin_code: checkinCode,
      booking_reference: booking.booking_reference,
      booking_id: booking.id,
      schedule_id: booking.schedule_id,
      status: booking.status,
    };
    try {
      const QRCode = require("qrcode");
      QRCode.toDataURL(qrData, { width: 320, margin: 2 }, (err, url) => {
        if (err) return res.json(base);
        res.json(Object.assign({ qr_data_url: url }, base));
      });
    } catch (e) {
      res.json(base);
    }
  } catch (err) {
    console.error("QR 生成錯誤:", err);
    res.status(500).json({ success: false, error: "QR Code 生成失敗" });
  }
});

// ===== POST /api/bookings/checkin — QR 簽到 =====
router.post("/checkin", authenticateToken, (req, res) => {
  try {
    const result = bookingService.processQRCheckin(req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("QR 簽到錯誤:", err);
    res.status(500).json({ success: false, error: "簽到失敗，請稍後再試" });
  }
});

// ===== POST /api/bookings/:id/no-show =====
router.post("/:id/no-show", authenticateToken, (req, res) => {
  try {
    const result = bookingService.markNoShow(req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("No-show error:", err.message);
    res.status(500).json({ success: false, error: "Operation failed" });
  }
});

module.exports = router;
