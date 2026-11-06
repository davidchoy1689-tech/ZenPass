/**
 * 免登入只讀分享簽章（無狀態 HMAC-SHA256）
 * 2026-11-06
 *
 * 目的：子女（會員）把入場憑證傳給長者／家人，對方無需登入即可只讀查看。
 * 設計：不改 DB schema；簽名綁定 booking id + 電話 + 班次 + 建立時間。
 * raw  = `${id}:${phone}:${schedule_id}:${created_at}`
 * sig  = HMAC-SHA256(raw, secret).hex.slice(0, 16)
 */
const crypto = require("crypto");

function secret() {
  return process.env.SHARE_TOKEN_SECRET || process.env.JWT_SECRET || "";
}

function phoneOf(b) {
  return String((b && (b.parent_phone || b.phone || b.user_phone)) || "").replace(/\D/g, "").replace(/^852/, "");
}

function rawOf(b) {
  return [b && b.id, phoneOf(b), b && b.schedule_id, b && b.created_at].join(":");
}

function make(b) {
  const s = secret();
  if (!s) throw new Error("SHARE_TOKEN_SECRET / JWT_SECRET 未設定");
  return crypto.createHmac("sha256", s).update(rawOf(b)).digest("hex").slice(0, 16);
}

function verify(b, sig) {
  const given = String(sig || "").trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(given)) return false;
  let expected;
  try { expected = make(b); } catch (e) { return false; }
  const a = Buffer.from(given);
  const bb = Buffer.from(expected);
  if (a.length !== bb.length) return false;
  return crypto.timingSafeEqual(a, bb);
}

function maskedPhone(p) {
  const s = String(p || "").replace(/\D/g, "").replace(/^852/, "");
  if (s.length !== 8) return "";
  return s.slice(0, 4) + "****";
}

module.exports = { make, verify, rawOf, phoneOf, maskedPhone };
