/**
 * ZenPass 禪流 — 教練評分路由
 *
 * 提供教練評分提交、查詢、排名功能
 *
 * 端點：
 *   POST /api/ratings              — 提交評分
 *   GET  /api/ratings/coach/:id    — 查詢教練評分
 *   GET  /api/coaches/ranking      — 教練排名
 */

const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, optionalAuth } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../../data/zenpass.db");

// ===== POST /api/ratings — 提交教練評分 =====
router.post("/", authenticateToken, (req, res) => {
  try {
    const { booking_id, coach_id, rating, comment } = req.body;

    // Validation
    if (!booking_id || !coach_id || !rating) {
      return res.status(400).json({ error: "請提供 booking_id、coach_id 和評分" });
    }

    const ratingNum = parseInt(rating);
    if (ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "評分必須為 1-5" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Verify booking exists and belongs to this user
    const booking = db
      .prepare(
        `SELECT b.id, b.user_id, b.class_id, b.status, c.coach_id, c.title as class_title
         FROM bookings b
         JOIN classes c ON b.class_id = c.id
         WHERE b.id = ?`,
      )
      .get(booking_id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約記錄不存在" });
    }

    if (booking.user_id !== req.user.id) {
      db.close();
      return res.status(403).json({ error: "你無權限評分此預約" });
    }

    // Must be attended
    if (booking.status !== "attended") {
      db.close();
      return res.status(400).json({ error: "只能對已出席嘅課程評分" });
    }

    // Verify coach_id matches
    if (booking.coach_id !== coach_id) {
      db.close();
      return res.status(400).json({ error: "教練 ID 與課程不符" });
    }

    // Check if already rated
    const existing = db
      .prepare("SELECT id FROM coach_ratings WHERE booking_id = ? AND user_id = ?")
      .get(booking_id, req.user.id);

    if (existing) {
      // Update existing rating
      db.prepare(
        "UPDATE coach_ratings SET rating = ?, comment = ?, created_at = datetime('now') WHERE id = ?",
      ).run(ratingNum, comment || "", existing.id);

      db.close();
      return res.json({ message: "評分已更新", id: existing.id, rating: ratingNum });
    }

    // Insert new rating
    const id = uuidv4();
    db.prepare(
      `INSERT INTO coach_ratings (id, coach_id, booking_id, user_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, coach_id, booking_id, req.user.id, ratingNum, comment || "");

    // Mark booking as reviewed
    db.prepare("UPDATE bookings SET reviewed_student = 1 WHERE id = ?").run(booking_id);

    db.close();

    res.status(201).json({
      message: "評分已提交",
      id,
      coach_id,
      rating: ratingNum,
    });
  } catch (err) {
    console.error("提交評分錯誤:", err);
    res.status(500).json({ error: "無法提交評分" });
  }
});

// ===== GET /api/ratings/coach/:coachId — 查詢教練評分 =====
router.get("/coach/:coachId", optionalAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get ratings with user info
    const ratings = db
      .prepare(
        `SELECT cr.id, cr.coach_id, cr.rating, cr.comment, cr.created_at,
                u.name as user_name, u.avatar_url as user_avatar
         FROM coach_ratings cr
         JOIN users u ON cr.user_id = u.id
         WHERE cr.coach_id = ?
         ORDER BY cr.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(req.params.coachId, parseInt(limit), offset);

    // Get aggregate stats
    const stats = db
      .prepare(
        `SELECT 
          COUNT(*) as total_ratings,
          ROUND(AVG(rating), 1) as average_rating,
          SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
          SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
          SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
          SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
         FROM coach_ratings
         WHERE coach_id = ?`,
      )
      .get(req.params.coachId);

    const total = db
      .prepare("SELECT COUNT(*) as count FROM coach_ratings WHERE coach_id = ?")
      .get(req.params.coachId);

    db.close();

    res.json({
      ratings,
      stats: stats || { total_ratings: 0, average_rating: 0 },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
        total_pages: Math.ceil(total.count / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("查詢教練評分錯誤:", err);
    res.status(500).json({ error: "無法取得評分資料" });
  }
});

// ===== GET /api/coaches/ranking — 教練排名（按平均評分）=====
router.get("/ranking", optionalAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const { limit = 20, category } = req.query;

    let whereClause = "WHERE u.is_coach = 1";
    const params = [];

    if (category) {
      whereClause += " AND (c.category = ? OR c.category IS NOT NULL)";
      params.push(category);
    }

    const coaches = db
      .prepare(
        `SELECT 
          u.id, u.name, u.avatar_url, u.coach_verified,
          COALESCE(cr_stats.avg_rating, 0) as average_rating,
          COALESCE(cr_stats.total_ratings, 0) as total_ratings,
          COALESCE(cr_stats.five_star, 0) as five_star,
          COALESCE(cr_stats.four_star, 0) as four_star,
          COALESCE(cr_stats.three_star, 0) as three_star,
          COALESCE(cr_stats.two_star, 0) as two_star,
          COALESCE(cr_stats.one_star, 0) as one_star,
          (SELECT COUNT(*) FROM classes WHERE coach_id = u.id AND status = 'active') as class_count
         FROM users u
         LEFT JOIN (
           SELECT 
             coach_id,
             ROUND(AVG(rating), 1) as avg_rating,
             COUNT(*) as total_ratings,
             SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
             SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
             SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
             SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
             SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
           FROM coach_ratings
           GROUP BY coach_id
         ) cr_stats ON u.id = cr_stats.coach_id
         ${whereClause}
         ORDER BY cr_stats.avg_rating DESC, cr_stats.total_ratings DESC
         LIMIT ?`,
      )
      .all(...params, parseInt(limit));

    db.close();

    res.json({
      coaches,
      total: coaches.length,
    });
  } catch (err) {
    console.error("查詢教練排名錯誤:", err);
    res.status(500).json({ error: "無法取得教練排名" });
  }
});

module.exports = router;
