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

// 2026-11-14：管理員測試繞道（預設關閉；由 env 指定角色）
// 只影響「購買 Pass／家庭錢包」閘門，唔會放寬其他權限；每次使用寫審計。
function bypassRoles() {
  return String(process.env.PHONE_GATE_BYPASS_ROLES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function check(userId) {
  const db = getDb();
  ensureSchema(db);
  const u = db.prepare("SELECT id, phone, phone_verified_at, email, role FROM users WHERE id=?").get(userId);
  if (!u) return { ok: false, code: "USER_NOT_FOUND", error: "找不到帳戶" };
  const phone = String(u.phone || "").replace(/\D/g, "").replace(/^852/, "");

  // 管理員繞道：role 在清單內 → 直接放行（仍記錄審計，可追溯）
  const roles = bypassRoles();
  if (roles.includes(String(u.role || ""))) {
    try {
      const { audit } = require("./audit");
      audit({
        actionType: "phone_gate.bypass",
        entityType: "user",
        entityId: u.id,
        userId: u.id,
        newValues: { role: u.role, phone_present: !!phone },
        description: `手機閘門繞道（role=${u.role}）`,
      });
    } catch (e) {
      console.error("[PHONE-GATE] audit failed:", e.message);
    }
    return { ok: true, phone: phone || null, phone_verified: !!u.phone_verified_at, bypass: true, role: u.role };
  }

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
