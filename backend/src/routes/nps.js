/**
 * ZenPass 禪流 — NPS 課後問卷路由
 *
 * 端點：
 *   POST /api/nps/submit — 提交 NPS 問卷
 *   GET  /api/nps/stats   — 管理員睇 NPS score 統計
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// ===== 確保 NPS 表存在（啟動時由 init-db.js 建立，此處 double-check）=====
function ensureNpsTable() {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS nps_surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 10),
        comment TEXT DEFAULT '',
        would_recommend INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (booking_id) REFERENCES bookings(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  } catch (err) {
    console.error("⚠️ ensureNpsTable error:", err.message);
  }
}

// ===== POST /api/nps/submit — 提交 NPS 問卷 =====
router.post("/submit", authenticateToken, (req, res) => {
  try {
    ensureNpsTable();

    const { booking_id, rating, comment, would_recommend } = req.body;

    // Validation
    if (!booking_id || !rating) {
      return res.status(400).json({ success: false, error: "請提供 booking_id 和評分" });
    }

    const ratingNum = parseInt(rating);
    if (ratingNum < 1 || ratingNum > 10) {
      return res.status(400).json({ success: false, error: "NPS 評分必須為 1-10" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Verify booking exists and belongs to this user
    const booking = db
      .prepare("SELECT id, user_id, status FROM bookings WHERE id = ?")
      .get(booking_id);

    if (!booking) {
      return res.status(404).json({ success: false, error: "預約記錄不存在" });
    }

    if (Number(booking.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, error: "你無權限評價此預約" });
    }

    // Must be attended
    if (booking.status !== "attended") {
      return res.status(400).json({ success: false, error: "只能對已出席嘅課程提交評價" });
    }

    // Check if already submitted NPS for this booking
    const existing = db
      .prepare("SELECT id FROM nps_surveys WHERE booking_id = ?")
      .get(booking_id);

    if (existing) {
      return res.status(400).json({ success: false, error: "你已經提交過呢個課程嘅評價，多謝你！" });
    }

    // Insert NPS survey
    const result = db
      .prepare(
        `INSERT INTO nps_surveys (booking_id, user_id, rating, comment, would_recommend)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(booking_id, req.user.id, ratingNum, (comment || "").trim(), would_recommend ? 1 : 0);

    res.status(201).json({
      success: true,
      message: "多謝你嘅評價！你的意見幫助我哋變得更好 🙏",
      id: result.lastInsertRowid,
    });
  } catch (err) {
    console.error("提交 NPS 問卷錯誤:", err);
    res.status(500).json({ success: false, error: "無法提交問卷" });
  }
});

// ===== GET /api/nps/stats — NPS 統計（管理員用）=====
router.get("/stats", authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureNpsTable();

    const db = getDb();

    // Overall stats
    const total = db.prepare("SELECT COUNT(*) as count FROM nps_surveys").get();

    // NPS calculation:
    // Promoters = 9-10, Passives = 7-8, Detractors = 0-6
    // NPS = %Promoters - %Detractors
    const promoters = db
      .prepare("SELECT COUNT(*) as count FROM nps_surveys WHERE rating >= 9")
      .get();
    const passives = db
      .prepare("SELECT COUNT(*) as count FROM nps_surveys WHERE rating >= 7 AND rating <= 8")
      .get();
    const detractors = db
      .prepare("SELECT COUNT(*) as count FROM nps_surveys WHERE rating <= 6")
      .get();

    const totalCount = total.count || 1; // avoid division by zero
    const pctPromoters = Math.round((promoters.count / totalCount) * 100);
    const pctDetractors = Math.round((detractors.count / totalCount) * 100);
    const npsScore = pctPromoters - pctDetractors;

    // Rating distribution
    const distribution = db
      .prepare(
        `SELECT rating, COUNT(*) as count
         FROM nps_surveys
         GROUP BY rating
         ORDER BY rating DESC`,
      )
      .all();

    // Recent surveys
    const recent = db
      .prepare(
        `SELECT n.id, n.rating, n.comment, n.would_recommend, n.created_at,
                u.name as user_name, c.title as class_title
         FROM nps_surveys n
         JOIN users u ON n.user_id = u.id
         JOIN bookings b ON n.booking_id = b.id
         JOIN classes c ON b.class_id = c.id
         ORDER BY n.created_at DESC
         LIMIT 20`,
      )
      .all();

    // Recommend percentage
    const wouldRecommend = db
      .prepare("SELECT COUNT(*) as count FROM nps_surveys WHERE would_recommend = 1")
      .get();

    res.json({
      success: true,
      stats: {
        total_responses: total.count,
        nps_score: npsScore,
        promoters: { count: promoters.count, percentage: pctPromoters },
        passives: { count: passives.count, percentage: Math.round((passives.count / totalCount) * 100) },
        detractors: { count: detractors.count, percentage: pctDetractors },
        would_recommend: wouldRecommend.count,
        would_not_recommend: total.count - wouldRecommend.count,
        average_rating: total.count > 0
          ? Math.round((db.prepare("SELECT AVG(rating) as avg FROM nps_surveys").get().avg) * 10) / 10
          : 0,
      },
      distribution,
      recent,
    });
  } catch (err) {
    console.error("獲取 NPS 統計錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得統計數據" });
  }
});

module.exports = router;
