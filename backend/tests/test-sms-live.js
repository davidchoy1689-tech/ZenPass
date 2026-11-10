#!/usr/bin/env node
/**
 * test-sms-live.js — 工單十四 Twilio SMS 通道
 * 全部用 mock fetch，零真實短訊成本。
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-sms-" + Date.now() + ".db");
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;
delete process.env.TWILIO_SMS_FROM;
delete process.env.OTP_TEST_PHONES;

const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase();
updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const otp = require("../src/services/otp-service");
const sms = require("../src/services/sms-service");

const realFetch = global.fetch;
let calls = [];
function mockFetch(handler) {
  calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
}
const twilioOk = () => ({ ok: true, status: 201, json: async () => ({ sid: "SM1234567890abcdef" }) });

(async () => {
  console.log("🧪 1. 未配置 → 503（唔會亂發）");
  process.env.NODE_ENV = "production";
  mockFetch(() => { throw new Error("should not call"); });
  const r0 = await otp.sendOtp({ phone: "91230000", ip: "9.9.9.1" });
  ok(r0.status === 503 && r0.body.code === "OTP_CHANNEL_UNAVAILABLE", "未配置回 503", r0.body);
  ok(calls.length === 0, "冇發出任何 HTTP 請求");

  console.log("🧪 2. 白名單測試號碼：零成本");
  process.env.OTP_TEST_PHONES = "98765432,61234567";
  mockFetch(() => { throw new Error("should not call"); });
  const w = await otp.sendOtp({ phone: "98765432", ip: "9.9.9.2" });
  ok(w.status === 200 && w.body.dev_code === "123456" && w.body.channel === "log", "白名單回固定碼", w.body);
  ok(calls.length === 0, "白名單唔會 call Twilio");
  ok(sms.isConfigured() === false, "未設憑證 → isConfigured false");

  console.log("🧪 3. 真實發送（mock 200）");
  process.env.TWILIO_ACCOUNT_SID = "ACtest000000000000000000000000001";
  process.env.TWILIO_AUTH_TOKEN = "token-test";
  process.env.TWILIO_FROM_NUMBER = "ZenPass";
  ok(sms.isConfigured() === true, "憑證齊全 → isConfigured true");
  mockFetch(twilioOk);
  const r1 = await otp.sendOtp({ phone: "91230001", ip: "9.9.9.3" });
  ok(r1.status === 200 && r1.body.channel === "sms" && !r1.body.dev_code, "真實號碼 → sms、不回傳驗證碼", r1.body);
  ok(calls.length === 1, "只 call 一次 Twilio");
  const c1 = calls[0];
  ok(/api\.twilio\.com\/2010-04-01\/Accounts\/ACtest/.test(c1.url), "打正確 Messages API");
  ok(/^Basic /.test(c1.opts.headers.Authorization), "用 Basic Auth");
  const params = new URLSearchParams(c1.opts.body);
  ok(params.get("To") === "+85291230001", "To 加 +852", params.get("To"));
  ok(params.get("From") === "ZenPass", "From = ZenPass（Alphanumeric）");
  const body = params.get("Body") || "";
  ok(/^【ZenPass】您的登入驗證碼為 \d{6}，10分鐘內有效。如非本人操作請忽略。$/.test(body), "簡訊範本符合規格", body);
  const row = db.prepare("SELECT otp_code FROM auth_otps WHERE phone='91230001'").get();
  ok(body.includes(row.otp_code), "簡訊內容同 DB 驗證碼一致");

  console.log("🧪 4. Twilio 429 → 502 可重試");
  mockFetch(() => ({ ok: false, status: 429, json: async () => ({ code: 20429, message: "Too Many Requests" }) }));
  const r2 = await otp.sendOtp({ phone: "91230002", ip: "9.9.9.4" });
  ok(r2.status === 502 && r2.body.code === "SMS_TEMPORARY", "429 → 502 SMS_TEMPORARY", r2.body);
  ok(!db.prepare("SELECT 1 FROM auth_otps WHERE phone='91230002'").get(), "失敗唔會留低孤兒 OTP");

  console.log("🧪 5. Twilio 拒絕（餘額／號碼）→ 502 + audit");
  mockFetch(() => ({ ok: false, status: 400, json: async () => ({ code: 21608, message: "The number is unverified" }) }));
  const r3 = await otp.sendOtp({ phone: "91230003", ip: "9.9.9.5" });
  ok(r3.status === 502 && r3.body.code === "SMS_REJECTED", "4xx → 502 SMS_REJECTED", r3.body);
  const a = db.prepare("SELECT * FROM audit_log WHERE action_type='sms.failed' ORDER BY rowid DESC LIMIT 1").get();
  ok(!!a, "寫入 audit_log sms.failed");
  ok(a && /91\*\*\*\*03/.test(a.new_values || ""), "audit 只存遮罩電話", a && a.new_values);

  console.log("🧪 6. 網絡錯誤 → 502");
  mockFetch(() => { throw new Error("ECONNRESET"); });
  const r4 = await otp.sendOtp({ phone: "91230004", ip: "9.9.9.6" });
  ok(r4.status === 502 && r4.body.code === "SMS_TEMPORARY", "網絡錯誤 → 502", r4.body);

  console.log("🧪 7. 冷卻與頻率（真實通道都要守）");
  process.env.OTP_TEST_PHONES = "";
  mockFetch(twilioOk);
  await otp.sendOtp({ phone: "91230005", ip: "9.9.9.7" });
  const r5 = await otp.sendOtp({ phone: "91230005", ip: "9.9.9.7" });
  ok(r5.status === 429 && r5.body.retry_after > 0, "60 秒內重發 → 429", r5.body);
  ok(calls.length === 1, "冷卻期唔會再 call Twilio");

  console.log("🧪 8. 舊欄位兼容（TWILIO_SMS_FROM）");
  delete process.env.TWILIO_FROM_NUMBER;
  process.env.TWILIO_SMS_FROM = "+85230000000";
  ok(sms.isConfigured() === true, "TWILIO_SMS_FROM 亦可");

  global.fetch = realFetch;
  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { global.fetch = realFetch; console.error("💥", e); process.exit(1); });
