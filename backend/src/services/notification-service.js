/**
 * notification-service.js — 多渠道通知門面
 *  sendSmsAndWhatsApp({ phone, message, userId?, title?, meta? })
 *
 *  - WhatsApp Cloud API 未配置 → status 'not_configured'
 *  - SMS（Twilio）未配置 → status 'not_configured'
 *  - 站內通知（dbNotification）永遠寫入，作為審計與教練後台備援
 *
 * 回傳 { sms, whatsapp, in_app } 方便後台顯示 delivery 狀態。
 */
const { getDb } = require("./database");
const { dbNotification } = require("./notification");

function whatsappConfigured() {
  try {
    return require("./whatsapp-cloud").isConfigured();
  } catch (e) {
    return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }
}

async function sendWhatsApp(phone, body, { fetchImpl = global.fetch } = {}) {
  if (!whatsappConfigured()) return { ok: false, status: "not_configured" };
  const to = String(phone || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(to)) return { ok: false, status: "bad_phone" };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `852${to}`, type: "text", text: { body: String(body).slice(0, 4000) } }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: "error", error: e.message };
  }
}

async function sendSmsAndWhatsApp({ phone, message, userId = null, title = "", meta = null }) {
  const out = { sms: "not_configured", whatsapp: "not_configured", in_app: false };
  if (userId) {
    try {
      dbNotification(userId, "schedule", title || "ZenPass 通知", message, meta || {});
      out.in_app = true;
    } catch (e) {}
  }
  const sms = require("./sms-service");
  if (sms.isConfigured()) {
    try {
      const r = await sms.sendSms(phone, message);
      out.sms = r.ok ? "sent" : "failed";
    } catch (e) {
      out.sms = "failed";
    }
  }
  const wa = await sendWhatsApp(phone, message);
  out.whatsapp = wa.ok ? "sent" : wa.status;
  return out;
}

module.exports = { sendSmsAndWhatsApp, sendWhatsApp, whatsappConfigured };
