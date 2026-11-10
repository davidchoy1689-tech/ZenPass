/**
 * otp-service.js — 長者友善免密碼登入（工單十三）
 *
 * 鐵律：
 *  - 6 位數字、10 分鐘有效、最多 5 次錯誤
 *  - 同一電話 60 秒只可發一次；1 小時上限 5 次（另有 IP 上限）
 *  - 生產環境冇短訊通道就誠實回 503，唔會假裝已發送
 *  - 驗證成功先 consumed = 1；驗證碼只存 hash 之外的明文（短 TTL），
 *    讀取時只回傳「有冇有效碼」，唔會回傳 code
 */
const crypto = require("crypto");
const { getDb } = require("./database");

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;
const MAX_PER_IP_HOUR = 20;
const MAX_ATTEMPTS = 5;
const PHONE_RE = /^[4-9]\d{7}$/;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_otps (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INTEGER DEFAULT 0,
      consumed BOOLEAN DEFAULT 0,
      ip TEXT,
      channel TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_otps_phone_active ON auth_otps(phone, consumed, expires_at);
    CREATE INDEX IF NOT EXISTS idx_otps_created ON auth_otps(created_at);
  `);
}

function normalizePhone(v) {
  let p = String(v || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

function sandboxPhones() {
  return String(process.env.OTP_TEST_PHONES || "")
    .split(",")
    .map((x) => normalizePhone(x))
    .filter(Boolean);
}

/** 沙盒：非 production，或明示測試號碼 */
function isSandbox(phone) {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.OTP_SANDBOX === "1") return true;
  return sandboxPhones().includes(phone);
}

function genCode(phone) {
  if (isSandbox(phone)) return String(process.env.OTP_SANDBOX_CODE || "123456");
  return String(crypto.randomInt(100000, 1000000));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 發送 OTP
 * @returns {Promise<{status:number, body:object}>}
 */
async function sendOtp({ phone, ip = "" }) {
  const db = getDb();
  ensureSchema(db);
  const p = normalizePhone(phone);
  if (!PHONE_RE.test(p)) {
    return { status: 400, body: { success: false, error: "請輸入正確嘅 8 位香港電話號碼" } };
  }

  const last = db
    .prepare("SELECT created_at FROM auth_otps WHERE phone = ? ORDER BY datetime(created_at) DESC LIMIT 1")
    .get(p);
  if (last) {
    const age = (Date.now() - new Date(String(last.created_at).replace(" ", "T") + "Z").getTime()) / 1000;
    if (age < RESEND_SECONDS) {
      return {
        status: 429,
        body: {
          success: false,
          code: "OTP_TOO_SOON",
          retry_after: Math.ceil(RESEND_SECONDS - age),
          error: `請等 ${Math.ceil(RESEND_SECONDS - age)} 秒後再獲取驗證碼`,
        },
      };
    }
  }

  const hourCount = db
    .prepare("SELECT COUNT(*) c FROM auth_otps WHERE phone = ? AND created_at >= datetime('now','-1 hour')")
    .get(p).c;
  if (hourCount >= MAX_PER_HOUR) {
    return {
      status: 429,
      body: { success: false, code: "OTP_HOURLY_LIMIT", error: "此電話一小時內已達 5 次上限，請稍後再試" },
    };
  }
  if (ip) {
    const ipCount = db
      .prepare("SELECT COUNT(*) c FROM auth_otps WHERE ip = ? AND created_at >= datetime('now','-1 hour')")
      .get(ip).c;
    if (ipCount >= MAX_PER_IP_HOUR) {
      return {
        status: 429,
        body: { success: false, code: "OTP_IP_LIMIT", error: "嘗試太頻繁，請稍後再試" },
      };
    }
  }

  const code = genCode(p);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString().replace("T", " ").slice(0, 19);
  const sandbox = isSandbox(p);

  let channel = "log";
  if (!sandbox) {
    const delivered = await deliver(p, code);
    if (!delivered.ok) {
      console.error("[OTP] 無法發送短訊:", delivered.error);
      if (delivered.error === "SMS_REJECTED") {
        return {
          status: 502,
          body: {
            success: false,
            code: "SMS_REJECTED",
            error: "短訊通道暫時繁忙，請稍後再試",
          },
        };
      }
      if (delivered.status === 502 || delivered.retryable) {
        return {
          status: 502,
          body: {
            success: false,
            code: "SMS_TEMPORARY",
            error: "短訊通道暫時繁忙，請稍後再試",
          },
        };
      }
      if (!delivered.retryable && delivered.status === 400) {
        return {
          status: 400,
          body: { success: false, code: "SMS_REJECTED", error: "此電話號碼暫時收不到短訊，請確認號碼或聯絡客服" },
        };
      }
      return {
        status: 503,
        body: {
          success: false,
          code: "OTP_CHANNEL_UNAVAILABLE",
          error: "短訊服務暫未開通，請改用電郵密碼登入或 WhatsApp 聯絡客服",
        },
      };
    }
    channel = delivered.channel;
  }

  db.prepare(
    "INSERT INTO auth_otps (id, phone, otp_code, expires_at, attempts, consumed, ip, channel) VALUES (?,?,?,?,0,0,?,?)",
  ).run(id, p, code, expires, ip || null, channel);

  console.log(`[OTP] ${p} 驗證碼已產生（${channel}${sandbox ? " / sandbox" : ""}）`);
  if (sandbox) console.log(`[OTP] sandbox code: ${code}`);

  const body = {
    success: true,
    expires_in: Math.floor(OTP_TTL_MS / 1000),
    resend_in: RESEND_SECONDS,
    channel,
  };
  // 沙盒先回傳驗證碼，方便長者現場／測試；生產永遠唔會回傳
  if (sandbox) body.dev_code = code;
  return { status: 200, body };
}

/**
 * 真正發送（生產）
 *  - 優先 Twilio SMS（TWILIO_SMS_FROM）
 *  - 次選 WhatsApp Cloud（需已核准嘅驗證碼模板）
 *  - 都冇 → 失敗（唔會靜靜當成功）
 */
async function deliver(phone, code) {
  const text = `ZenPass 驗證碼：${code}（10 分鐘內有效）。請勿轉發俾任何人。`;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  // 1) 真實 SMS（Twilio Messages API，sms-service 已包錯誤分類 + audit）
  const sms = require("./sms-service");
  if (sms.isConfigured()) {
    const r = await sms.sendOtpSms(phone, code);
    if (r.ok) return { ok: true, channel: r.channel };
    return { ok: false, status: r.status || 502, error: r.error, retryable: r.retryable };
  }

  // 2) Twilio WhatsApp（需用戶先 join sandbox／或已核准模板；由 TWILIO_OTP_CHANNEL=whatsapp 開啟）
  const waFrom = process.env.TWILIO_WHATSAPP_FROM;
  if (sid && token && waFrom && process.env.TWILIO_OTP_CHANNEL === "whatsapp") {
    try {
      const client = require("twilio")(sid, token);
      await client.messages.create({
        from: `whatsapp:${waFrom}`,
        to: `whatsapp:+852${phone}`,
        body: text,
      });
      return { ok: true, channel: "whatsapp_twilio" };
    } catch (e) {
      console.error("[OTP] Twilio WhatsApp 失敗:", e.message);
    }
  }

  try {
    const wa = require("./whatsapp-cloud");
    if (wa.isConfigured && wa.isConfigured()) {
      const tpl = process.env.WHATSAPP_OTP_TEMPLATE || "";
      if (tpl) {
        const r = await wa.sendTemplateMessage(phone, tpl, {
          components: [{ type: "body", parameters: [{ type: "text", text: code }] }],
        });
        if (r && r.ok) return { ok: true, channel: "whatsapp" };
      }
      const r2 = await wa.sendTextMessage(phone, text);
      if (r2 && r2.ok) return { ok: true, channel: "whatsapp" };
    }
  } catch (e) {
    console.error("[OTP] WhatsApp 發送失敗:", e.message);
  }

  return { ok: false, status: 503, error: "NO_SMS_CHANNEL" };
}

/**
 * 驗證 OTP → 回傳 user（未建帳戶則建立）
 * @returns {{status:number, body:object, user?:object, token?:string}}
 */
async function verifyOtp({ phone, code, name = "", deviceId = "" }) {
  const db = getDb();
  ensureSchema(db);
  const p = normalizePhone(phone);
  if (!PHONE_RE.test(p)) {
    return { status: 400, body: { success: false, error: "請輸入正確嘅 8 位香港電話號碼" } };
  }
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) {
    return { status: 400, body: { success: false, error: "請輸入 6 位數字驗證碼" } };
  }

  const row = db
    .prepare("SELECT * FROM auth_otps WHERE phone = ? AND consumed = 0 ORDER BY datetime(created_at) DESC LIMIT 1")
    .get(p);
  if (!row) {
    return { status: 400, body: { success: false, code: "OTP_NOT_FOUND", error: "驗證碼已失效，請重新獲取" } };
  }
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    return { status: 429, body: { success: false, code: "OTP_LOCKED", error: "錯誤次數太多，請重新獲取驗證碼" } };
  }
  const exp = new Date(String(row.expires_at).replace(" ", "T") + "Z").getTime();
  if (Date.now() > exp) {
    db.prepare("UPDATE auth_otps SET consumed = 1 WHERE id = ?").run(row.id);
    return { status: 400, body: { success: false, code: "OTP_EXPIRED", error: "驗證碼已過期（10 分鐘），請重新獲取" } };
  }

  if (!safeEqual(row.otp_code, c)) {
    const attempts = Number(row.attempts) + 1;
    db.prepare("UPDATE auth_otps SET attempts = ? WHERE id = ?").run(attempts, row.id);
    const left = Math.max(0, MAX_ATTEMPTS - attempts);
    return {
      status: 400,
      body: {
        success: false,
        code: left ? "OTP_WRONG" : "OTP_LOCKED",
        attempts_left: left,
        error: left ? `驗證碼不正確，仲有 ${left} 次機會` : "錯誤次數太多，請重新獲取驗證碼",
      },
    };
  }

  const { generateToken } = require("../middleware/auth");

  let user;
  const tx = db.transaction(() => {
    db.prepare("UPDATE auth_otps SET consumed = 1 WHERE id = ? AND consumed = 0").run(row.id);
    user = db
      .prepare("SELECT * FROM users WHERE phone = ? OR phone = ? ORDER BY created_at LIMIT 1")
      .get(p, "852" + p);
    if (!user) {
      const uid = crypto.randomUUID();
      const display = String(name || "").trim().slice(0, 40) || `學員${p.slice(-4)}`;
      db.prepare(
        "INSERT INTO users (id, email, name, phone, role, created_at, updated_at) VALUES (?,?,?,?, 'user', datetime('now'), datetime('now'))",
      ).run(uid, `otp.${p}.${Date.now()}@guest.zenpass.hk`, display, p);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(uid);
    } else if (deviceId) {
      // 記錄裝置（防刷推薦用）
      try {
        require("./referral-rewards").touchDevice(db, user.id, deviceId);
      } catch (e) {}
    }
    return user;
  });
  tx();

  const token = generateToken(user, "30d");
  return {
    status: 200,
    body: {
      success: true,
      token,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      expires_in: 30 * 86400,
    },
    user,
    token,
  };
}

module.exports = {
  ensureSchema,
  normalizePhone,
  isSandbox,
  sendOtp,
  verifyOtp,
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  MAX_PER_HOUR,
};
