/**
 * ZenPass - 推薦計劃 + 忠誠度路由
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

// ===== GET /api/referral/my-code — 我的推薦碼 =====
router.get("/my-code", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    let code = db
      .prepare("SELECT code FROM referral_codes WHERE user_id = ?")
      .get(req.user.id);
    if (!code) {
      const newCode =
        "ZP" +
        Math.random().toString(36).substring(2, 7).toUpperCase() +
        req.user.id.slice(-4);
      db.prepare(
        "INSERT INTO referral_codes (id, user_id, code) VALUES (?, ?, ?)",
      ).run(uuidv4(), req.user.id, newCode);
      code = { code: newCode };
    }
    const count = db
      .prepare(
        "SELECT COUNT(*) as c FROM referral_redemptions WHERE referrer_id = ? AND status = 'completed'",
      )
      .get(req.user.id);
    const credits = db
      .prepare("SELECT referral_credits_earned FROM users WHERE id = ?")
      .get(req.user.id);

    res.json({
      code: code.code,
      redeemed: count.c,
      credits_earned: credits?.referral_credits_earned || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "無法取得推薦碼" });
  }
});

// ===== POST /api/referral/redeem — 使用推薦碼 =====
router.post("/redeem", authenticateToken, (req, res) => {
  try {
    const out = require("../services/referral-service").redeemCode(
      req.user.id,
      req.body && req.body.code,
    );
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error("Referral error:", err);
    res.status(500).json({ success: false, error: "使用推薦碼失敗" });
  }
});

// ===== GET /api/referral/tiers — 會員等級福利（同 services/loyalty 單一來源）=====
router.get("/tiers", authenticateToken, (req, res) => {
  try {
    const { TIERS } = require("../services/loyalty");
    const tiers = Object.entries(TIERS).map(([id, t]) => ({
      id,
      name: `${t.icon} ${t.name}`,
      min_bookings: t.min_bookings,
      benefits: (t.benefits || []).map((b) => b.text),
    }));
    res.json({ tiers });
  } catch (err) {
    console.error("referral/tiers error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取等級資料" });
  }
});

module.exports = router;
