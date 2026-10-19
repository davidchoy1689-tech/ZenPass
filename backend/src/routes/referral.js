/**
 * ZenPass - 推薦計劃 + 忠誠度路由
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");
const { awardPointsOnce, EARN_RULES } = require("../services/points");
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
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: "請輸入推薦碼" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    const ref = db
      .prepare("SELECT * FROM referral_codes WHERE code = ?")
      .get(code);
    if (!ref) {

      return res.status(404).json({ success: false, error: "推薦碼無效" });
    }
    if (ref.user_id === req.user.id) {

      return res.status(400).json({ success: false, error: "唔可以用自己嘅推薦碼" });
    }

    const existing = db
      .prepare("SELECT id FROM referral_redemptions WHERE referred_user_id = ?")
      .get(req.user.id);
    if (existing) {
      return res.status(400).json({ success: false, error: "你已經用過推薦碼" });
    }

    // 🔒 防假帳戶：未驗證電郵唔可以兌換推薦碼
    const acct = db.prepare("SELECT email_verified FROM users WHERE id = ?").get(req.user.id);
    if (!acct || !acct.email_verified) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        error: "請先驗證電郵地址，之後就可以使用推薦碼（可喺「我的」頁重新發送驗證電郵）。",
      });
    }

    const id = uuidv4();
    db.prepare(
      "INSERT INTO referral_redemptions (id, referrer_id, referred_user_id, code_used, status) VALUES (?, ?, ?, ?, 'completed')",
    ).run(id, ref.user_id, req.user.id, code);
    const ledger = require("../services/credit-ledger");
    ledger.applyCredits(db, {
      userId: req.user.id,
      credits: 10,
      type: "earn",
      source: "referral",
      referenceId: id,
      description: "使用推薦碼迎新獎賞",
    });
    db.prepare(
      "UPDATE users SET referral_credits_earned = COALESCE(referral_credits_earned,0) + 10 WHERE id = ?",
    ).run(req.user.id);
    ledger.applyCredits(db, {
      userId: ref.user_id,
      credits: 10,
      type: "earn",
      source: "referral",
      referenceId: id,
      description: "推薦朋友獎賞",
    });
    db.prepare(
      "UPDATE users SET referral_credits_earned = COALESCE(referral_credits_earned,0) + 10 WHERE id = ?",
    ).run(ref.user_id);
    try {
      writeBlock({
        entityType: "referral_redemption",
        entityId: id,
        data: JSON.stringify({
          referrer_id: ref.user_id,
          referred_user_id: req.user.id,
          code,
          credits_granted_referrer: 10,
          credits_granted_referred: 10,
        }),
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (referral):", bcErr.message);
    }

    // 推薦人賺積分（每個 redemption 只發一次）
    let pointsAwarded = 0;
    try {
      const award = awardPointsOnce(ref.user_id, {
        points: EARN_RULES.referral,
        source: "referral",
        referenceId: id,
        description: "🤝 推薦朋友加入 ZenPass",
      });
      if (award && award.awarded) pointsAwarded = award.awarded;
    } catch (e) {
      console.error("⚠️ Points award failed (referral):", e.message);
    }

    res.json({
      message: "✅ 推薦碼已使用！你獲得 10 Credits",
      bonus: 10,
      referrer_points_awarded: pointsAwarded,
    });
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
