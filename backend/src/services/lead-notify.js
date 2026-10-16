// @ts-check
/**
 * ZenPass — 加盟申請通知（Lead Notification）
 *
 * 每收到新嘅教練／場地加盟申請，即刻通知負責人：
 *  1) WhatsApp（CallMeBot，免費）— 用 WHATSAPP_CALLMEBOT_KEY / WHATSAPP_CALLMEBOT_TO
 *  2) Telegram — 用 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
 *  3) Email（SMTP）— 用 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS + ADMIN_EMAIL
 *  4) Webhook（選填）— LEAD_WEBHOOK_URL，可指向 Google Apps Script（寫入 Google Sheet）／Formspree／Zapier
 *
 * 任何一個管道未配置都唔會出錯，只會 log；申請本身一定照樣入 DB。
 */

const {
  sendTelegramAlert,
  emailNotification,
  whatsappFreeNotification,
} = require("./notification");

// ===== 設定讀取（DB platform_settings 優先，其次 env）=====
function getSetting(key, fallback) {
  try {
    const { getDb } = require("./database");
    const row = getDb().prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
    return (row && row.value) || fallback;
  } catch {
    return fallback;
  }
}

function config() {
  const webhook = getSetting("lead.webhook_url", process.env.LEAD_WEBHOOK_URL || "");
  const adminMail = getSetting("lead.admin_email", process.env.ADMIN_EMAIL || "");
  return {
    webhook,
    adminMail,
    whatsapp: !!(process.env.WHATSAPP_CALLMEBOT_KEY && process.env.WHATSAPP_CALLMEBOT_TO),
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    email: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  };
}

function khTime() {
  try {
    return new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
  } catch {
    return new Date().toISOString();
  }
}

function buildText(kind, d, ref) {
  const L = [];
  L.push(`🆕 ZenPass 新${kind}加盟申請`);
  if (ref) L.push(`編號：${ref}`);
  L.push(`名稱：${d.name || "—"}`);
  L.push(`電話：${d.phone || "—"}`);
  L.push(`電郵：${d.email || "—"}`);
  if (kind === "教練") {
    const sp = Array.isArray(d.specialties) ? d.specialties.join("、") : d.specialties;
    if (sp) L.push(`專長：${sp}`);
    if (d.years_experience) L.push(`年資：${d.years_experience} 年`);
    if (d.certificates) L.push(`證書：${d.certificates}`);
  }
  if (kind === "場地") {
    if (d.category) L.push(`類別：${d.category}`);
    if (d.district) L.push(`地區：${d.district}`);
  }
  if (d.venue_address || d.address) L.push(`地址：${d.venue_address || d.address}`);
  if (d.venue_name) L.push(`場地：${d.venue_name}`);
  if (d.bio || d.description) L.push(`備註：${d.bio || d.description}`);
  if (d.website) L.push(`連結：${d.website}`);
  L.push(`時間：${khTime()}`);
  return L.join("\n");
}

async function postWebhook(payload, url) {
  url = url || process.env.LEAD_WEBHOOK_URL;
  if (!url) return false;
  try {
    const fetchImpl = typeof fetch === "function" ? fetch : require("node-fetch");
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return !!(res && (res.ok || res.status === 0));
  } catch (err) {
    console.error("lead webhook error:", err.message);
    return false;
  }
}

/**
 * @param {"教練"|"場地"} kind
 * @param {Record<string, any>} data
 * @param {string} [ref]
 */
async function notifyNewApplication(kind, data = {}, ref = "") {
  const text = buildText(kind, data, ref);
  const cfg = config();
  const sent = { whatsapp: false, telegram: false, email: false, webhook: false };

  if (cfg.whatsapp) {
    try {
      sent.whatsapp = await whatsappFreeNotification(text);
    } catch (err) {
      console.error("lead whatsapp error:", err.message);
    }
  }

  if (cfg.telegram) {
    try {
      await sendTelegramAlert(text);
      sent.telegram = true;
    } catch (err) {
      console.error("lead telegram error:", err.message);
    }
  }

  if (cfg.email && cfg.adminMail) {
    try {
      await emailNotification(
        cfg.adminMail,
        `【ZenPass】新${kind}加盟申請 — ${data.name || ""}`.trim(),
        `<pre style="font:inherit;white-space:pre-wrap;font-size:14px">${text}</pre>`,
      );
      sent.email = true;
    } catch (err) {
      console.error("lead email error:", err.message);
    }
  }

  sent.webhook = await postWebhook(
    {
      type: "partner_application",
      kind,
      reference: ref || null,
      submitted_at: new Date().toISOString(),
      ...data,
    },
    cfg.webhook,
  );

  const out = { configured: cfg, sent };
  console.log("📣 lead notify:", kind, JSON.stringify(out));
  return out;
}

module.exports = { notifyNewApplication, buildText, config };
