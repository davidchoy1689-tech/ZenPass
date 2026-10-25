/**
 * ZenPass — 教練資質（牌照／急救證書）登記與審核
 * 2026-10-25
 * POST /api/coach/credentials            教練提交／更新（需教練身份）
 * GET  /api/coach/credentials            自己嘅資質
 * GET  /api/admin/coach-credentials      管理員列表（?status=pending|verified|rejected|all）
 * POST /api/admin/coach-credentials/:id/verify  審核（approve/reject）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function ensureTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS coach_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    license_type TEXT,
    license_no TEXT,
    license_expiry TEXT,
    first_aid_type TEXT,
    first_aid_expiry TEXT,
    doc_url TEXT,
    certificate_url TEXT,
    insurance_policy_url TEXT,
    insurance_expiry_date TEXT,
    is_starred INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    reviewer_id TEXT,
    review_note TEXT,
    reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id)
  )`).run();
  try {
    const cols = db.prepare("PRAGMA table_info(coach_credentials)").all().map((c) => c.name);
    [["certificate_url", "TEXT"], ["insurance_policy_url", "TEXT"], ["insurance_expiry_date", "TEXT"], ["is_starred", "INTEGER DEFAULT 0"]].forEach(([n, t]) => {
      if (!cols.includes(n)) db.prepare(`ALTER TABLE coach_credentials ADD COLUMN ${n} ${t}`).run();
    });
  } catch (e) {}
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// ===== 教練提交 =====
router.post("/coach/credentials", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const me = req.user;
    if (!me.is_coach && !["coach", "super_admin", "platform_manager", "admin"].includes(me.role)) {
      return res.status(403).json({ success: false, error: "只限教練提交資質" });
    }
    const b = req.body || {};
    const licenseType = String(b.license_type || "").slice(0, 60);
    const licenseNo = String(b.license_no || "").slice(0, 60);
    const licenseExpiry = String(b.license_expiry || "").slice(0, 10);
    const firstAidType = String(b.first_aid_type || "").slice(0, 60);
    const firstAidExpiry = String(b.first_aid_expiry || "").slice(0, 10);
    const docUrl = String(b.doc_url || "").slice(0, 300);
    const certUrl = String(b.certificate_url || "").slice(0, 300);
    const insUrl = String(b.insurance_policy_url || "").slice(0, 300);
    const insExpiry = String(b.insurance_expiry_date || "").slice(0, 10);

    if (!licenseType) return res.status(400).json({ success: false, error: "請填寫教練牌照／認證名稱" });
    if (licenseExpiry && !isDate(licenseExpiry)) return res.status(400).json({ success: false, error: "牌照到期日格式要 YYYY-MM-DD" });
    if (firstAidExpiry && !isDate(firstAidExpiry)) return res.status(400).json({ success: false, error: "急救證書到期日格式要 YYYY-MM-DD" });

    const existing = db.prepare("SELECT id FROM coach_credentials WHERE user_id = ?").get(me.id);
    if (existing) {
      db.prepare(
        `UPDATE coach_credentials SET license_type=?, license_no=?, license_expiry=?, first_aid_type=?, first_aid_expiry=?, doc_url=?,
          certificate_url=?, insurance_policy_url=?, insurance_expiry_date=?,
          status='pending', review_note=NULL, reviewer_id=NULL, reviewed_at=NULL, updated_at=datetime('now') WHERE user_id=?`,
      ).run(licenseType, licenseNo || null, licenseExpiry || null, firstAidType || null, firstAidExpiry || null, docUrl || null,
          certUrl || null, insUrl || null, insExpiry || null, me.id);
    } else {
      db.prepare(
        `INSERT INTO coach_credentials (id, user_id, license_type, license_no, license_expiry, first_aid_type, first_aid_expiry, doc_url,
          certificate_url, insurance_policy_url, insurance_expiry_date, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
      ).run(crypto.randomUUID(), me.id, licenseType, licenseNo || null, licenseExpiry || null, firstAidType || null, firstAidExpiry || null, docUrl || null,
        certUrl || null, insUrl || null, insExpiry || null);
    }
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "coach_credential_submit", entityId: me.id, data: { licenseType, licenseExpiry, firstAidType, firstAidExpiry } });
    } catch (e) {}
    res.json({ success: true, message: "✅ 已提交，待平台核實" });
  } catch (err) {
    console.error("coach credentials submit error:", err.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

// ===== 教練查自己 =====
router.get("/coach/credentials", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const row = db.prepare("SELECT * FROM coach_credentials WHERE user_id = ?").get(req.user.id);
    res.json({ success: true, credentials: row || null });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

// ===== 管理員列表 =====
router.get("/admin/coach-credentials", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const status = String(req.query.status || "pending");
    const sql = `SELECT cc.*, u.name, u.email, u.phone FROM coach_credentials cc
                 JOIN users u ON u.id = cc.user_id
                 ${status === "all" ? "" : "WHERE cc.status = ?"}
                 ORDER BY cc.updated_at DESC LIMIT 200`;
    const rows = status === "all" ? db.prepare(sql).all() : db.prepare(sql).all(status);
    const now = new Date().toISOString().slice(0, 10);
    rows.forEach((r) => {
      r.expired = (r.license_expiry && r.license_expiry < now) || (r.first_aid_expiry && r.first_aid_expiry < now);
    });
    res.json({ success: true, status, credentials: rows });
  } catch (err) {
    console.error("admin coach credentials error:", err.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

// ===== 管理員審核 =====
router.post("/admin/coach-credentials/:id/verify", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const decision = String((req.body || {}).decision || "approve").toLowerCase();
    const note = String((req.body || {}).note || "").slice(0, 200);
    const status = decision === "reject" ? "rejected" : "verified";
    const star = (req.body || {}).star === true ? 1 : 0;
    const r = db.prepare(
      `UPDATE coach_credentials SET status=?, is_starred=?, reviewer_id=?, review_note=?, reviewed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    ).run(status, star, req.user.id, note || null, req.params.id);
    if (!r.changes) return res.status(404).json({ success: false, error: "記錄不存在" });
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "coach_credential_review", entityId: req.params.id, data: { status, note, by: req.user.id } });
    } catch (e) {}
    res.json({ success: true, message: status === "verified" ? "✅ 已核實" : "已拒絕", status });
  } catch (err) {
    console.error("verify credential error:", err.message);
    res.status(500).json({ success: false, error: "審核失敗" });
  }
});

// ===== 公開：教練星級狀態（前台顯示徽章用）=====
router.get("/coach-public/:userId", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const row = db.prepare("SELECT status, is_starred, license_type, license_expiry, first_aid_type FROM coach_credentials WHERE user_id = ?").get(req.params.userId);
    const now = new Date().toISOString().slice(0, 10);
    const expired = !!(row && row.license_expiry && row.license_expiry < now);
    res.json({
      success: true,
      verified: !!(row && row.status === "verified" && !expired),
      starred: !!(row && row.is_starred === 1 && row.status === "verified" && !expired),
      first_aid: !!(row && row.first_aid_type),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

module.exports = router;
