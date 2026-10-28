/**
 * ZenPass — 管理員 2FA 緊急重置（逃生通道）
 *
 * 用途：管理員手機遺失、Authenticator 未備份、備援碼又用完 → 喺 VPS 用 root 手動解鎖。
 * 安全性：只可以喺伺服器本機執行（要有 shell 權限），唔會開放任何 HTTP 入口。
 *
 * 用法（VPS）：
 *   cd /var/www/zenpass
 *   node scripts/reset-2fa.cjs admin@zenpass.hk
 */
const path = require("path");
const Database = require(path.join(__dirname, "../backend/node_modules/better-sqlite3"));
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../backend/data/zenpass.db");
const email = process.argv[2];

if (!email) {
  console.error("用法：node scripts/reset-2fa.cjs <email>");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

// 容錯：舊 DB 未跑 migration 時自動補欄位（idempotent）
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

const u = db.prepare("SELECT id, email, role, totp_enabled FROM users WHERE email = ?").get(email);
if (!u) {
  console.error("搵唔到帳戶：" + email);
  process.exit(1);
}

db.prepare(
  "UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL, totp_enrolled_at = NULL, totp_last_used_step = 0 WHERE id = ?",
).run(u.id);

try {
  db.prepare(
    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
     VALUES (?, 'security.totp_reset_cli', 'user', ?, 'cli', ?, '{}', ?, datetime('now'))`,
  ).run(
    crypto.randomUUID(), u.id,
    JSON.stringify({ totp_enabled: Number(u.totp_enabled) }),
    `CLI 緊急重置 2FA：${u.email}（${u.role}）`,
  );
} catch (e) {
  console.error("寫審計失敗（唔影響重置）：", e.message);
}

console.log(`✅ 已重置 ${u.email} 的 2FA（totp_enabled=0，secret 已清除）。請盡快重新綁定。`);
console.log("建議之後改密碼：管理員登入 → 個人資料 → 更改密碼。");
db.close();
