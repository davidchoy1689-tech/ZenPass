/**
 * ZenPass — 監護人同意書（兒童／青少年參加者）
 * 2026-10-25
 * POST /api/guardians/consent        提交同意書（憑預約編號）
 * GET  /api/guardians/consent/:ref   查詢同意書狀態
 * GET  /api/guardians/list?month=    管理員查閱（需登入管理員）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function ensureTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS guardian_consents (
    id TEXT PRIMARY KEY,
    booking_id TEXT,
    booking_reference TEXT,
    user_id TEXT,
    minor_name TEXT NOT NULL,
    minor_age INTEGER,
    guardian_name TEXT NOT NULL,
    guardian_phone TEXT,
    relationship TEXT,
    consent_version TEXT DEFAULT 'v1-2026-10',
    agreed INTEGER DEFAULT 1,
    signature_text TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(booking_reference, minor_name)
  )`).run();
}

router.post("/consent", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const b = req.body || {};
    const ref = String(b.booking_reference || "").trim().toUpperCase();
    const minorName = String(b.minor_name || "").trim().slice(0, 40);
    const minorAge = Number(b.minor_age);
    const guardianName = String(b.guardian_name || "").trim().slice(0, 40);
    const guardianPhone = String(b.guardian_phone || "").replace(/\D/g, "").slice(-8);
    const relationship = String(b.relationship || "").slice(0, 20);
    const agreed = b.agreed === true || b.agreed === 1 || b.agreed === "true";

    if (!ref) return res.status(400).json({ success: false, error: "缺少預約編號" });
    if (!minorName) return res.status(400).json({ success: false, error: "請填參加者姓名" });
    if (!(minorAge >= 1 && minorAge <= 17)) return res.status(400).json({ success: false, error: "年齡需為 1–17 歲（18 歲或以上毋須此同意書）" });
    if (!guardianName) return res.status(400).json({ success: false, error: "請填監護人姓名" });
    if (!agreed) return res.status(400).json({ success: false, error: "請勾選同意條款" });

    const bk = db.prepare("SELECT id, user_id, booking_reference FROM bookings WHERE booking_reference = ?").get(ref);
    if (!bk) return res.status(404).json({ success: false, error: "預約編號無效" });

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO guardian_consents (id, booking_id, booking_reference, user_id, minor_name, minor_age, guardian_name, guardian_phone, relationship, agreed, signature_text, ip, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(booking_reference, minor_name) DO UPDATE SET
         minor_age=excluded.minor_age, guardian_name=excluded.guardian_name,
         guardian_phone=excluded.guardian_phone, relationship=excluded.relationship,
         agreed=excluded.agreed, signature_text=excluded.signature_text, ip=excluded.ip, user_agent=excluded.user_agent`,
    ).run(
      id, bk.id, ref, bk.user_id, minorName, minorAge, guardianName, guardianPhone || null,
      relationship || null, agreed ? 1 : 0, String(b.signature_text || guardianName).slice(0, 40),
      String(req.ip || ""), String(req.headers["user-agent"] || "").slice(0, 200),
    );

    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "guardian_consent", entityId: ref, data: { ref, minorName, minorAge, guardianName, relationship } });
    } catch (e) {}

    res.json({ success: true, message: `✅ 已記錄 ${minorName} 的監護人同意書` });
  } catch (err) {
    console.error("guardian consent error:", err.message);
    res.status(500).json({ success: false, error: "提交失敗，請稍後再試" });
  }
});

router.get("/consent/:ref", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const rows = db.prepare("SELECT minor_name, minor_age, guardian_name, relationship, created_at FROM guardian_consents WHERE booking_reference = ?").all(String(req.params.ref).toUpperCase());
    res.json({ success: true, count: rows.length, consents: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.get("/list", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const rows = db.prepare("SELECT * FROM guardian_consents ORDER BY created_at DESC LIMIT 200").all();
    res.json({ success: true, consents: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

module.exports = router;
