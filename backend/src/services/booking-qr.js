/**
 * 入場簽到 QR：zenpass:checkin:{booking_id}:{tag}
 * tag = base64url(HMAC-SHA256(booking_id, secret)).slice(0,10)
 * 只防偽／防手改，唔含個資；實際權限仍由教練 token 控制。
 */
const crypto = require("crypto");

function secret() {
  const s = process.env.CHECKIN_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("CHECKIN_TOKEN_SECRET / JWT_SECRET 未設定");
  return s;
}
const tagFor = (bookingId) =>
  crypto.createHmac("sha256", secret()).update(String(bookingId)).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 10);

const make = (bookingId) => `zenpass:checkin:${bookingId}:${tagFor(bookingId)}`;

function verify(qr) {
  const m = /^zenpass:checkin:([0-9a-zA-Z-]{4,64}):([A-Za-z0-9_-]{10})$/.exec(String(qr || "").trim());
  if (!m) return { ok: false, code: "QR_MALFORMED" };
  const [, bookingId, tag] = m;
  const expected = tagFor(bookingId);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: "QR_BAD_SIGNATURE" };
  return { ok: true, bookingId };
}

module.exports = { make, verify, tagFor };
