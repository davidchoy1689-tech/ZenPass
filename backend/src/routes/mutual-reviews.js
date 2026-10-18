/**
 * ZenPass — 場地／教練 雙向評分（匿名）
 *
 *   POST /api/mutual-reviews/submit              提交評分
 *   GET  /api/mutual-reviews/summary/:type/:id    匿名彙總（type = venue | coach）
 *   GET  /api/mutual-reviews/mine                 我提交過嘅評分
 *
 * 註：學生 ↔ 教練 課後互評沿用 /api/reviews（已有）
 */

const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { submitReview, summary } = require("../services/mutual-review");
const { getDb } = require("../services/database");
const { awardPointsOnce, EARN_RULES } = require("../services/points");

const router = express.Router();

router.post("/submit", authenticateToken, (req, res) => {
  try {
    const { target_type, target_id, rater_role, context_type, context_id, rating, tags, reasons, comment } =
      req.body || {};
    if (!target_type || !target_id || !rater_role || !context_id) {
      return res.status(400).json({ success: false, error: "缺少必要資料" });
    }
    const out = submitReview({
      raterId: req.user.id,
      raterRole: rater_role,
      targetType: target_type,
      targetId: target_id,
      contextType: context_type || "rental",
      contextId: context_id,
      rating,
      tags,
      reasons,
      comment,
    });
    // 課後評價 → 學生賺積分（每張 booking 只發一次；評教練／評場地共用）
    let pointsAwarded = 0;
    if (rater_role === "student" && context_type === "booking" && context_id) {
      try {
        const award = awardPointsOnce(req.user.id, {
          points: EARN_RULES.review,
          source: "review",
          referenceId: String(context_id),
          description: "⭐ 課後評價",
        });
        if (award && award.awarded) pointsAwarded = award.awarded;
      } catch (e) {
        console.error("⚠️ Points award failed (mutual review):", e.message);
      }
    }

    res.status(201).json({
      success: true,
      message: pointsAwarded
        ? `✅ 已提交（匿名），多謝你嘅意見 · +${pointsAwarded} 積分 🎁`
        : "✅ 已提交（匿名），多謝你嘅意見",
      points_awarded: pointsAwarded,
      data: out,
    });
  } catch (err) {
    const code = err.status || 500;
    if (code >= 500) console.error("mutual-reviews/submit error:", err.message);
    res.status(code).json({ success: false, error: err.message || "提交失敗" });
  }
});

router.get("/summary/:type/:id", (req, res) => {
  try {
    const { type, id } = req.params;
    if (!["venue", "coach"].includes(type)) {
      return res.status(400).json({ success: false, error: "類型錯誤" });
    }
    res.json({ success: true, data: summary(type, id) });
  } catch (err) {
    console.error("mutual-reviews/summary error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取評分" });
  }
});

router.get("/mine", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT target_type, target_id, rating, tags, reasons, comment, created_at
         FROM mutual_reviews WHERE rater_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("mutual-reviews/mine error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

module.exports = router;
