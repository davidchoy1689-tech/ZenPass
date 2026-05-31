/**
 * ZenPass 禪流 - 通知路由
 * In-app 🔔 API + 瀏覽器推送訂閱管理
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  sendNotification,
  sendTelegramAlert,
} = require("../services/notification");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/notifications — 通知列表 =====
router.get("/", authenticateToken, (req, res) => {
  const { page, limit, unreadOnly } = req.query;
  const result = getNotifications(req.user.id, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 50,
    unreadOnly: unreadOnly === "true" || unreadOnly === "1",
  });
  res.json(result);
});

// ===== GET /api/notifications/unread-count — 未讀數量 (用於 🔔 badge) =====
router.get("/unread-count", authenticateToken, (req, res) => {
  const count = getUnreadCount(req.user.id);
  res.json({ count });
});

// ===== PUT /api/notifications/:id/read — 標記單條為已讀 =====
router.put("/:id/read", authenticateToken, (req, res) => {
  const ok = markAsRead(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: "通知不存在" });
  res.json({ message: "已標記為已讀" });
});

// ===== PUT /api/notifications/read-all — 全部標記為已讀 =====
router.put("/read-all", authenticateToken, (req, res) => {
  const count = markAllAsRead(req.user.id);
  res.json({ message: `已標記 ${count} 條通知為已讀`, count });
});

// ===== POST /api/notifications/:id/read — 標記單條為已讀 (POST 版本) =====
router.post("/:id/read", authenticateToken, (req, res) => {
  const ok = markAsRead(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: "通知不存在" });
  res.json({ message: "已標記為已讀" });
});

// ===== POST /api/notifications/read-all — 全部標記為已讀 (POST 版本) =====
router.post("/read-all", authenticateToken, (req, res) => {
  const count = markAllAsRead(req.user.id);
  res.json({ message: `已標記 ${count} 條通知為已讀`, count });
});

// ===== DELETE /api/notifications/:id — 刪除通知 =====
router.delete("/:id", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const result = db
      .prepare(
        `
      DELETE FROM notifications WHERE id = ? AND user_id = ?
    `,
      )
      .run(req.params.id, req.user.id);
    db.close();
    if (result.changes === 0)
      return res.status(404).json({ error: "通知不存在" });
    res.json({ message: "已刪除" });
  } catch (err) {
    console.error("刪除通知錯誤:", err);
    res.status(500).json({ error: "無法刪除通知" });
  }
});

// ===== POST /api/notifications/push-subscribe — 註冊瀏覽器推送 =====
router.post("/push-subscribe", authenticateToken, (req, res) => {
  try {
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "缺少 subscription 資料" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 避免重複訂閱相同 endpoint
    const existing = db
      .prepare(
        `
      SELECT id FROM push_subscriptions WHERE user_id = ? AND subscription LIKE ?
    `,
      )
      .get(req.user.id, `%${subscription.endpoint}%`);

    if (existing) {
      // 更新 user_agent
      db.prepare(
        `UPDATE push_subscriptions SET subscription = ?, user_agent = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(
        JSON.stringify(subscription),
        req.headers["user-agent"] || null,
        existing.id,
      );
    } else {
      db.prepare(
        `
        INSERT INTO push_subscriptions (id, user_id, subscription, user_agent)
        VALUES (?, ?, ?, ?)
      `,
      ).run(
        uuidv4(),
        req.user.id,
        JSON.stringify(subscription),
        req.headers["user-agent"] || null,
      );
    }

    db.close();

    res.json({ message: "推送訂閱成功" });
  } catch (err) {
    console.error("推送訂閱錯誤:", err);
    res.status(500).json({ error: "無法註冊推送" });
  }
});

// ===== DELETE /api/notifications/push-unsubscribe — 取消推送訂閱 =====
router.delete("/push-unsubscribe", authenticateToken, (req, res) => {
  try {
    const { endpoint } = req.body;
    const db = new Database(DB_PATH);

    if (endpoint) {
      db.prepare(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND subscription LIKE ?`,
      ).run(req.user.id, `%${endpoint}%`);
    } else {
      db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(
        req.user.id,
      );
    }

    db.close();
    res.json({ message: "已取消推送訂閱" });
  } catch (err) {
    console.error("取消推送錯誤:", err);
    res.status(500).json({ error: "無法取消推送" });
  }
});

// ===== POST /api/notifications/test — 測試通知（即時發送）=====
router.post("/test", authenticateToken, async (req, res) => {
  try {
    const { type = "booking.confirmed", data = {} } = req.body;

    const result = await sendNotification(type, {
      recipient: req.user.id,
      data: {
        class_title: data.class_title || "測試課程",
        date: data.date || new Date().toISOString().split("T")[0],
        time: data.time || "10:00",
        venue: data.venue || "測試場地",
        coach_name: data.coach_name || "測試教練",
        student_name: req.user.name || "測試學生",
        amount: data.amount || "100",
        email: data.email || "",
        ...data,
      },
    });

    res.json({ message: "通知已發送", results: result });
  } catch (err) {
    console.error("測試通知錯誤:", err);
    res.status(500).json({ error: "發送通知失敗" });
  }
});

// ===== GET /api/notifications/config — 通知配置狀態 =====
router.get("/config", authenticateToken, (req, res) => {
  const config = {
    db: true,
    telegram: {
      enabled:
        !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID,
      bot_token_set: !!process.env.TELEGRAM_BOT_TOKEN,
      chat_id_set: !!process.env.TELEGRAM_CHAT_ID,
    },
    whatsapp: {
      enabled:
        !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
      account_set: !!process.env.TWILIO_ACCOUNT_SID,
      auth_set: !!process.env.TWILIO_AUTH_TOKEN,
    },
    whatsapp_free: {
      enabled:
        !!process.env.WHATSAPP_CALLMEBOT_KEY &&
        !!process.env.WHATSAPP_CALLMEBOT_TO,
      key_set: !!process.env.WHATSAPP_CALLMEBOT_KEY,
      phone_set: !!process.env.WHATSAPP_CALLMEBOT_TO,
    },
    types: (process.env.NOTIFICATION_TYPES || "db").split(","),
  };
  res.json({ config });
});

// ===== GET /api/notifications/telegram/auto-detect — Telegram Chat ID 自動偵測 =====
// 使用方式：
// 1. 設定 TELEGRAM_BOT_TOKEN 喺 .env
// 2. 喺 Telegram 向 bot 發送一條訊息（例如 /start）
// 3. 用管理員 token call 呢個 endpoint
router.get("/telegram/auto-detect", authenticateToken, async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(400).json({
      error: "請先在 .env 設定 TELEGRAM_BOT_TOKEN",
      hint: "去 @BotFather 開 bot 攞 token，然後放入 .env",
    });
  }

  try {
    const fetch = require("node-fetch");
    const res_ = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates`,
    );
    const data = await res_.json();

    if (!data.ok) {
      return res.status(502).json({
        error: "Telegram API 錯誤",
        detail: data.description,
      });
    }

    if (!data.result || data.result.length === 0) {
      return res.status(404).json({
        error: "未偵測到任何訊息",
        steps: [
          "1. 確認 bot token 正確",
          "2. 喺 Telegram 向 bot 發送 /start",
          "3. 再 call 多次呢個 endpoint",
        ],
      });
    }

    // 提取所有 unique chat IDs
    const chats = {};
    for (const update of data.result) {
      const msg =
        update.message || update.edited_message || update.channel_post;
      if (msg && msg.chat) {
        const { id, type, title, first_name, username } = msg.chat;
        const label = title || first_name || username || `Chat ${id}`;
        if (!chats[id]) {
          chats[id] = {
            id,
            type,
            label,
            first_seen: update.message?.date || null,
          };
        }
      }
    }

    const chatList = Object.values(chats);

    res.json({
      message: `偵測到 ${chatList.length} 個對話`,
      chats: chatList,
      instructions: `將其中一個 chat ID 放入 .env 做 TELEGRAM_CHAT_ID`,
      curl_set_chat_id:
        chatList.length > 0
          ? `echo "TELEGRAM_CHAT_ID=${chatList[0].id}" >> .env`
          : null,
    });
  } catch (err) {
    console.error("Telegram auto-detect error:", err.message);
    res
      .status(500)
      .json({ error: "無法連接 Telegram API", detail: err.message });
  }
});

// ===== POST /api/notifications/telegram/test — 測試傳送 Telegram 訊息 =====
router.post("/telegram/test", authenticateToken, async (req, res) => {
  const testMessage = `🧪 ZenPass Bot 測試通知
━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
✅ 如果睇到呢則訊息，表示 Telegram 已成功設定！`;

  const sent = await sendTelegramAlert(testMessage);

  if (sent) {
    res.json({
      message: "✅ Telegram 測試通知已成功送出",
      hint: "請檢查 Telegram 有冇收到訊息",
    });
  } else {
    res.status(502).json({
      error: "發送失敗",
      hint: "請檢查 .env 嘅 TELEGRAM_BOT_TOKEN 同 TELEGRAM_CHAT_ID 是否正確",
    });
  }
});

module.exports = router;
