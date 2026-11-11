/**
 * WhatsApp Cloud API（Meta Graph）客戶端
 * ─ 只用 Node 內建 fetch，唔加新 dependency
 * ─ 429／5xx／網絡錯誤會 exponential backoff 重試
 * ─ 失敗寫入 WHATSAPP_ERROR_LOG（預設 /var/log/zenpass/whatsapp-error.log）
 */
const fs = require("fs");
const path = require("path");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
const TOKEN = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || "";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
const ERROR_LOG = process.env.WHATSAPP_ERROR_LOG || "/var/log/zenpass/whatsapp-error.log";

const isConfigured = () => Boolean(TOKEN && PHONE_ID);

function logError(entry) {
  try {
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    fs.appendFileSync(ERROR_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch (e) {
    // 唔可以因為寫 log 失敗而 throw
  }
}

function normalizePhone(raw) {
  let p = String(raw || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 發送請求，具備 retry（只重試 429/5xx/網絡）
 * @returns {Promise<{ok:boolean,status:number,data:any}>}
 */
async function postMessage(payload, { fetchImpl = global.fetch, retries = 3, baseDelayMs = 500 } = {}) {
  if (!isConfigured()) return { ok: false, status: 503, data: { error: "WHATSAPP_NOT_CONFIGURED" } };
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, status: res.status, data };
      last = { ok: false, status: res.status, data };
      if (res.status !== 429 && res.status < 500) break; // 4xx 重試冇用
    } catch (err) {
      last = { ok: false, status: 0, data: { error: err.message } };
    }
    if (attempt < retries) {
      const retryAfter = last && last.data && last.data.error && Number(last.data.error.retry_after);
      await sleep(retryAfter ? retryAfter * 1000 : baseDelayMs * Math.pow(2, attempt));
    }
  }
  logError({ to: payload.to, type: payload.type, status: last && last.status, data: last && last.data });
  return last || { ok: false, status: 0, data: { error: "UNKNOWN" } };
}

async function sendTextMessage(to, body, opts = {}) {
  const phone = normalizePhone(to);
  return postMessage(
    { messaging_product: "whatsapp", recipient_type: "individual", to: `852${phone}`, type: "text", text: { preview_url: true, body } },
    opts,
  );
}

async function sendTemplateMessage(to, templateName, { language = "zh_HK", components = [], ...opts } = {}) {
  const phone = normalizePhone(to);
  return postMessage(
    {
      messaging_product: "whatsapp",
      to: `852${phone}`,
      type: "template",
      template: { name: templateName, language: { code: language }, components },
    },
    opts,
  );
}

async function sendInteractiveButtons(to, bodyText, buttons, opts = {}) {
  const phone = normalizePhone(to);
  return postMessage(
    {
      messaging_product: "whatsapp",
      to: `852${phone}`,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((b, i) => ({
            type: "reply",
            reply: { id: String(b.id || `btn_${i}`), title: String(b.title || "").slice(0, 20) },
          })),
        },
      },
    },
    opts,
  );
}

// ===== Phase 4.5：Meta 預先核准模板（Template Messages）=====
// 業務主動發起（T-24h / T-2h / 流標退款）必須用模板，否則 Meta 會拒收。
const TPL = {
  t24: process.env.WA_TPL_T24 || "zenpass_class_t24_reminder",
  t2: process.env.WA_TPL_T2 || "zenpass_class_t2_pass_token",
  quorum: process.env.WA_TPL_QUORUM || "zenpass_quorum_auto_refund",
};

/** 清洗香港電話至 E.164（852xxxxxxxx）；無法識別回 null */
function sanitizeHongKongPhone(phone) {
  const p = normalizePhone(phone);
  return /^[4-9]\d{7}$/.test(p) ? "852" + p : null;
}

function bodyComponents(params) {
  const list = (params || []).map((t) => ({ type: "text", text: String(t == null ? "" : t) }));
  return list.length ? [{ type: "body", parameters: list }] : [];
}

/** 通用模板發送 */
async function sendTemplate(toPhone, templateName, params, opts = {}) {
  return sendTemplateMessage(toPhone, templateName, {
    language: opts.language || "zh_HK",
    components: bodyComponents(params),
    ...opts,
  });
}

/** T-24h 課堂提醒：{{1}} 學員 {{2}} 時間 {{3}} 課程 {{4}} 場地 */
async function sendTMinus24hReminder({ phone, studentName, startTimeStr, courseTitle, venueName }, opts = {}) {
  return sendTemplate(phone, TPL.t24, [studentName || "學員", startTimeStr, courseTitle, venueName], opts);
}

/** T-2h 通行證：{{1}} 課程 {{2}} 連結 {{3}} 電話後 4 位 */
async function sendTMinus2hPassLink({ phone, courseTitle, passUrl, last4Digits }, opts = {}) {
  return sendTemplate(phone, TPL.t2, [courseTitle, passUrl, last4Digits], opts);
}

/** 流標退款：{{1}} 課程 {{2}} 原開課時間 {{3}} 返還堂數 */
async function sendQuorumRefundAlert({ phone, courseTitle, startTimeStr, refundedUnits = 1 }, opts = {}) {
  return sendTemplate(phone, TPL.quorum, [courseTitle, startTimeStr, String(refundedUnits)], opts);
}

/** Meta Webhook 簽名：X-Hub-Signature-256 = sha256=<hmac(appSecret, rawBody)> */
function verifySignature(rawBody, signatureHeader, appSecret = APP_SECRET) {
  const crypto = require("crypto");
  if (!appSecret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(String(signatureHeader));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  normalizePhone,
  sanitizeHongKongPhone,
  sendTemplate,
  sendTMinus24hReminder,
  sendTMinus2hPassLink,
  sendQuorumRefundAlert,
  templates: TPL,
  postMessage,
  sendTextMessage,
  sendTemplateMessage,
  sendInteractiveButtons,
  verifySignature,
  config: { API_VERSION, VERIFY_TOKEN, APP_SECRET, PHONE_ID },
};
