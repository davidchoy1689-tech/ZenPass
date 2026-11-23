/**
 * ZenPass — 跨裝置付款意圖（pending_ops）
 * -------------------------------------------------
 * 同一登入帳號喺手機／電腦／兩個 tab 開付款，可以取回同一個
 * client_op_id（之後當 Idempotency-Key 用），避免重複落單。
 *
 *   POST /api/payments/pending-op          { scope, payload_hash }
 *   POST /api/payments/pending-op/:id/complete
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const TTL_MINUTES = 30;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_ops (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      expires_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_ops_unique
      ON pending_ops(user_id, scope, payload_hash) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS idx_pending_ops_expiry ON pending_ops(expires_at);
  `);
}

function clean(v) {
  return String(v == null ? "" : v).trim();
}

router.post("/pending-op", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const scope = clean(req.body && req.body.scope).slice(0, 80);
    const payloadHash = clean(req.body && req.body.payload_hash).slice(0, 120);
    if (!scope || !payloadHash) {
      return res.status(400).json({ success: false, error: "缺少 scope 或 payload_hash" });
    }
    const userId = String(req.user.id);

    // 過期只標記，不刪除（保留審計）
    db.prepare(
      "UPDATE pending_ops SET status='expired' WHERE user_id=? AND scope=? AND payload_hash=? AND status='pending' AND expires_at <= datetime('now')",
    ).run(userId, scope, payloadHash);

    const existing = db
      .prepare(
        "SELECT id, expires_at FROM pending_ops WHERE user_id=? AND scope=? AND payload_hash=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId, scope, payloadHash);
    if (existing) {
      return res.json({ success: true, client_op_id: existing.id, expires_at: existing.expires_at, resumed: true });
    }

    const id = crypto.randomUUID();
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO pending_ops (id, user_id, scope, payload_hash, status, expires_at)
         VALUES (?, ?, ?, ?, 'pending', datetime('now', ?))`,
      )
      .run(id, userId, scope, payloadHash, `+${TTL_MINUTES} minutes`);

    if (r.changes === 0) {
      const winner = db
        .prepare(
          "SELECT id, expires_at FROM pending_ops WHERE user_id=? AND scope=? AND payload_hash=? AND status='pending' LIMIT 1",
        )
        .get(userId, scope, payloadHash);
      if (winner) {
        return res.json({ success: true, client_op_id: winner.id, expires_at: winner.expires_at, resumed: true });
      }
    }

    const row = db.prepare("SELECT expires_at FROM pending_ops WHERE id=?").get(id);
    res.status(201).json({ success: true, client_op_id: id, expires_at: row && row.expires_at, resumed: false });
  } catch (e) {
    console.error("[PENDING-OP] create:", e.message);
    res.status(500).json({ success: false, error: "無法建立付款意圖" });
  }
});

router.post("/pending-op/:id/complete", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const id = clean(req.params.id);
    const r = db
      .prepare(
        "UPDATE pending_ops SET status='completed', completed_at=datetime('now') WHERE id=? AND user_id=? AND status='pending'",
      )
      .run(id, String(req.user.id));
    if (r.changes === 0) {
      const exists = db.prepare("SELECT status FROM pending_ops WHERE id=? AND user_id=?").get(id, String(req.user.id));
      if (!exists) return res.status(404).json({ success: false, error: "找不到付款意圖" });
      return res.json({ success: true, already_completed: true, status: exists.status });
    }
    res.json({ success: true, completed: true });
  } catch (e) {
    console.error("[PENDING-OP] complete:", e.message);
    res.status(500).json({ success: false, error: "無法更新付款意圖" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
