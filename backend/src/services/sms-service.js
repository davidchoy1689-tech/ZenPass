/**
 * sms-service.js — Twilio SMS 通道（工單十四）
 *
 * 用 Node 內建 fetch 直接打 Twilio Messages API，唔加新 dependency。
 *  - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER（或 TWILIO_SMS_FROM）
 *  - 香港號碼 → +852XXXXXXXX
 *  - 429 / 5xx → 交出可重試訊號；其他錯誤 → 502，並寫 audit_log('sms.failed')
 *
 * 鐵律：唔可以喺 log 印出完整電話或驗證碼。
 */
const { audit } = require("./audit");

function cfg() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID || "",
    token: process.env.TWILIO_AUTH_TOKEN || "",
    from: process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_SMS_FROM || "",
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.sid && c.token && c.from);
}

function normalizePhone(v) {
  let p = String(v || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

function messageFor(code) {
  return `【ZenPass】您的登入驗證碼為 ${code}，10分鐘內有效。如非本人操作請忽略。`;
}

function maskPhone(p) {
  const s = String(p || "");
  return s.length >= 4 ? s.slice(0, 2) + "****" + s.slice(-2) : "****";
}

/**
 * @returns {Promise<{ok:boolean,status:number,channel?:string,error?:string,retryable?:boolean,fatal?:boolean}>}
 */
async function sendOtpSms(phone, code, { fetchImpl = global.fetch } = {}) {
  return sendSms(phone, messageFor(code), { fetchImpl, logMask: true });
}

/** 通用短訊（保安警報／復原連結）；同一 Twilio 通道 */
async function sendSms(phone, bodyText, { fetchImpl = global.fetch } = {}) {
  const c = cfg();
  if (!isConfigured()) {
    return { ok: false, status: 503, error: "SMS_NOT_CONFIGURED", fatal: true };
  }
  const p = normalizePhone(phone);
  if (!/^[4-9]\d{7}$/.test(p)) {
    return { ok: false, status: 400, error: "INVALID_PHONE", fatal: true };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.sid)}/Messages.json`;
  const auth = "Basic " + Buffer.from(`${c.sid}:${c.token}`).toString("base64");
  const body = new URLSearchParams({
    To: `+852${p}`,
    From: c.from,
    Body: String(bodyText || "").slice(0, 1000),
  });

  let res, data = {};
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    try { data = await res.json(); } catch (e) { data = {}; }
  } catch (e) {
    logFailure(p, 0, "NETWORK", e.message);
    return { ok: false, status: 502, error: "SMS_NETWORK", retryable: true };
  }

  if (res.ok) {
    console.log(`[SMS] 已發送至 ${maskPhone(p)}（sid ${String(data.sid || "").slice(0, 10)}…）`);
    return { ok: true, status: 200, channel: "sms", sid: data.sid || null };
  }

  const twErr = data && (data.message || (data.error && data.error.message) || "");
  const twCode = data && (data.code || (data.error && data.error.code) || null);
  logFailure(p, res.status, twCode || "", String(twErr).slice(0, 200));

  if (res.status === 429 || res.status >= 500) {
    return { ok: false, status: 502, error: "SMS_TEMPORARY", retryable: true };
  }
  return { ok: false, status: 502, error: "SMS_REJECTED", fatal: true, twilio_code: twCode };
}

function logFailure(phone, httpStatus, twCode, reason) {
  try {
    console.error(`[SMS] 發送失敗 ${maskPhone(phone)} status=${httpStatus} code=${twCode} ${reason}`);
    audit({
      actionType: "sms.failed",
      entityType: "auth_otp",
      entityId: `sms:${maskPhone(phone)}`,
      userId: null,
      newValues: { phone_masked: maskPhone(phone), http_status: httpStatus, twilio_code: twCode, reason },
      description: "OTP 短訊發送失敗",
    });
  } catch (e) {
    // audit 失敗唔可以影響發送流程
  }
}

module.exports = { isConfigured, sendOtpSms, sendSms, messageFor, normalizePhone, maskPhone };
