/**
 * ZenPass 禪流 — 評價系統 API (雙方互評)
 * 學生↔教練 課後互評，每 booking 雙方各可評一次
 */

const express = require("express");
const router = express.Router();
const path = require("path");
const { getDb } = require("../services/database");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");

const DB_PATH = path.join(__dirname, "..", "..", "data", "zenpass.db");

// ===== POST /api/reviews — 建立評價 =====
router.post("/", authenticateToken, (req, res) => {
  try {
    const { booking_id, to_user_id, rating, comment, is_anonymous } = req.body;
    const from_user_id = req.user.id;
    const role = req.user.role === "coach" ? "coach" : "student";

    if (!booking_id || !to_user_id || !rating) {
      return res.status(400).json({ success: false, error: "缺少必要資料" });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "評分須在 1-5 之間" });
    }

    const db = getDb();
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

      return res.status(404).json({ success: false, error: "預約不存在或未完成" });
    }

    // Verify user is part of this booking
    const isStudent = booking.user_id === from_user_id;
    const isCoach = booking.coach_id === from_user_id;
    if (!isStudent && !isCoach) {

      return res.status(403).json({ success: false, error: "你不是此預約的參與者" });
    }

    // Verify to_user_id matches the other party
    const expectedToId = isStudent ? booking.coach_id : booking.user_id;
    if (to_user_id !== expectedToId) {

      return res.status(400).json({ success: false, error: "評價對象不正確" });
    }

    // Check if already reviewed
    const existing = db
      .prepare(
        `SELECT id FROM reviews WHERE booking_id = ? AND from_user_id = ?`,
      )
      .get(booking_id, from_user_id);
    if (existing) {

      return res.status(400).json({ success: false, error: "你已經評價過此預約" });
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

    // ⛓️ 區塊鏈：記錄評價
    try {
      writeBlock({
        entityType: "review",
        entityId: reviewId,
        data: {
          user_id: from_user_id,
          coach_id: isStudent ? to_user_id : from_user_id,
          booking_id,
          rating,
          comment: comment || "",
          class_id: booking.class_id,
          class_title: booking.class_title,
          role,
          is_anonymous: is_anonymous ? 1 : 0,
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (review):", bcErr.message);
    }

    res.json({ success: true, review_id: reviewId });
  } catch (err) {
    console.error("建立評價錯誤:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/reviews/:userId — 取得用戶評價 =====
router.get("/:userId", (req, res) => {
  try {
    const db = getDb();
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

    res.json({ reviews, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/reviews/booking/:bookingId — 取得預約的評價狀態 =====
router.get("/booking/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

      return res.status(404).json({ success: false, error: "預約不存在" });
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

    res.json({ booking, reviews });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/reviews/public/testimonials — 首頁顯示嘅公開評價 =====
router.get("/public/testimonials", (req, res) => {
  try {
    const db = getDb();
    const testimonials = db
      .prepare(`
      SELECT r.id, r.rating, r.comment, r.created_at,
        u.name as user_name,
        COALESCE((SELECT c.title FROM bookings b JOIN classes c ON b.class_id = c.id WHERE b.id = r.booking_id), '') as class_name
      FROM reviews r
      JOIN users u ON r.from_user_id = u.id
      WHERE r.comment IS NOT NULL AND r.comment != ''
      ORDER BY r.created_at DESC
      LIMIT 10
    `)
      .all();

    var curatedFallback = [
      { user_name: "Winnie", tag: "瑜伽初學者", comment: "第一次上瑜伽班就愛上咗！靜儀導師好專業，環境又好舒服，而家逢星期三都嚟上堂～", rating: 5 },
      { user_name: "阿強", tag: "健身愛好者", comment: "用 ZenPass 上咗幾個月堂，一個 Pass 就玩到瑜伽、拳擊、攀岩，好方便！", rating: 5 },
      { user_name: "Phoebe", tag: "在職媽媽", comment: "產後修復班幫咗我好多！公司嘅企業健康計劃仲可以免費上堂，真係好正～", rating: 5 },
      { user_name: "小明", tag: "學生", comment: "平價就玩到咁多種運動，性價比超高！推薦俾咗好多同學", rating: 5 },
      { user_name: "Catherine", tag: "辦公室OL", comment: "Lunch time 去上堂好方便，一個Pass搞掂，唔使逐間俾錢", rating: 4 }
    ];

    var formatted = testimonials.map(function(t) { return {
      user_name: t.user_name,
      tag: t.class_name || "學員",
      comment: t.comment,
      rating: t.rating
    };});

    // If fewer than 3 real reviews, merge with curated
    if (formatted.length < 3) {
      formatted = formatted.concat(curatedFallback);
    }

    res.json({ testimonials: formatted });
  } catch (err) {
    console.error("[TESTIMONIALS] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
