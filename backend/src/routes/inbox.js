/**
 * 全角色收件箱（2026-11-16）
 * 學生／教練／機構／場地／平台職員共用一套訊息中心。
 *
 *  GET  /api/inbox                     我的訊息（收＋發）＋未讀數
 *  POST /api/inbox                     發送（to_user_id 留空 = 發去平台）
 *  POST /api/inbox/:id/read            標記已讀
 *
 *  GET  /api/admin/inbox               平台收件（to_user_id IS NULL）
 *  POST /api/admin/inbox/:id/reply     平台回覆
 *
 *  舊路徑 /api/coach/inbox* 保留為 alias（向後兼容）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");

const router = express.Router();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT,
      from_role TEXT,
      from_name TEXT,
      to_user_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_im_to ON inbox_messages(to_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_im_from ON inbox_messages(from_user_id, created_at);
  `);
}

const safeName = (v) => String(v || "").trim().slice(0, 60);

router.get("/inbox", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT * FROM inbox_messages
          WHERE from_user_id=? OR to_user_id=?
          ORDER BY datetime(created_at) DESC LIMIT 300`,
      )
      .all(req.user.id, req.user.id);
    const unread = rows.filter((r) => String(r.to_user_id) === String(req.user.id) && !r.read_at).length;
    res.set("Cache-Control", "no-store");
    res.json({ success: true, messages: rows, unread });
  } catch (e) {
    console.error("[INBOX] list:", e.message);
    res.status(500).json({ success: false, error: "讀取收件箱失敗" });
  }
});

router.post("/inbox", authenticateToken, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = req.body || {};
    const body = String(b.body || "").trim().slice(0, 2000);
    if (body.length < 2) return res.status(400).json({ success: false, error: "請輸入訊息內容" });
    const subject = String(b.subject || "").slice(0, 80);
    const toUser = b.to_user_id ? String(b.to_user_id) : null;

    const me = db.prepare("SELECT id, name, role FROM users WHERE id=?").get(req.user.id);
    if (!me) return res.status(404).json({ success: false, error: "用戶不存在" });
    if (toUser && toUser === me.id) return res.status(400).json({ success: false, error: "唔可以發俾自己" });

    const id = "msg_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO inbox_messages (id, from_user_id, from_role, from_name, to_user_id, subject, body)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, me.id, me.role || "user", safeName(me.name) || "用戶", toUser, subject, body);

    try {
      const { sendNotification } = require("../services/notification");
      const data = { from: safeName(me.name) || "用戶", subject: subject || "新訊息", body: body.slice(0, 120) };
      if (toUser) sendNotification("message.received", { recipient: toUser, data });
      else {
        const admins = db.prepare("SELECT id FROM users WHERE role IN ('admin','super_admin','platform_manager','platform_staff')").all();
        for (const a of admins) {
          try { sendNotification("message.received", { recipient: a.id, data }); } catch (e) {}
        }
      }
    } catch (e) {}

    res.status(201).json({ success: true, id });
  } catch (e) {
    console.error("[INBOX] send:", e.message);
    res.status(500).json({ success: false, error: "發送失敗" });
  }
});

router.post("/inbox/:id/read", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    db.prepare("UPDATE inbox_messages SET read_at=datetime('now') WHERE id=? AND to_user_id=?").run(
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

router.get("/admin/inbox", authenticateToken, canView, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT * FROM inbox_messages WHERE to_user_id IS NULL ORDER BY datetime(created_at) DESC LIMIT 200`,
      )
      .all();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, messages: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/admin/inbox/:id/reply", authenticateToken, canView, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const src = db.prepare("SELECT * FROM inbox_messages WHERE id=?").get(req.params.id);
    if (!src) return res.status(404).json({ success: false, error: "訊息不存在" });
    const body = String((req.body || {}).body || "").trim().slice(0, 2000);
    if (body.length < 2) return res.status(400).json({ success: false, error: "請輸入回覆內容" });

    const me = db.prepare("SELECT id, name FROM users WHERE id=?").get(req.user.id);
    const id = "msg_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO inbox_messages (id, from_user_id, from_role, from_name, to_user_id, subject, body)
       VALUES (?,?, 'admin', ?,?,?,?)`,
    ).run(id, me.id, safeName(me.name) || "平台", src.from_user_id, src.subject ? `Re: ${src.subject}` : null, body);
    db.prepare("UPDATE inbox_messages SET read_at=datetime('now') WHERE id=? AND read_at IS NULL").run(src.id);

    try {
      const { sendNotification } = require("../services/notification");
      sendNotification("message.received", {
        recipient: src.from_user_id,
        data: { from: "平台客服", subject: "回覆", body: body.slice(0, 120) },
      });
    } catch (e) {}

    res.status(201).json({ success: true, id });
  } catch (e) {
    console.error("[INBOX] reply:", e.message);
    res.status(500).json({ success: false, error: "回覆失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
