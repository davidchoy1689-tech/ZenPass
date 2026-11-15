/**
 * 教練收件箱（2026-11-16）
 *  - 教練 ↔ 平台（客服）：查詢、審批回覆
 *  - 教練 → 學員：訊息會以通知形式送到學員
 *
 *  GET  /api/coach/inbox                  我的訊息（含未讀數）
 *  POST /api/coach/inbox                  發送（to_user_id 可選；冇 = 發去平台）
 *  POST /api/coach/inbox/:id/read         標記已讀
 *  GET  /api/admin/coach-messages         平台收件（教練查詢）
 *  POST /api/admin/coach-messages/:id/reply 平台回覆
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");

const router = express.Router();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_messages (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      from_role TEXT NOT NULL CHECK(from_role IN ('coach','admin','student')),
      from_user_id TEXT,
      from_name TEXT,
      to_user_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cm_coach ON coach_messages(coach_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_cm_unread ON coach_messages(coach_id, read_at);
  `);
}

router.get("/coach/inbox", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT * FROM coach_messages WHERE coach_id=? ORDER BY datetime(created_at) DESC LIMIT 200`,
      )
      .all(req.user.id);
    const unread = rows.filter((r) => !r.read_at).length;
    res.set("Cache-Control", "no-store");
    res.json({ success: true, messages: rows, unread });
  } catch (e) {
    console.error("[INBOX] list:", e.message);
    res.status(500).json({ success: false, error: "讀取收件箱失敗" });
  }
});

router.post("/coach/inbox", authenticateToken, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = req.body || {};
    const body = String(b.body || "").trim().slice(0, 2000);
    if (body.length < 2) return res.status(400).json({ success: false, error: "請輸入訊息內容" });
    const subject = String(b.subject || "").slice(0, 80);
    const toUser = b.to_user_id ? String(b.to_user_id) : null;

    const me = db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id);
    const id = "msg_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO coach_messages (id, coach_id, from_role, from_user_id, from_name, to_user_id, subject, body)
       VALUES (?,?, 'coach', ?,?,?,?,?)`,
    ).run(id, req.user.id, req.user.id, (me && me.name) || "教練", toUser, subject, body);

    // 通知收件人
    try {
      const { sendNotification } = require("../services/notification") || {};
      if (sendNotification && toUser) {
        sendNotification("message.received", {
          recipient: toUser,
          data: { from: (me && me.name) || "你的教練", subject: subject || "新訊息", body: body.slice(0, 120) },
        });
      }
    } catch (e) {}

    res.status(201).json({ success: true, id });
  } catch (e) {
    console.error("[INBOX] send:", e.message);
    res.status(500).json({ success: false, error: "發送失敗" });
  }
});

router.post("/coach/inbox/:id/read", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    db.prepare("UPDATE coach_messages SET read_at=datetime('now') WHERE id=? AND coach_id=?").run(
      req.params.id,
      req.user.id,
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

/* ---------- 平台 ---------- */
const canView = requirePermission("ops.booking.view");

router.get("/admin/coach-messages", authenticateToken, canView, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT m.*, u.name AS coach_name, u.email AS coach_email,
                (SELECT COUNT(*) FROM coach_messages x WHERE x.coach_id=m.coach_id AND x.from_role='coach' AND x.read_at IS NULL) AS coach_unread
           FROM coach_messages m JOIN users u ON u.id=m.coach_id
          WHERE m.from_role='coach' OR m.to_user_id IS NULL
          ORDER BY datetime(m.created_at) DESC LIMIT 100`,
      )
      .all();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, messages: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/admin/coach-messages/:id/reply", authenticateToken, canView, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const src = db.prepare("SELECT * FROM coach_messages WHERE id=?").get(req.params.id);
    if (!src) return res.status(404).json({ success: false, error: "訊息不存在" });
    const body = String((req.body || {}).body || "").trim().slice(0, 2000);
    if (body.length < 2) return res.status(400).json({ success: false, error: "請輸入回覆內容" });

    const me = db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id);
    const id = "msg_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO coach_messages (id, coach_id, from_role, from_user_id, from_name, to_user_id, subject, body)
       VALUES (?,?, 'admin', ?,?,NULL,?,?)`,
    ).run(id, src.coach_id, req.user.id, (me && me.name) || "平台", src.subject ? `Re: ${src.subject}` : null, body);

    db.prepare("UPDATE coach_messages SET read_at=datetime('now') WHERE id=? AND read_at IS NULL").run(src.id);
    try {
      const { sendNotification } = require("../services/notification") || {};
      if (sendNotification) {
        sendNotification("message.received", {
          recipient: src.coach_id,
          data: { from: "平台客服", subject: "回覆", body: body.slice(0, 120) },
        });
      }
    } catch (e) {}

    res.status(201).json({ success: true, id });
  } catch (e) {
    console.error("[INBOX] reply:", e.message);
    res.status(500).json({ success: false, error: "回覆失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
