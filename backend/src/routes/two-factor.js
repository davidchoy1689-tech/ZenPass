/**
 * ZenPass 禪流 — 管理員 TOTP 雙因素認證（2FA）路由
 * 2026-10-28
 *
 * 流程：
 *  1. POST /api/admin/2fa/generate  管理員登入後產生 secret + QR（未啟用）
 *  2. POST /api/admin/2fa/enable    輸入手機 6 位碼 → 正式啟用 + 發 8 組備援碼（只顯示一次）
 *  3. POST /api/admin/2fa/disable   用 6 位碼或備援碼關閉（逃生／換機）
 *  4. GET  /api/admin/2fa/status    查詢狀態
 *  5. POST /api/auth/verify-2fa     登入第二段：temp_token + 6 位碼 → 正式 session
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin, generateToken, setAuthCookie } = require("../middleware/auth");
const totp = require("../services/totp");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "";

const ADMIN_ROLES = ["super_admin", "platform_manager", "admin", "platform_staff"];
const TEMP_TTL = "5m";

function ensureTotpColumns(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  [
    ["totp_secret", "TEXT"],
    ["totp_enabled", "INTEGER DEFAULT 0"],
    ["totp_backup_codes", "TEXT"],
    ["totp_enrolled_at", "TEXT"],
    ["totp_last_used_step", "INTEGER DEFAULT 0"],
  ].forEach(([n, t]) => {
    if (!cols.includes(n)) db.prepare(`ALTER TABLE users ADD COLUMN ${n} ${t}`).run();
  });
}

function audit2fa(db, userId, action, detail) {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
       VALUES (?, ?, 'user', ?, ?, '{}', ?, datetime('now'))`,
    ).run(crypto.randomUUID(), action, userId, userId, detail);
  } catch (e) {}
}

// 驗證 2FA 嘗試次數限制（每個 temp token 最多 5 次）
const attempts = new Map();
function bumpAttempt(key) {
  const n = (attempts.get(key) || 0) + 1;
  attempts.set(key, n);
  if (attempts.size > 5000) attempts.clear();
  return n;
}

// ===== GET /api/admin/2fa/status =====
router.get("/admin/2fa/status", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    ensureTotpColumns(db);
    const u = db
      .prepare("SELECT totp_enabled, totp_backup_codes, totp_enrolled_at FROM users WHERE id = ?")
      .get(req.user.id);
    let left = 0;
    try { left = JSON.parse(u?.totp_backup_codes || "[]").length; } catch (e) { left = 0; }
    res.json({
      success: true,
      enabled: Number(u?.totp_enabled) === 1,
      backup_codes_left: left,
      enrolled_at: u?.totp_enrolled_at || null,
      recommended: ADMIN_ROLES.includes(req.user.role),
    });
  } catch (err) {
    console.error("[2FA] status error:", err.message);
    res.status(500).json({ success: false, error: "查詢失敗" });
  }
});

// ===== POST /api/admin/2fa/generate =====
router.post("/admin/2fa/generate", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    ensureTotpColumns(db);
    const u = db.prepare("SELECT id, email, name, totp_enabled FROM users WHERE id = ?").get(req.user.id);
    if (!u) return res.status(404).json({ success: false, error: "帳戶不存在" });
    if (Number(u.totp_enabled) === 1) {
      return res.status(409).json({ success: false, error: "2FA 已啟用；如要重新綁定，請先停用", code: "TOTP_ALREADY_ENABLED" });
    }
    const secret = totp.generateSecret();
    const uri = totp.otpauthUri(secret, u.email || u.name || u.id);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    // 暫存（未啟用）：totp_enabled 保持 0
    db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(totp.encryptSecret(secret), u.id);
    res.json({ success: true, secret, otpauth_uri: uri, qr_data_url: qr, issuer: "ZenPass" });
  } catch (err) {
    console.error("[2FA] generate error:", err.message);
    res.status(500).json({ success: false, error: "產生失敗" });
  }
});

// ===== POST /api/admin/2fa/enable =====
router.post("/admin/2fa/enable", authenticateToken, requireAdmin, (req, res) => {
  try {
    const code = String((req.body && req.body.code) || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, error: "請輸入 6 位驗證碼" });
    const db = getDb();
    ensureTotpColumns(db);
    const u = db.prepare("SELECT id, totp_secret, totp_enabled FROM users WHERE id = ?").get(req.user.id);
    if (!u || !u.totp_secret) {
      return res.status(400).json({ success: false, error: "請先產生 QR Code 並掃描", code: "TOTP_NOT_GENERATED" });
    }
    const secret = totp.decryptSecret(u.totp_secret);
    if (!secret) return res.status(400).json({ success: false, error: "Secret 已損壞，請重新產生" });
    const matchedStep = totp.verifyTotpStep(secret, code);
    if (matchedStep === null) {
      return res.status(401).json({ success: false, error: "驗證碼不正確或已過期", code: "TOTP_INVALID" });
    }
    const codes = totp.generateBackupCodes(8);
    const hashes = codes.map((c) => totp.hashBackupCode(c));
    db.prepare(
      "UPDATE users SET totp_enabled = 1, totp_backup_codes = ?, totp_enrolled_at = datetime('now'), totp_last_used_step = ? WHERE id = ?",
    ).run(JSON.stringify(hashes), matchedStep, u.id);
    audit2fa(db, u.id, "security.totp_enabled", "啟用 TOTP 雙因素認證");
    res.json({ success: true, enabled: true, backup_codes: codes, note: "備援碼只會顯示一次，請立即下載或抄低" });
  } catch (err) {
    console.error("[2FA] enable error:", err.message);
    res.status(500).json({ success: false, error: "啟用失敗" });
  }
});

// ===== POST /api/admin/2fa/disable =====
router.post("/admin/2fa/disable", authenticateToken, requireAdmin, (req, res) => {
  try {
    const code = String((req.body && req.body.code) || "").trim();
    const db = getDb();
    ensureTotpColumns(db);
    const u = db
      .prepare("SELECT id, totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id = ?")
      .get(req.user.id);
    if (!u || Number(u.totp_enabled) !== 1) {
      return res.status(400).json({ success: false, error: "2FA 未啟用" });
    }
    const secret = totp.decryptSecret(u.totp_secret);
    const okTotp = secret && totp.verifyTotp(secret, code);
    let okBackup = false;
    if (!okTotp && /^[A-Z0-9-]{8,14}$/i.test(code)) {
      let hashes = [];
      try { hashes = JSON.parse(u.totp_backup_codes || "[]"); } catch (e) {}
      okBackup = totp.verifyBackupCode(code, hashes) >= 0;
    }
    if (!okTotp && !okBackup) {
      return res.status(401).json({ success: false, error: "驗證碼或備援碼不正確", code: "TOTP_INVALID" });
    }
    db.prepare(
      "UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL, totp_enrolled_at = NULL WHERE id = ?",
    ).run(u.id);
    audit2fa(db, u.id, "security.totp_disabled", "停用 TOTP 雙因素認證");
    res.json({ success: true, enabled: false });
  } catch (err) {
    console.error("[2FA] disable error:", err.message);
    res.status(500).json({ success: false, error: "停用失敗" });
  }
});

// ===== POST /api/auth/verify-2fa =====
router.post("/auth/verify-2fa", (req, res) => {
  try {
    const { temp_token, code } = req.body || {};
    if (!temp_token || !code) {
      return res.status(400).json({ success: false, error: "缺少驗證資料" });
    }
    let payload;
    try {
      payload = jwt.verify(String(temp_token), JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, error: "驗證逾時，請重新登入", code: "TEMP_EXPIRED" });
    }
    if (payload.scope !== "2fa" || !payload.id) {
      return res.status(401).json({ success: false, error: "憑證無效", code: "TEMP_INVALID" });
    }
    const key = String(temp_token).slice(-16) + "|" + (req.ip || "");
    if (bumpAttempt(key) > 5) {
      return res.status(429).json({ success: false, error: "嘗試次數過多，請重新登入", code: "TOTP_TOO_MANY" });
    }
    const db = getDb();
    ensureTotpColumns(db);
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
    if (!u) return res.status(401).json({ success: false, error: "帳戶不存在" });
    if (u.is_active !== undefined && Number(u.is_active) === 0) {
      return res.status(403).json({ success: false, error: "此帳號已被停用", code: "ACCOUNT_DISABLED" });
    }
    if (Number(u.totp_enabled) !== 1) {
      return res.status(400).json({ success: false, error: "此帳戶未啟用 2FA，請直接用密碼登入" });
    }

    const secret = totp.decryptSecret(u.totp_secret);
    let usedBackup = false;
    let ok = false;
    let matchedStep = null;

    if (/^\d{6}$/.test(String(code).trim())) {
      matchedStep = secret ? totp.verifyTotpStep(secret, code) : null;
      ok = matchedStep !== null;
      // 防同一個 6 位碼重複使用（重放）
      if (ok && Number(u.totp_last_used_step) === matchedStep) {
        return res.status(409).json({ success: false, error: "此驗證碼已使用，請等下一組", code: "TOTP_REPLAY" });
      }
    } else {
      let hashes = [];
      try { hashes = JSON.parse(u.totp_backup_codes || "[]"); } catch (e) {}
      const idx = totp.verifyBackupCode(code, hashes);
      if (idx >= 0) {
        hashes.splice(idx, 1); // 一次性
        db.prepare("UPDATE users SET totp_backup_codes = ? WHERE id = ?").run(JSON.stringify(hashes), u.id);
        usedBackup = true;
        ok = true;
      }
    }
    if (!ok) {
      audit2fa(db, u.id, "security.totp_failed", "2FA 驗證失敗");
      return res.status(401).json({ success: false, error: "驗證碼不正確", code: "TOTP_INVALID" });
    }
    if (!usedBackup) {
      db.prepare("UPDATE users SET totp_last_used_step = ? WHERE id = ?").run(matchedStep, u.id);
    }

    const token = generateToken(u);
    const { password_hash, totp_secret, totp_backup_codes, ...userData } = u;
    setAuthCookie(res, token);
    audit2fa(db, u.id, "security.totp_login", usedBackup ? "以備援碼登入" : "以 TOTP 登入");
    res.json({ success: true, message: "登入成功", token, user: userData, used_backup_code: usedBackup });
  } catch (err) {
    console.error("[2FA] verify error:", err.message);
    res.status(500).json({ success: false, error: "驗證失敗" });
  }
});

module.exports = router;
module.exports.ensureTotpColumns = ensureTotpColumns;
