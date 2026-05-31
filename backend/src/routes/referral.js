/**
 * ZenPass - 推薦計劃 + 忠誠度路由
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/referral/my-code — 我的推薦碼 =====
router.get("/my-code", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
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
    db.close();
    res.json({
      code: code.code,
      redeemed: count.c,
      credits_earned: credits?.referral_credits_earned || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "無法取得推薦碼" });
  }
});

// ===== POST /api/referral/redeem — 使用推薦碼 =====
router.post("/redeem", authenticateToken, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "請輸入推薦碼" });

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const ref = db
      .prepare("SELECT * FROM referral_codes WHERE code = ?")
      .get(code);
    if (!ref) {
      db.close();
      return res.status(404).json({ error: "推薦碼無效" });
    }
    if (ref.user_id === req.user.id) {
      db.close();
      return res.status(400).json({ error: "唔可以用自己嘅推薦碼" });
    }

    const existing = db
      .prepare("SELECT id FROM referral_redemptions WHERE referred_user_id = ?")
      .get(req.user.id);
    if (existing) {
      db.close();
      return res.status(400).json({ error: "你已經用過推薦碼" });
    }

    const id = uuidv4();
    db.prepare(
      "INSERT INTO referral_redemptions (id, referrer_id, referred_user_id, code_used, status) VALUES (?, ?, ?, ?, 'completed')",
    ).run(id, ref.user_id, req.user.id, code);
    db.prepare(
      "UPDATE users SET credits = COALESCE(credits,0) + 10, referral_credits_earned = COALESCE(referral_credits_earned,0) + 10 WHERE id = ?",
    ).run(req.user.id);
    db.prepare(
      "UPDATE users SET credits = COALESCE(credits,0) + 20, referral_credits_earned = COALESCE(referral_credits_earned,0) + 20 WHERE id = ?",
    ).run(ref.user_id);
    db.close();
    res.json({ message: "✅ 推薦碼已使用！你獲得 10 Credits", bonus: 10 });
  } catch (err) {
    console.error("Referral error:", err);
    res.status(500).json({ error: "使用推薦碼失敗" });
  }
});

// ===== GET /api/loyalty/tiers — 會籍等級福利 =====
router.get("/tiers", authenticateToken, (req, res) => {
  const tiers = [
    {
      id: "bronze",
      name: "🥉 銅牌",
      min_visits: 0,
      benefits: ["基本課程預約", "標準支援"],
    },
    {
      id: "silver",
      name: "🥈 銀牌",
      min_visits: 10,
      benefits: ["優先預約", "每月 1 堂免費", "專屬支援"],
    },
    {
      id: "gold",
      name: "🥇 金牌",
      min_visits: 30,
      benefits: [
        "無限預約",
        "每月 3 堂免費",
        "免費取消",
        "優先客服",
        "生日優惠",
      ],
    },
    {
      id: "platinum",
      name: "💎 鉑金",
      min_visits: 60,
      benefits: ["全部金牌功能", "私人教練諮詢", "新課程優先體驗", "活動邀請"],
    },
  ];
  res.json({ tiers });
});

module.exports = router;
