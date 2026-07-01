/**
 * ZenPass 禪流 - Loyalty Tier API
 */

const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { getDb } = require("../services/database");
const {
  TIERS,
  getUserTierInfo,
  updateUserTier,
  getTopUpDiscount,
} = require("../services/loyalty");

// ===== GET /api/loyalty/tiers — 取得所有 tier 定義 =====
router.get("/tiers", (req, res) => {
  res.json({
    success: true,
    tiers: TIERS,
  });
});

// ===== GET /api/loyalty/my — 我嘅 loyalty 資訊 =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const info = getUserTierInfo(req.user.id);

    if (!info) {
      return res.status(404).json({ success: false, error: "用戶資料不存在" });
    }

    res.json({
      success: true,
      ...info,
    });
  } catch (err) {
    console.error("獲取忠誠度資訊錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取忠誠度資訊" });
  }
});

// ===== GET /api/loyalty/discount — 我嘅 top-up 折扣 =====
router.get("/discount", authenticateToken, (req, res) => {
  try {
    const discountPercent = getTopUpDiscount(req.user.id);
    res.json({
      success: true,
      discount_percent: discountPercent,
      has_discount: discountPercent > 0,
    });
  } catch (err) {
    console.error("獲取折扣資訊錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取折扣資訊" });
  }
});

// ===== POST /api/loyalty/refresh — 手動刷新 tier =====
router.post("/refresh", authenticateToken, (req, res) => {
  try {
    const result = updateUserTier(req.user.id);
    res.json({
      success: true,
      message: `✅ 已更新忠誠度等級：${result.tier_info.icon} ${result.tier_info.name}`,
      ...result,
    });
  } catch (err) {
    console.error("刷新忠誠度錯誤:", err);
    res.status(500).json({ success: false, error: "刷新忠誠度失敗" });
  }
});

module.exports = router;
