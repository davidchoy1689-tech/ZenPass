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

module.exports = router;
