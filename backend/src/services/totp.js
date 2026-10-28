/**
 * ZenPass 禪流 — TOTP（RFC 6238）雙因素認證
 * 2026-10-28
 *
 * 純 Node crypto 實作，零外部依賴（唔使 otplib／speakeasy）：
 *  - Base32 secret 產生／編解碼（RFC 4648，無 padding）
 *  - HOTP / TOTP 6 位碼，HMAC-SHA1，30 秒步長，容許 ±1 步時鐘偏差
 *  - 備援碼（backup codes）：一次性、只存 SHA-256 雜湊
 *  - secret 以 AES-256-GCM 加密後才落庫（金鑰由 JWT_SECRET 派生 + 獨立 salt）
 */

const crypto = require("crypto");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;
const DIGITS = 6;
const WINDOW = 1; // ±1 step

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

function nowStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP);
}

function totp(secret, nowMs = Date.now()) {
  return hotp(base32Decode(secret), nowStep(nowMs));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 驗證 6 位碼（容許 ±1 步，即約 ±30 秒時鐘偏差）
 * @returns {number|null} 命中嘅 time step（用嚟防重放），失敗回 null
 */
function verifyTotpStep(secret, code, nowMs = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const secretBuf = base32Decode(secret);
  if (!secretBuf.length) return null;
  const step = nowStep(nowMs);
  for (let i = -WINDOW; i <= WINDOW; i++) {
    if (safeEqual(hotp(secretBuf, step + i), c)) return step + i;
  }
  return null;
}

function verifyTotp(secret, code, nowMs = Date.now()) {
  return verifyTotpStep(secret, code, nowMs) !== null;
}

/** otpauth:// URI，供 Google Authenticator / 1Password / Apple 密碼掃描 */
function otpauthUri(secret, label, issuer = "ZenPass") {
  const l = encodeURIComponent(`${issuer}:${label}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP),
  });
  return `otpauth://totp/${l}?${params.toString()}`;
}

// ===== 備援碼 =====
function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 chars
    codes.push(raw.slice(0, 5) + "-" + raw.slice(5));
  }
  return codes;
}

function hashBackupCode(code) {
  return crypto.createHash("sha256").update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

function verifyBackupCode(code, hashes) {
  const h = hashBackupCode(code);
  const list = Array.isArray(hashes) ? hashes : [];
  const idx = list.findIndex((x) => safeEqual(x, h));
  return idx;
}

// ===== Secret 加密（AES-256-GCM）=====
function encKey() {
  const base = process.env.TOTP_ENC_KEY || process.env.JWT_SECRET || "zenpass-totp-fallback";
  return crypto.createHash("sha256").update("zenpass-totp-v1|" + base).digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

function decryptSecret(stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ct = Buffer.from(parts[3], "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch (e) {
    return null;
  }
}

module.exports = {
  base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp, verifyTotpStep,
  otpauthUri, generateBackupCodes, hashBackupCode, verifyBackupCode,
  encryptSecret, decryptSecret, STEP, DIGITS, WINDOW,
};
