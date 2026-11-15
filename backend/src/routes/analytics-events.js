/**
 * analytics-events.js — 輕量前端事件收集（2026-11-16）
 * POST /api/analytics/event  { event, meta }
 * 只用作產品覆盤（安裝列曝光／關閉／成交），不含個人資料。
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");

const router = express.Router();
const ALLOWED = new Set([
  "install_bar_impression",
  "install_bar_dismiss_permanent",
  "install_bar_dismiss_session",
  "install_bar_click",
  "install_how_to_ios",
  "install_accepted",
  "success_install_hint_shown",
  "success_install_hint_click",
]);

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      meta TEXT,
      path TEXT,
      ua TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ae_event ON analytics_events(event, created_at);
  `);
}

router.post("/analytics/event", express.json({ limit: "4kb" }), (req, res) => {
  try {
    const event = String((req.body || {}).event || "");
    if (!ALLOWED.has(event)) return res.status(400).json({ success: false, error: "unknown event" });
    const db = getDb();
    ensureSchema(db);
    const meta = JSON.stringify((req.body || {}).meta || {}).slice(0, 1000);
    db.prepare("INSERT INTO analytics_events (id, event, meta, path, ua) VALUES (?,?,?,?,?)").run(
      "ae_" + crypto.randomBytes(8).toString("hex"),
      event,
      meta,
      String(req.body.path || "").slice(0, 200),
      String(req.headers["user-agent"] || "").slice(0, 200),
    );
    res.status(204).end();
  } catch (e) {
    res.status(204).end();
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
