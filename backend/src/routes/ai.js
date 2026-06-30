/**
 * ZenPass 禪流 - AI API Route
 * 提供 AI 推薦、智能搜尋等功能
 */

const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { getDb } = require("../services/database");

const router = express.Router();

// POST /api/ai/recommend — 課程推薦
router.post("/recommend", authenticateToken, async (req, res) => {
  try {
    const { category, maxPrice } = req.body;
    const db = getDb();

    // Get user profile
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.user.id);

    // Get available courses
    const courses = db
      .prepare("SELECT * FROM classes WHERE status = 'active'")
      .all();

    const { recommendCourses } = require("../services/ai");
    const result = await recommendCourses(
      { category, maxPrice, pastBookings: user?.total_visits || 0 },
      courses,
    );

    res.json(result);
  } catch (err) {
    console.error("AI recommend error:", err);
    res.status(500).json({ success: false, error: "推薦失敗" });
  }
});

module.exports = router;
