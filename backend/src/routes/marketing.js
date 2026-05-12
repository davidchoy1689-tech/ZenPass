/**
 * ZenPass 禪流 — WhatsApp 行銷路由
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { sendBroadcast } = require("../services/marketing");
const { sendNotification } = require("../services/notification");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== POST /api/marketing/send-welcome — 發送歡迎序列（給新用戶）=====
router.post("/send-welcome", authenticateToken, (req, res) => {
  try {
    const { user_id, name } = req.body;
    if (!user_id) return res.status(400).json({ error: "缺少用戶 ID" });

    const messages = [
      { title: "🎉 歡迎加入 ZenPass！", body: `Hi ${name || ''}！歡迎加入 ZenPass 禪流 🧘\n\n探索超過 20 種運動課程。\n\n👉 ${getBaseUrl()}/explore.html` },
      { title: "🎯 首次預約賺積分", body: `Hi ${name || ''}，每日簽到 +5 分，完成課堂 +50 分！\n👉 ${getBaseUrl()}/checkin.html` },
    ];

    for (const msg of messages) {
      sendNotification("marketing.welcome", {
        user_id,
        data: { title: msg.title, message: msg.body },
      }).catch(() => {});
    }

    res.json({ success: true, message: "✅ 歡迎訊息已發送" });
  } catch (err) {
    res.status(500).json({ error: "發送失敗" });
  }
});

// ===== POST /api/marketing/broadcast — Admin 推廣廣播 =====
router.post("/broadcast", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { subject, message, filters } = req.body;
    if (!subject || !message) return res.status(400).json({ error: "缺少主題或內容" });

    const result = await sendBroadcast(subject, message, filters || {});
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: "廣播發送失敗" });
  }
});

// ===== POST /api/marketing/winback — 手動觸發挽回檢查 =====
router.post("/winback", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { checkWinBackCandidates } = require("../services/marketing");
    const count = await checkWinBackCandidates();
    res.json({ success: true, notified: count });
  } catch (err) {
    res.status(500).json({ error: "挽回檢查失敗" });
  }
});

function getBaseUrl() {
  return process.env.BASE_URL || "http://localhost:3001";
}

module.exports = router;
