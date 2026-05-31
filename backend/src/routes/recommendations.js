/**
 * ZenPass 禪流 - 推薦與追蹤路由
 */

var express = require("express");
var router = express.Router();
var { authenticateToken, optionalAuth } = require("../middleware/auth");
var {
  trackUserAction,
  getRecommendations,
  getPopularByCategory,
} = require("../services/recommendation");

// ===== POST /api/track — 記錄用戶行為 =====
router.post("/", optionalAuth, function (req, res) {
  try {
    var { action, data } = req.body;

    if (!action) {
      return res.status(400).json({ error: "缺少 action 參數" });
    }

    var validActions = ["view_class", "book_class", "search", "favorite"];
    if (validActions.indexOf(action) === -1) {
      return res.status(400).json({ error: "無效的 action: " + action });
    }

    var userId = req.user ? req.user.id : null;

    // If no user logged in, we can still track anonymous actions by session
    // but for now, skip tracking if no user
    if (!userId) {
      return res.json({ tracked: false, reason: "未登入" });
    }

    var result = trackUserAction(userId, action, data || {});

    res.json({ tracked: result });
  } catch (err) {
    console.error("追蹤錯誤:", err);
    res.status(500).json({ error: "追蹤失敗" });
  }
});

// ===== GET /api/recommendations — 獲取推薦課程 =====
router.get("/", optionalAuth, function (req, res) {
  try {
    var limit = parseInt(req.query.limit) || 10;
    var userId = req.user ? req.user.id : null;

    var recommendations;

    if (userId) {
      recommendations = getRecommendations(userId, limit);
    } else {
      recommendations = getPopularByCategory(limit);
    }

    res.json({ classes: recommendations });
  } catch (err) {
    console.error("推薦錯誤:", err);
    res.status(500).json({ error: "無法獲取推薦" });
  }
});

module.exports = router;
