/**
 * ZenPass Push Notification Routes
 * POST /api/push/subscribe — Save push subscription
 * POST /api/push/unsubscribe — Remove push subscription
 */

const express = require("express");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// POST /api/push/subscribe — Save push subscription
router.post("/subscribe", authenticateToken, (req, res) => {
  try {
    const { subscription, userAgent } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "缺少 subscription 資料" });
    }

    const db = new Database(DB_PATH);
    const subJson = JSON.stringify(subscription);

    // Check if already subscribed
    const existing = db
      .prepare(
        "SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
      )
      .get(subscription.endpoint, req.user.id);

    if (existing) {
      db.prepare(
        "UPDATE push_subscriptions SET subscription = ?, user_agent = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(subJson, userAgent || "", existing.id);
    } else {
      db.prepare(
        "INSERT INTO push_subscriptions (id, user_id, endpoint, subscription, user_agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      ).run(
        uuidv4(),
        req.user.id,
        subscription.endpoint,
        subJson,
        userAgent || "",
      );
    }

    db.close();
    res.json({ success: true });
  } catch (err) {
    console.error("[PUSH] Subscribe error:", err);
    res.status(500).json({ error: "訂閱推播失敗" });
  }
});

// POST /api/push/unsubscribe — Remove push subscription
router.post("/unsubscribe", authenticateToken, (req, res) => {
  try {
    const { endpoint } = req.body;
    const db = new Database(DB_PATH);
    db.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
    ).run(endpoint, req.user.id);
    db.close();
    res.json({ success: true });
  } catch (err) {
    console.error("[PUSH] Unsubscribe error:", err);
    res.status(500).json({ error: "取消訂閱失敗" });
  }
});

module.exports = router;
