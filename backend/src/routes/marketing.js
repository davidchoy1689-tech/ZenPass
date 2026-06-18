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
      {
        title: "🎉 歡迎加入 ZenPass！",
        body: `Hi ${name || ""}！歡迎加入 ZenPass 禪流 🧘\n\n探索超過 20 種運動課程。\n\n👉 ${getBaseUrl()}/explore.html`,
      },
      {
        title: "🎯 首次預約賺積分",
        body: `Hi ${name || ""}，每日簽到 +5 分，完成課堂 +50 分！\n👉 ${getBaseUrl()}/checkin.html`,
      },
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
    if (!subject || !message)
      return res.status(400).json({ error: "缺少主題或內容" });

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

// ===== POST /api/marketing/subscribe — Newsletter 訂閱 =====
router.post("/subscribe", function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "請輸入有效電郵" });
    }
    var interests = JSON.stringify(req.body.interests || []);
    var source = req.body.source || "web";

    var db2 = new Database(DB_PATH);
    db2.exec("CREATE TABLE IF NOT EXISTS newsletter_subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, interests TEXT DEFAULT '[]', source TEXT DEFAULT 'web', subscribed_at TEXT DEFAULT (datetime('now')), is_active INTEGER DEFAULT 1, unsubscribed_at TEXT)");

    try {
      db2.prepare("INSERT INTO newsletter_subscribers (email, interests, source) VALUES (?, ?, ?)").run(email, interests, source);
      db2.close();
      res.json({ message: "訂閱成功！" });
    } catch (e) {
      db2.close();
      if (e.message && e.message.indexOf("UNIQUE") >= 0) {
        var db3 = new Database(DB_PATH);
        db3.prepare("UPDATE newsletter_subscribers SET is_active = 1, interests = ?, source = ?, unsubscribed_at = NULL WHERE email = ?").run(interests, source, email);
        db3.close();
        res.json({ message: "你已經訂閱咗 🎉" });
      } else {
        res.status(500).json({ error: "訂閱失敗" });
      }
    }
  } catch (err) {
    console.error("[NEWSLETTER] Error:", err);
    res.status(500).json({ error: "訂閱失敗" });
  }
});

// ===== GET /api/marketing/subscribers — 訂閱者列表 =====
router.get("/subscribers", authenticateToken, requireAdmin, function (req, res) {
  try {
    var db4 = new Database(DB_PATH);
    var subs = db4.prepare("SELECT email, interests, source, subscribed_at, is_active FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT 500").all();
    var count = db4.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM newsletter_subscribers").get();
    db4.close();
    res.json({ subscribers: subs, stats: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/marketing/feedback — 網站意見回饋 =====
router.post("/feedback", function (req, res) {
  try {
    const { name, email, rating, comment, page } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "請輸入意見內容" });
    }
    var db = getDB();
    db.exec("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', email TEXT DEFAULT '', rating INTEGER DEFAULT 0, comment TEXT NOT NULL, page TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");
    db.prepare("INSERT INTO feedback (name, email, rating, comment, page) VALUES (?, ?, ?, ?, ?)").run(name || '', email || '', rating || 0, comment.trim(), page || '');
    // Send Telegram notification if configured
    try {
      var notif = require('../services/notification');
      notif.sendNotification('telegram_admin', {
        title: '💬 新意見回饋',
        message: `評分: ${'⭐'.repeat(rating || 0)}\n用戶: ${name || '匿名'}\n意見: ${comment.trim().substring(0, 200)}`
      });
    } catch(e) { /* notification optional */ }
    res.json({ success: true, message: "感謝你的意見，我們會繼續改進！" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
