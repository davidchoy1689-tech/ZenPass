#!/usr/bin/env node
/** test-payout-settings.js — 工單二十一：FPS 收款戶口（OTP／凍結／審計） */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ps-" + Date.now() + ".db");
delete process.env.NODE_ENV;
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const svc = require("../src/services/payout-settings");
svc.ensureSchema(db);
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','蔡教練','98765432','coach')").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} } = {}) => new Promise((resolve) => {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; resolve(this); },
  };
  try { Promise.resolve(h({ body, user, params, query, headers: {}, ip: "1.2.3.4" }, res)).catch((e) => resolve({ statusCode: 500, body: { error: e.message } })); }
  catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/coach-earnings");
  const get = handlerOf(router, "get", "/payout-settings");
  const otp = handlerOf(router, "post", "/payout-settings/otp");
  const put = handlerOf(router, "put", "/payout-settings");
  const coach = { id: "c1", role: "coach" };

  console.log("🧪 1. 初始狀態");
  const g0 = await call(get, { user: coach });
  ok(g0.statusCode === 200 && g0.body.settings === null, "未設定 → null", g0.body);
  ok(g0.body.banks.length >= 5 && g0.body.banks.some((b) => b.code === "024"), "有銀行清單");
  ok(g0.body.freeze_window === false, "非出糧日 → 無凍結");

  console.log("🧪 2. OTP 發送");
  const o1 = await call(otp, { user: coach });
  ok(o1.statusCode === 200 && /^[0-9a-f-]{36}$/.test(o1.body.otp_session_id), "有 session id", o1.body);
  ok(o1.body.phone_masked === "9876****" && o1.body.dev_code === "123456", "遮罩電話＋沙盒碼");
  const o2 = await call(otp, { user: coach });
  ok(o2.statusCode === 429, "60 秒內重發 → 429");

  console.log("🧪 3. 驗證與更新");
  const badCode = await call(put, { user: coach, body: { otp_session_id: o1.body.otp_session_id, otp_code: "000000", fps_type: "mobile", fps_proxy_value: "98765432", bank_code: "024", account_holder_name: "CHAN TAI MAN" } });
  ok(badCode.statusCode === 400, "錯碼 → 400");
  const okPut = await call(put, { user: coach, body: { otp_session_id: o1.body.otp_session_id, otp_code: "123456", fps_type: "mobile", fps_proxy_value: "98765432", bank_code: "024", account_holder_name: " chan tai man " } });
  ok(okPut.statusCode === 200 && okPut.body.settings.account_holder_name === "CHAN TAI MAN", "更新成功＋戶名大寫", okPut.body);
  ok(okPut.body.settings.fps_proxy_masked === "9876****" && okPut.body.settings.bank_code === "024", "設定已遮罩");
  const s1 = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id='c1'").get();
  ok(s1 && s1.verified_at, "有 verified_at");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='coach.payout_setting_updated'").get(), "有審計");

  console.log("🧪 4. 格式校驗");
  db.prepare("UPDATE payout_setting_otps SET created_at=datetime('now','-2 minutes') WHERE coach_id='c1'").run();
  const o3 = await call(otp, { user: coach });
  const badId = await call(put, { user: coach, body: { otp_session_id: o3.body.otp_session_id, otp_code: "123456", fps_type: "fps_id", fps_proxy_value: "12", bank_code: "024", account_holder_name: "CHAN TAI MAN" } });
  ok(badId.statusCode === 400 && /7–9/.test(badId.body.error), "FPS ID 位數錯 → 400", badId.body);
  const badBank = await call(put, { user: coach, body: { otp_session_id: o3.body.otp_session_id, otp_code: "123456", fps_type: "mobile", fps_proxy_value: "98765432", bank_code: "999", account_holder_name: "CHAN TAI MAN" } });
  ok(badBank.statusCode === 400, "無效銀行 → 400");

  console.log("🧪 5. 出糧凍結窗");
  ok(svc.inFreezeWindow(new Date("2026-12-06T10:30:00Z")) === true, "6 號 18:30 HKT → 凍結");
  ok(svc.inFreezeWindow(new Date("2026-12-07T04:00:00Z")) === true, "7 號 → 凍結");
  ok(svc.inFreezeWindow(new Date("2026-12-08T04:00:00Z")) === false, "8 號 → 解凍");
  ok(svc.inFreezeWindow(new Date("2026-12-05T04:00:00Z")) === false, "5 號 → 正常");

  console.log("🧪 6. 出糧失敗通知");
  const disb = require("../src/services/payout-disbursements");
  const rec = disb.record(db, { coachId: "c1", month: "2026-11", grossCents: 10000, offsetCents: 0, netCents: 10000, proxyId: "98765432" });
  const admin = require("../src/routes/admin-payouts");
  const patch = handlerOf(admin, "patch", "/coach-payouts/:id");
  const pr = await call(patch, { user: { id: "adm", role: "super_admin" }, params: { id: rec.id }, body: { status: "failed", reason: "Bounced：戶名不符，款項保留" } });
  ok(pr.statusCode === 200, "標記 failed");
  const note = db.prepare("SELECT * FROM notifications WHERE user_id='c1' ORDER BY rowid DESC LIMIT 1").get();
  ok(note && /失敗|保留/.test(note.message || ""), "有通知教練（款項保留）", note && note.message);

  console.log("🧪 7. 前端");
  const fs = require("fs");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-earnings.html"), "utf8");
  ok(/收款帳戶設定/.test(page) && /payout-settings\/otp/.test(page), "有收款設定入口＋OTP API");
  ok(/FREEZE|凍結/.test(page) || /凍結/.test(page), "有凍結提示");
  ok(/psHolder/.test(page) && /toUpperCase|text-transform:uppercase/.test(page), "戶名大寫");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
