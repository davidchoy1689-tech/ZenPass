/**
 * Web Push 公開端點
 * GET  /api/push/vapid-public-key  — 前端訂閱用公開金鑰
 * POST /api/push/guest-subscribe   — 訪客（子女）綁定簽到通知
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");

const router = express.Router();

function ensureCols(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    if (!cols.includes("push_subscription")) db.prepare("ALTER TABLE bookings ADD COLUMN push_subscription TEXT").run();
  } catch (e) { console.error("[PUSH] ensure cols:", e.message); }
}

router.get("/vapid-public-key", (req, res) => {
  res.json({ success: true, key: process.env.VAPID_PUBLIC_KEY || "" });
});

router.post("/guest-subscribe", (req, res) => {
  try {
    const { token, subscription } = req.body || {};
    if (!token || !subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: "缺少 token 或 subscription" });
    }
    const db = getDb();
    ensureCols(db);
    const sess = db
      .prepare("SELECT user_id FROM guest_sessions WHERE token=? AND expires_at > datetime('now')")
      .get(token);
    if (!sess) return res.status(401).json({ success: false, error: "訪客登入已過期" });

    const subJson = JSON.stringify(subscription);
    const existing = db
      .prepare("SELECT id FROM push_subscriptions WHERE endpoint=? AND user_id=?")
      .get(subscription.endpoint, sess.user_id);
    if (existing) {
      db.prepare("UPDATE push_subscriptions SET subscription=?, updated_at=datetime('now') WHERE id=?")
        .run(subJson, existing.id);
    } else {
      db.prepare(
        `INSERT INTO push_subscriptions (id,user_id,endpoint,subscription,user_agent,created_at,updated_at)
         VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`,
      ).run(uuidv4(), sess.user_id, subscription.endpoint, subJson, req.headers["user-agent"] || "");
    }
    // 同步寫入該用戶仍有效嘅 booking（規格要求：bookings 表可追溯）
    db.prepare(
      "UPDATE bookings SET push_subscription=? WHERE user_id=? AND status IN ('pending_payment','confirmed')",
    ).run(subJson, sess.user_id);

    res.json({ success: true });
  } catch (e) {
    console.error("[PUSH] guest subscribe:", e.message);
    res.status(500).json({ success: false, error: "訂閱失敗" });
  }
});

module.exports = router;
