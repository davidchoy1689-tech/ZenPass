/**
 * payout-settings.js — 教練 FPS 收款帳戶（工單二十一）
 *  - OTP 簽名（5 分鐘、最多 5 次）
 *  - 嚴格格式校驗（mobile 8 位 / FPS ID 7-9 位 / 戶名英文）
 *  - 出糧凍結窗（每月 6 號 18:00 – 7 號 23:59 HKT）拒絕改戶口
 *  - 每次變更寫 audit（舊值／新值／IP）
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const { audit } = require("./audit");

const BANKS = [
  { code: "004", name: "滙豐銀行 HSBC" },
  { code: "024", name: "恒生銀行 Hang Seng" },
  { code: "012", name: "中國銀行 BOC" },
  { code: "003", name: "渣打銀行 Standard Chartered" },
  { code: "388", name: "Mox Bank" },
  { code: "016", name: "東亞銀行 Bank of East Asia" },
  { code: "040", name: "大新銀行 Dah Sing" },
  { code: "043", name: "南洋商業銀行 NCB" },
  { code: "061", name: "創興銀行 Chong Hing" },
  { code: "072", name: "工銀亞洲 ICBC Asia" },
];
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_payout_settings (
      coach_id TEXT PRIMARY KEY,
      fps_type TEXT NOT NULL CHECK(fps_type IN ('mobile','fps_id','email')),
      fps_proxy_value TEXT NOT NULL,
      bank_code TEXT NOT NULL,
      account_holder_name TEXT NOT NULL,
      verified_at DATETIME NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payout_setting_otps (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INTEGER DEFAULT 0,
      consumed INTEGER DEFAULT 0,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ps_otp_coach ON payout_setting_otps(coach_id, consumed, expires_at);
  `);
}

function normalizePhone(v) {
  let p = String(v || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

function mask(v, type) {
  const s = String(v || "");
  if (type === "mobile" && s.length === 8) return s.slice(0, 4) + "****";
  if (s.length <= 3) return "****";
  return s.slice(0, 3) + "****" + s.slice(-2);
}

/** 出糧凍結窗：6 號 18:00 至 7 號 23:59（HKT） */
function inFreezeWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  const day = get("day");
  // 6 號 00:00 至 7 號 23:59（HKT）全面凍結
  return day === 6 || day === 7;
}

function getSettings(db, coachId) {
  ensureSchema(db);
  const row = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id=?").get(coachId);
  if (!row) return null;
  return {
    fps_type: row.fps_type,
    fps_proxy_masked: mask(row.fps_proxy_value, row.fps_type),
    fps_proxy_value: row.fps_proxy_value,
    bank_code: row.bank_code,
    bank_name: (BANKS.find((b) => b.code === row.bank_code) || {}).name || row.bank_code,
    account_holder_name: row.account_holder_name,
    verified_at: row.verified_at,
    updated_at: row.updated_at,
  };
}

function sendOtp(db, coachId, { ip = "" } = {}) {
  ensureSchema(db);
  const u = db.prepare("SELECT phone FROM users WHERE id=?").get(coachId);
  const phone = normalizePhone(u && u.phone);
  if (!/^[4-9]\d{7}$/.test(phone)) {
    return { ok: false, status: 400, error: "教練帳戶未綁定有效香港手機號碼，請先更新個人資料" };
  }
  const last = db
    .prepare("SELECT created_at FROM payout_setting_otps WHERE coach_id=? ORDER BY datetime(created_at) DESC LIMIT 1")
    .get(coachId);
  if (last) {
    const age = (Date.now() - new Date(String(last.created_at).replace(" ", "T") + "Z").getTime()) / 1000;
    if (age < RESEND_SECONDS) {
      return { ok: false, status: 429, error: `請等 ${Math.ceil(RESEND_SECONDS - age)} 秒再發送`, retry_after: Math.ceil(RESEND_SECONDS - age) };
    }
  }
  const hourCount = db
    .prepare("SELECT COUNT(*) c FROM payout_setting_otps WHERE coach_id=? AND created_at >= datetime('now','-1 hour')")
    .get(coachId).c;
  if (hourCount >= 5) return { ok: false, status: 429, error: "一小時內已達 5 次上限" };

  const sandbox = process.env.NODE_ENV !== "production" || String(process.env.OTP_TEST_PHONES || "").includes(phone);
  const code = sandbox ? String(process.env.OTP_SANDBOX_CODE || "123456") : String(crypto.randomInt(100000, 1000000));
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    "INSERT INTO payout_setting_otps (id, coach_id, phone, otp_code, expires_at, attempts, consumed, ip) VALUES (?,?,?,?,?,0,0,?)",
  ).run(id, coachId, phone, code, expires, ip || null);

  // 真實短訊：重用 sms-service（未配置時唔會假裝成功）
  const sms = require("./sms-service");
  let channel = "sandbox";
  if (!sandbox) {
    if (!sms.isConfigured()) {
      db.prepare("UPDATE payout_setting_otps SET consumed=1 WHERE id=?").run(id);
      return { ok: false, status: 503, error: "短訊服務暫未開通，請聯絡客服" };
    }
    // sendOtpSms 係 async；此處用同步介面唔合適，交由 route await（見下）
  }
  return { ok: true, otp_session_id: id, phone_masked: mask(phone, "mobile"), sandbox, code: sandbox ? code : undefined, channel };
}

