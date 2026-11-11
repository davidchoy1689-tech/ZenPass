/**
 * 手機號碼閘門（Data Hygiene）
 *
 * 背景：生產有 12 個 users.phone 為 NULL（早期後台／OAuth 帳號）。
 * 政策（David 2026-11-11）：
 *  - 不強制 DB NOT NULL，不改歷史資料
 *  - 但凡購買 Pass、使用家庭錢包，必須有手機號碼
 *  - 生產環境要求號碼已透過 OTP 驗證（users.phone_verified_at）
 *  - 測試／開發環境只檢查有冇號碼，避免測試被 OTP 阻擋
 */
const { getDb } = require("./database");

function ensureSchema(db) {
  try { db.exec("ALTER TABLE users ADD COLUMN phone_verified_at TEXT"); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_users_phone_verified ON users(phone, phone_verified_at)"); } catch (e) {}
}

function check(userId) {
  const db = getDb();
  ensureSchema(db);
  const u = db.prepare("SELECT id, phone, phone_verified_at, email FROM users WHERE id=?").get(userId);
  if (!u) return { ok: false, code: "USER_NOT_FOUND", error: "找不到帳戶" };
  const phone = String(u.phone || "").replace(/\D/g, "").replace(/^852/, "");
  if (!/^[4-9]\d{7}$/.test(phone)) {
    return { ok: false, code: "PHONE_REQUIRED", error: "請先到「我的 → 個人資料」補填有效香港手機號碼，方可購買或使用家庭 Pass" };
  }
  const verified = !!u.phone_verified_at;
  const enforce = process.env.NODE_ENV === "production" && process.env.PHONE_VERIFY_ENFORCE !== "0";
  if (enforce && !verified) {
    return { ok: false, code: "PHONE_VERIFICATION_REQUIRED", error: "請先驗證手機號碼（一次 OTP），方可購買或使用家庭 Pass", phone_verified: false };
  }
  return { ok: true, phone, phone_verified: verified };
}

function requirePhoneGate(req, res, next) {
  const r = check(req.user && req.user.id);
  if (!r.ok) {
    return res.status(r.code === "USER_NOT_FOUND" ? 404 : 403).json({ success: false, code: r.code, error: r.error, phone_verified: r.phone_verified });
  }
  req.phoneGate = r;
  next();
}

function markVerified(userId) {
  const db = getDb();
  ensureSchema(db);
  db.prepare("UPDATE users SET phone_verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(userId);
}

module.exports = { ensureSchema, check, requirePhoneGate, markVerified };
