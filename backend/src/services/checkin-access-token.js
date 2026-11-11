/**
 * Phase 4.5 — 一次性入場憑證（防截圖重放）
 *
 * 舊做法：pass-token.html?bk=bk_xxx 係明文靜態 URL，任何人轉發即可重複核銷。
 * 新做法：token = 32 bytes 隨機 → SHA-256 入庫；有效期 2 小時（開課前後）；
 *        核銷成功即 is_used=1，再用同一 token 回 403 TOKEN_ALREADY_USED。
 *
 * 注意：資料庫只存 hash，raw token 只出現一次（發給該學員）。
 */
const crypto = require("crypto");

const DEFAULT_TTL_HOURS = 2;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkin_access_tokens (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_token_lookup ON checkin_access_tokens(token_hash, is_used, expires_at);
  `);
}

const hash = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

/**
 * 簽發一次性憑證
 * @returns {{token:string, expires_at:string, id:string}}
 */
function issue(db, bookingId, { ttlHours = DEFAULT_TTL_HOURS } = {}) {
  ensureSchema(db);
  const raw = crypto.randomBytes(32).toString("base64url");
  const id = "cat_" + crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + Number(ttlHours) * 3600000).toISOString();

  // 同一預約只保留一個有效未用憑證（避免無限增生）
  db.prepare("UPDATE checkin_access_tokens SET is_used = 1, used_at = datetime('now') WHERE booking_id = ? AND is_used = 0").run(bookingId);
  db.prepare(
    "INSERT INTO checkin_access_tokens (id, booking_id, token_hash, expires_at, is_used) VALUES (?,?,?,?,0)",
  ).run(id, bookingId, hash(raw), expiresAt);

  return { id, token: raw, expires_at: expiresAt, url: `/pass-token.html?t=${encodeURIComponent(raw)}` };
}

/**
 * 只驗證不消耗（核銷流程用：驗證 → 更新 booking → 成功後才 markUsed）
 * @returns {{ok:true, booking_id:string, id:string} | {ok:false, code:string}}
 */
function validate(db, rawToken) {
  ensureSchema(db);
  const t = String(rawToken || "").trim();
  if (!t) return { ok: false, code: "TOKEN_REQUIRED" };
  const row = db.prepare("SELECT * FROM checkin_access_tokens WHERE token_hash = ?").get(hash(t));
  if (!row) return { ok: false, code: "TOKEN_INVALID" };
  if (Number(row.is_used) === 1) return { ok: false, code: "TOKEN_ALREADY_USED" };
  const exp = new Date(String(row.expires_at).replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(String(row.expires_at)) ? "" : "Z"));
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) return { ok: false, code: "TOKEN_EXPIRED" };
  return { ok: true, booking_id: row.booking_id, id: row.id };
}

/** 核銷成功後標記已用（CAS：is_used=0 → 1） */
function markUsed(db, id) {
  const r = db
    .prepare("UPDATE checkin_access_tokens SET is_used = 1, used_at = datetime('now') WHERE id = ? AND is_used = 0")
    .run(id);
  return r.changes === 1;
}

/**
 * 驗證並即時消耗
 * @returns {{ok:true, booking_id:string} | {ok:false, code:string}}
 */
function consume(db, rawToken) {
  const v = validate(db, rawToken);
  if (!v.ok) return v;
  if (!markUsed(db, v.id)) return { ok: false, code: "TOKEN_ALREADY_USED" };
  return { ok: true, booking_id: v.booking_id };
}

/** 只查不改（後台排查用） */
function peek(db, rawToken) {
  ensureSchema(db);
  return db.prepare("SELECT * FROM checkin_access_tokens WHERE token_hash = ?").get(hash(rawToken)) || null;
}

module.exports = { ensureSchema, issue, validate, markUsed, consume, peek, DEFAULT_TTL_HOURS };
