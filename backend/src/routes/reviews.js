/**
 * ZenPass 禪流 — 評價系統 API (雙方互評)
 * 學生↔教練 課後互評，每 booking 雙方各可評一次
 */

const express = require("express");
const router = express.Router();
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken } = require("../middleware/auth");

const DB_PATH = path.join(__dirname, "..", "..", "data", "zenpass.db");

// ===== POST /api/reviews — 建立評價 =====
router.post("/", authenticateToken, (req, res) => {
  try {
    const { booking_id, to_user_id, rating, comment, is_anonymous } = req.body;
    const from_user_id = req.user.id;
    const role = req.user.role === "coach" ? "coach" : "student";

    if (!booking_id || !to_user_id || !rating) {
      return res.status(400).json({ error: "缺少必要資料" });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "評分須在 1-5 之間" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Check booking exists and user is participant
    const booking = db
      .prepare(
        `
      SELECT b.*, c.coach_id, c.title as class_title,
             cs.start_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.id = ? AND b.status = 'confirmed'
    `,
      )
      .get(booking_id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在或未完成" });
    }

    // Verify user is part of this booking
    const isStudent = booking.user_id === from_user_id;
    const isCoach = booking.coach_id === from_user_id;
    if (!isStudent && !isCoach) {
      db.close();
      return res.status(403).json({ error: "你不是此預約的參與者" });
    }

    // Verify to_user_id matches the other party
    const expectedToId = isStudent ? booking.coach_id : booking.user_id;
    if (to_user_id !== expectedToId) {
      db.close();
      return res.status(400).json({ error: "評價對象不正確" });
    }

    // Check if already reviewed
    const existing = db
      .prepare(
        `SELECT id FROM reviews WHERE booking_id = ? AND from_user_id = ?`,
      )
      .get(booking_id, from_user_id);
    if (existing) {
      db.close();
      return res.status(400).json({ error: "你已經評價過此預約" });
    }

    // Create review
    const reviewId = "rev_" + uuidv4().slice(0, 12);
    db.prepare(
      `
      INSERT INTO reviews (id, booking_id, from_user_id, to_user_id, role, rating, comment, is_anonymous)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      reviewId,
      booking_id,
      from_user_id,
      to_user_id,
      role,
      rating,
      comment || "",
      is_anonymous ? 1 : 0,
    );

    // Update booking review flag
    const col = isStudent ? "reviewed_student" : "reviewed_coach";
    db.prepare(`UPDATE bookings SET ${col} = 1 WHERE id = ?`).run(booking_id);

    // Update coach average rating (首500個評分)
    if (isStudent) {
      const coachRating = db
        .prepare(
          `SELECT ROUND(AVG(rating), 1) as avg_rating FROM (SELECT rating FROM reviews WHERE to_user_id = ? AND role = 'student' ORDER BY created_at DESC LIMIT 500)`,
        )
        .get(booking.coach_id);
      db.prepare(`UPDATE users SET rating = ? WHERE id = ?`).run(
        coachRating.avg_rating,
        booking.coach_id,
      );
    }

    db.close();
    res.json({ success: true, review_id: reviewId });
  } catch (err) {
    console.error("建立評價錯誤:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/reviews/:userId — 取得用戶評價 =====
router.get("/:userId", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const reviews = db
      .prepare(
        `
      SELECT r.*, 
        u_from.name as from_name,
        u_to.name as to_name
      FROM reviews r
      LEFT JOIN users u_from ON r.from_user_id = u_from.id
      LEFT JOIN users u_to ON r.to_user_id = u_to.id
      WHERE r.to_user_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(req.params.userId, limit, offset);

    const stats = db
      .prepare(
        `
      SELECT 
        COUNT(*) as total,
        (SELECT ROUND(AVG(rating), 1) FROM (SELECT rating FROM reviews WHERE to_user_id = ? ORDER BY created_at DESC LIMIT 500)) as avg_rating,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as student_reviews,
        SUM(CASE WHEN role = 'coach' THEN 1 ELSE 0 END) as coach_reviews
      FROM reviews WHERE to_user_id = ?
    `,
      )
      .get(req.params.userId, req.params.userId);

    db.close();
    res.json({ reviews, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/reviews/booking/:bookingId — 取得預約的評價狀態 =====
router.get("/booking/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const booking = db
      .prepare(
        `
      SELECT b.*, c.coach_id, u.name as coach_name, u2.name as student_name
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN users u ON c.coach_id = u.id
      JOIN users u2 ON b.user_id = u2.id
      WHERE b.id = ?
    `,
      )
      .get(req.params.bookingId);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在" });
    }

    // Get reviews for this booking
    const reviews = db
      .prepare(
        `
      SELECT r.*, u.name as reviewer_name
      FROM reviews r
      LEFT JOIN users u ON r.from_user_id = u.id
      WHERE r.booking_id = ?
    `,
      )
      .all(req.params.bookingId);

    db.close();
    res.json({ booking, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