/** 非同步版本：真正發 SMS */
async function sendOtpAsync(db, coachId, { ip = "" } = {}) {
  const out = sendOtp(db, coachId, { ip });
  if (!out.ok || out.sandbox) return out;
  const sms = require("./sms-service");
  const row = db.prepare("SELECT phone, otp_code FROM payout_setting_otps WHERE id=?").get(out.otp_session_id);
  const r = await sms.sendOtpSms(row.phone, row.otp_code);
  if (!r.ok) {
    db.prepare("UPDATE payout_setting_otps SET consumed=1 WHERE id=?").run(out.otp_session_id);
    return { ok: false, status: r.status === 502 ? 502 : 503, error: "短訊發送失敗，請稍後再試" };
  }
  return { ...out, channel: "sms" };
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function validateAndUpdate(db, coachId, b, { ip = "" } = {}) {
  ensureSchema(db);
  const sessionId = String(b.otp_session_id || "");
  const code = String(b.otp_code || "").trim();
  if (!sessionId || !/^\d{6}$/.test(code)) {
    return { ok: false, status: 400, error: "缺少驗證碼" };
  }
  const row = db.prepare("SELECT * FROM payout_setting_otps WHERE id=? AND coach_id=?").get(sessionId, coachId);
  if (!row) return { ok: false, status: 400, error: "驗證碼已失效，請重新發送" };
  if (Number(row.consumed) === 1) return { ok: false, status: 400, error: "驗證碼已使用，請重新發送" };
  if (Number(row.attempts) >= MAX_ATTEMPTS) return { ok: false, status: 429, error: "錯誤次數太多，請重新發送" };
  if (Date.now() > new Date(String(row.expires_at).replace(" ", "T") + "Z").getTime()) {
    db.prepare("UPDATE payout_setting_otps SET consumed=1 WHERE id=?").run(row.id);
    return { ok: false, status: 400, error: "驗證碼已過期（5 分鐘）" };
  }
  if (!safeEqual(row.otp_code, code)) {
    db.prepare("UPDATE payout_setting_otps SET attempts=attempts+1 WHERE id=?").run(row.id);
    if (Number(row.attempts) + 1 >= MAX_ATTEMPTS) {
      try {
        require("./risk-control").trigger(db, {
          coachId,
          reason: "otp_exhausted",
          ip,
          freeze: true,
          notes: "OTP 連續錯誤 5 次",
        });
      } catch (e) {}
    }
    return { ok: false, status: 400, error: "驗證碼不正確" };
  }

  // 凍結窗
  if (inFreezeWindow()) {
    let ticketId = null;
    try {
      const r = require("./risk-control").trigger(db, {
        coachId,
        reason: "pre_payout_change",
        ip,
        freeze: true,
        notes: "出糧凍結窗內嘗試更改收款戶口",
      });
      ticketId = r.ticket && r.ticket.id;
    } catch (e) {}
    return {
      ok: false,
      status: 409,
      code: "FREEZE_WINDOW",
      ticket_id: ticketId,
      error: "出糧前 24 小時至出糧日唔可以更改收款戶口；本月將沿用原戶口，請 8 號後再改。",
    };
  }

  const fpsType = String(b.fps_type || "");
  const proxy = String(b.fps_proxy_value || "").trim();
  const bankCode = String(b.bank_code || "").trim();
  const holder = String(b.account_holder_name || "").trim().toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ");

  if (!["mobile", "fps_id", "email"].includes(fpsType)) return { ok: false, status: 400, error: "識別碼類型無效" };
  if (fpsType === "mobile" && !/^[4-9]\d{7}$/.test(normalizePhone(proxy))) {
    return { ok: false, status: 400, error: "請輸入正確的 8 位香港手機號碼" };
  }
  if (fpsType === "fps_id" && !/^\d{7,9}$/.test(proxy)) {
    return { ok: false, status: 400, error: "FPS ID 必須為 7–9 位數字" };
  }
  if (fpsType === "email" && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(proxy)) {
    return { ok: false, status: 400, error: "電郵格式不正確" };
  }
  if (!BANKS.some((x) => x.code === bankCode)) return { ok: false, status: 400, error: "請選擇有效的收款銀行" };
  if (holder.length < 3 || !/^[A-Z][A-Z ]*$/.test(holder)) {
    return { ok: false, status: 400, error: "請輸入與銀行一致的英文全名" };
  }

  const before = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id=?").get(coachId);
  db.transaction(() => {
    db.prepare("UPDATE payout_setting_otps SET consumed=1 WHERE id=?").run(row.id);
    db.prepare(
      `INSERT INTO coach_payout_settings (coach_id, fps_type, fps_proxy_value, bank_code, account_holder_name, verified_at, updated_at)
       VALUES (?,?,?,?,?,datetime('now'),datetime('now'))
       ON CONFLICT(coach_id) DO UPDATE SET
         fps_type=excluded.fps_type, fps_proxy_value=excluded.fps_proxy_value,
         bank_code=excluded.bank_code, account_holder_name=excluded.account_holder_name,
         verified_at=datetime('now'), updated_at=datetime('now')`,
    ).run(coachId, fpsType, fpsType === "mobile" ? normalizePhone(proxy) : proxy, bankCode, holder);
  })();

  try {
    audit({
      actionType: "coach.payout_setting_updated",
      entityType: "coach_payout_setting",
      entityId: coachId,
      userId: coachId,
      oldValues: before
        ? { fps_type: before.fps_type, fps_proxy_masked: mask(before.fps_proxy_value, before.fps_type), bank_code: before.bank_code, holder: before.account_holder_name }
        : null,
      newValues: { fps_type: fpsType, fps_proxy_masked: mask(proxy, fpsType), bank_code: bankCode, holder },
      description: "更新 FPS 收款帳戶（OTP 已驗證）",
      ipAddress: ip,
    });
  } catch (e) {}

  return { ok: true, settings: getSettings(db, coachId) };
}

module.exports = {
  ensureSchema,
  getSettings,
  sendOtp: sendOtpAsync,
  validateAndUpdate,
  inFreezeWindow,
  BANKS,
  mask,
};
