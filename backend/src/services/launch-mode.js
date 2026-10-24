/**
 * ZenPass — 上線開關（Launch mode）
 * 2026-10-24
 *
 * 目的：網站未正式上架期間，暫停「公開註冊」，避免陌生人開帳號／預約測試課程。
 *  - registration_open = 0（預設）：只准 allow_domains 內嘅電郵，或持有邀請碼
 *  - registration_open = 1：全面開放
 * 設定存喺 platform_settings，主要管理員可喺後台一鍵開關。
 */
const crypto = require("crypto");
const { getDb } = require("./database");

const DEFAULTS = {
  "launch.registration_open": "0",
  "launch.allow_domains": "zenpass.hk,zenpass.test",
  "launch.notice": "系統測試中，暫停公開註冊。如有興趣，請 WhatsApp 或電郵 support@zenpass.hk。",
};

function ensure() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  for (const [k, v] of Object.entries(DEFAULTS)) {
    db.prepare(
      "INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    ).run(k, v);
  }
  const code = db.prepare("SELECT value FROM platform_settings WHERE key='launch.invite_code'").get();
  if (!code) {
    db.prepare("INSERT INTO platform_settings (key, value, description) VALUES (?,?,?)").run(
      "launch.invite_code",
      "ZP-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      "測試期邀請碼（註冊時可 bypass 暫停）",
    );
  }
}

function get(key) {
  try {
    ensure();
    const row = getDb().prepare("SELECT value FROM platform_settings WHERE key=?").get(key);
    return row ? row.value : DEFAULTS[key];
  } catch (e) {
    return DEFAULTS[key];
  }
}

function set(key, value) {
  ensure();
  getDb()
    .prepare(
      "INSERT INTO platform_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, String(value));
}

function getLaunchSettings() {
  const domains = String(get("launch.allow_domains") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    registration_open: String(get("launch.registration_open")) === "1",
    allow_domains: domains,
    invite_code: get("launch.invite_code"),
    notice: get("launch.notice"),
  };
}

/** 檢查某個電郵可否註冊 */
function canRegister(email, inviteCode) {
  const s = getLaunchSettings();
  if (s.registration_open) return { allowed: true };
  const e = String(email || "").trim().toLowerCase();
  const domain = e.split("@")[1] || "";
  if (s.allow_domains.includes(domain)) return { allowed: true, reason: "allowed_domain" };
  if (inviteCode && String(inviteCode).trim().toUpperCase() === String(s.invite_code).toUpperCase()) {
    return { allowed: true, reason: "invite" };
  }
  return { allowed: false, code: "REGISTRATION_CLOSED", notice: s.notice };
}

module.exports = { getLaunchSettings, canRegister, get, set };
