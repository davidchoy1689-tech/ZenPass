/**
 * ZenPass — 合作夥伴合規及免責承諾書（電子簽署）
 * 2026-10-25
 * GET  /api/agreements/partner          我嘅簽署狀態
 * POST /api/agreements/partner          簽署（signed_name 必填）
 * GET  /api/admin/agreements            管理員列表
 * 版本：v2026.1_partner
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const VERSION = "v2026.1_partner";

function ensureTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS partner_agreements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role_type TEXT,
    signed_name TEXT NOT NULL,
    agreed INTEGER DEFAULT 1,
    version TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, version)
  )`).run();
}

router.get("/agreements/partner", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const row = db.prepare("SELECT * FROM partner_agreements WHERE user_id = ? AND version = ?").get(req.user.id, VERSION);
    res.json({ success: true, version: VERSION, signed: !!row, agreement: row || null });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/agreements/partner", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const signedName = String((req.body || {}).signed_name || "").trim().slice(0, 60);
    const roleType = String((req.body || {}).role_type || req.user.role || "").slice(0, 30);
    const agreed = (req.body || {}).agreed !== false;
    if (!signedName) return res.status(400).json({ success: false, error: "請輸入法定負責人全名" });
    if (!agreed) return res.status(400).json({ success: false, error: "請勾選同意條款" });

    db.prepare(
      `INSERT INTO partner_agreements (id, user_id, role_type, signed_name, agreed, version, ip, user_agent)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, version) DO UPDATE SET
         signed_name=excluded.signed_name, role_type=excluded.role_type, agreed=excluded.agreed,
         ip=excluded.ip, user_agent=excluded.user_agent, created_at=datetime('now')`,
    ).run(
      crypto.randomUUID(), req.user.id, roleType, signedName, 1, VERSION,
      String(req.ip || ""), String(req.headers["user-agent"] || "").slice(0, 200),
    );
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "partner_agreement", entityId: req.user.id, data: { version: VERSION, signedName, roleType } });
    } catch (e) {}
    res.json({ success: true, message: "✅ 已簽署，合作夥伴權限已開通", version: VERSION });
  } catch (err) {
    console.error("partner agreement error:", err.message);
    res.status(500).json({ success: false, error: "簽署失敗" });
  }
});

router.get("/admin/agreements", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const rows = db.prepare(
      `SELECT pa.*, u.name, u.email FROM partner_agreements pa
       LEFT JOIN users u ON u.id = pa.user_id ORDER BY pa.created_at DESC LIMIT 200`,
    ).all();
    res.json({ success: true, agreements: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

module.exports = router;
