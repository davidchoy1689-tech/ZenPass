/**
 * 教練免登入點名 Token（HMAC-SHA256，短時效、單班次 scope）
 *
 * token = base64url(`${schedule_id}.${coach_id}.${expires_at}`) + "." + base64url(hmac)
 * - expires_at：Unix 秒（一般 = 課堂結束 + 3 小時）
 * - 只可以存取該 schedule_id 嘅名冊／點名
 */
const crypto = require("crypto");

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function secret() {
  const s = process.env.CHECKIN_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("CHECKIN_TOKEN_SECRET / JWT_SECRET 未設定");
  return s;
}

function sign({ scheduleId, coachId, expiresAt }) {
  if (!scheduleId || !coachId) throw new Error("scheduleId / coachId 必填");
  const exp = Math.floor(Number(expiresAt));
  if (!Number.isFinite(exp)) throw new Error("expiresAt 無效");
  const payload = `${scheduleId}.${coachId}.${exp}`;
  const sig = b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
  return `${b64url(payload)}.${sig}`;
}

function verify(token, { now = Date.now() } = {}) {
  if (!token || typeof token !== "string" || !token.includes(".")) return { ok: false, code: "TOKEN_MALFORMED" };
  const [body, sig] = token.split(".");
  let payload;
  try { payload = fromB64url(body).toString("utf8"); } catch (e) { return { ok: false, code: "TOKEN_MALFORMED" }; }
  const expected = b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: "TOKEN_BAD_SIGNATURE" };

  const [scheduleId, coachId, expStr] = payload.split(".");
  const exp = Number(expStr);
  if (!scheduleId || !coachId || !Number.isFinite(exp)) return { ok: false, code: "TOKEN_MALFORMED" };
  if (Math.floor(now / 1000) > exp) return { ok: false, code: "TOKEN_EXPIRED" };
  return { ok: true, scheduleId, coachId, expiresAt: exp };
}

module.exports = { sign, verify, _b64url: b64url };
