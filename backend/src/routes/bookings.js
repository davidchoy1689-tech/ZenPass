/**
 * ZenPass 禪流 - 預約路由（精簡版）
 * Business logic 已移至 services/booking-service.js
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { scalpGuard } = require("../middleware/anti-scalping");
const { validate, schemas } = require("../middleware/validate");
const { requireIdempotency } = require("../middleware/idempotency");
const bookingService = require("../services/booking-service");

const router = express.Router();

// ===== POST /api/bookings — 建立預約 =====
router.post(
  "/",
  authenticateToken,
  scalpGuard,
  requireIdempotency,
  validate(schemas.booking),
  (req, res) => {
    try {
      const result = bookingService.createBooking(req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error("預約錯誤:", err);
      res.status(500).json({ success: false, error: "預約失敗，請稍後再試" });
    }
  }
);

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
        `SELECT b.*, c.title, c.category, c.duration, c.price_hkd, c.venue_name, c.venue_address, c.latitude, c.longitude, c.coach_id, cs.start_time, cs.end_time, u.name as coach_name
         FROM bookings b
         JOIN classes c ON b.class_id = c.id
         JOIN class_schedules cs ON b.schedule_id = cs.id
         JOIN users u ON c.coach_id = u.id
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
router.get("/today", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const today = new Date().toISOString().split("T")[0];
    const schedules = db
      .prepare(
        `SELECT cs.id as schedule_id, cs.start_time, cs.end_time, c.id as class_id, c.title, c.venue_name,
          (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'attended') as attended_count,
          (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'confirmed') as confirmed_count
         FROM class_schedules cs
         JOIN classes c ON cs.class_id = c.id
         WHERE date(cs.start_time) = date(?) AND cs.start_time > datetime('now', '-3 hours')
         ORDER BY cs.start_time`
      )
      .all(today);

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
         JOIN users u ON c.coach_id = u.id
         JOIN users u2 ON b.user_id = u2.id
         LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
         WHERE b.id = ?`
      )
      .get(req.params.id);

    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });
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
        `SELECT b.*, cs.id as schedule_id
         FROM bookings b JOIN class_schedules cs ON b.schedule_id = cs.id
         WHERE b.id = ?`
      )
      .get(req.params.id);

    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });

    if (booking.user_id !== req.user.id && req.user.role !== "admin") {
      const cls = db.prepare("SELECT coach_id FROM classes WHERE id = ?").get(booking.class_id);
      if (!cls || cls.coach_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "無權限存取此 QR Code" });
      }
    }

    const qrData = `zenpass-checkin:${booking.booking_reference || booking.id}:${booking.schedule_id}`;
    let qrDataUrl = null;
    try {
      const QRCode = require("qrcode");
      QRCode.toDataURL(qrData, { width: 300, margin: 2 }, (err, url) => {
        if (err) {
          return res.json({ qr_text: qrData, booking_reference: booking.booking_reference, booking_id: booking.id, schedule_id: booking.schedule_id });
        }
        res.json({ qr_data_url: url, qr_text: qrData, booking_reference: booking.booking_reference, booking_id: booking.id, schedule_id: booking.schedule_id });
      });
    } catch (e) {
      res.json({ qr_text: qrData, booking_reference: booking.booking_reference, booking_id: booking.id, schedule_id: booking.schedule_id });
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
