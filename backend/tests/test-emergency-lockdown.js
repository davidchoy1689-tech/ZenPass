#!/usr/bin/env node
/** test-emergency-lockdown.js — 緊急熔斷（Kill-Switch）／黑名單／復原 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-emg-" + Date.now() + ".db");
delete process.env.NODE_ENV;
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const risk = require("../src/services/risk-control");
const emg = require("../src/services/emergency");
const ps = require("../src/services/payout-settings");
risk.ensureSchema(db); emg.ensureSchema(db); ps.ensureSchema(db);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('adm','adm@t.hk','管理員','90000001','super_admin')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','蔡教練','98765432','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c2','c2@t.hk','黃教練','91234567','coach')").run();

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
  try { Promise.resolve(h({ body, user, params, query, headers: {}, ip: "1.1.1.1" }, res)).catch((e) => resolve({ statusCode: 500, body: { error: e.message } })); }
  catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  console.log("🧪 1. 管理員安全 PIN");
  ok(!emg.setAdminPin(db, "adm", { pin: "12ab" }).ok, "非 6 位 → 拒絕");
  ok(emg.setAdminPin(db, "adm", { pin: "246810" }).ok, "設定 PIN 成功");
  ok(emg.verifyAdminPin(db, "adm", "000000").code === "PIN_INVALID", "錯 PIN → PIN_INVALID");
  ok(emg.verifyAdminPin(db, "adm", "246810").ok, "正確 PIN → 通過");

  console.log("🧪 2. 收款歷史與惡意變更");
  db.prepare(
    "INSERT INTO coach_payout_settings (coach_id,fps_type,fps_proxy_value,bank_code,account_holder_name,verified_at) VALUES ('c1','mobile','98765432','024','CHAN TAI MAN',datetime('now'))",
  ).run();
  db.prepare(
    "INSERT INTO coach_payout_settings_history (coach_id,fps_type,fps_proxy_value,bank_code,account_holder_name,is_verified,event) VALUES ('c1','mobile','98765432','024','CHAN TAI MAN',1,'before_update')",
  ).run();
  db.prepare("UPDATE coach_payout_settings SET fps_proxy_value='61234567', bank_code='012' WHERE coach_id='c1'").run();
  const t = risk.trigger(db, { coachId: "c1", reason: "unusual_ip", ip: "203.0.113.9", userAgent: "EvilBrowser/1.0" });
  ok(!!t.ticket.id, "已開風控工單");

  console.log("🧪 3. 緊急熔斷（路由＋PIN）");
  const router = require("../src/routes/admin-risk");
  const lock = handlerOf(router, "post", "/emergency-lockdown");
  const bad1 = await call(lock, { user: { id: "adm", role: "super_admin" }, body: { coach_id: "c1", ticket_id: t.ticket.id, admin_pin: "111111", reason: "手機被盜" } });
  ok(bad1.statusCode === 403, "錯 PIN → 403", bad1.body);
  ok(db.prepare("SELECT is_active FROM users WHERE id='c1'").get().is_active === 1, "錯 PIN 唔會封鎖");

  const beforeTv = db.prepare("SELECT token_version FROM users WHERE id='c1'").get().token_version;
  const good = await call(lock, {
    user: { id: "adm", role: "super_admin" },
    body: { coach_id: "c1", ticket_id: t.ticket.id, admin_pin: "246810", reason: "教練確認手機被盜，FPS 被改" },
  });
  ok(good.statusCode === 200 && good.body.success, "熔斷成功", good.body);
  const u = db.prepare("SELECT * FROM users WHERE id='c1'").get();
  ok(Number(u.is_active) === 0, "帳號 is_active=0");
  ok(u.payout_status === "frozen_stolen", "出糧狀態 frozen_stolen");
  ok(Number(u.token_version) === Number(beforeTv) + 1, "token_version +1（JWT 全撤）");
  const st = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id='c1'").get();
  ok(st.fps_proxy_value === "98765432" && st.bank_code === "024", "已還原合法 FPS");
  ok(emg.isBlacklisted(db, "fps", "61234567"), "黑客 FPS 入黑名單");
  ok(emg.isBlacklisted(db, "ip", "203.0.113.9"), "入侵 IP 入黑名單");
  const tk = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(t.ticket.id);
  ok(tk.lockdown_state === "account_locked", "工單標記 account_locked");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='security.coach_emergency_lockdown'").get(), "有熔斷審計");
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE user_id='c1' AND type='security'").get(), "有站內安全通知");

  console.log("🧪 4. 已熔斷工單仍在待處理隊列");
  const list = handlerOf(router, "get", "/risk-tickets");
  const l1 = await call(list, { user: { id: "adm", role: "super_admin" }, query: { status: "open" } });
  ok(l1.body.data.some((x) => x.id === t.ticket.id && x.lockdown_state === "account_locked"), "待處理列表見得到");

  console.log("🧪 5. 黑名單攔截其他教練綁定");
  const blocked = ps.validateAndUpdate(db, "c2", {
    otp_session_id: "none", otp_code: "123456",
  });
  ok(blocked.ok === false && blocked.code !== "BLACKLISTED", "先經 OTP 驗證（未到黑名單檢查）");
  const crypto = require("crypto");
  const sid = crypto.randomUUID();
  db.prepare("INSERT INTO payout_setting_otps (id,coach_id,phone,otp_code,expires_at) VALUES (?,?,?,?,datetime('now','+5 minutes'))").run(sid, "c2", "91234567", "123456");
  const blocked2 = ps.validateAndUpdate(db, "c2", {
    otp_session_id: sid, otp_code: "123456", fps_type: "mobile", fps_proxy_value: "61234567", bank_code: "024", account_holder_name: "WONG TAI MAN",
  });
  ok(blocked2.ok === false && blocked2.code === "BLACKLISTED", "黑名單 FPS → 拒絕", blocked2);

  console.log("🧪 6. 帳號復原");
  const rec = handlerOf(router, "post", "/account-recovery");
  const noId = await call(rec, { user: { id: "adm", role: "super_admin" }, body: { coach_id: "c1", action: "reactivate", notes: "已核實" } });
  ok(noId.statusCode === 400 && noId.body.code === "ID_NOT_VERIFIED", "未核身 → 拒絕", noId.body);
  const reset = await call(rec, { user: { id: "adm", role: "super_admin" }, body: { coach_id: "c1", action: "issue_reset", notes: "發出重設連結" } });
  ok(reset.statusCode === 200 && !!reset.body.reset_link, "未配置 SMS 時回傳一次性連結");
  ok(!!db.prepare("SELECT reset_token FROM users WHERE id='c1'").get().reset_token, "reset_token 已寫入");
  const after = await call(rec, { user: { id: "adm", role: "super_admin" }, body: { coach_id: "c1", action: "reactivate", notes: "視像核對 HKID，確認本人", id_verified: true } });
  ok(after.statusCode === 200 && after.body.success, "復原成功", after.body);
  const u2 = db.prepare("SELECT * FROM users WHERE id='c1'").get();
  ok(Number(u2.is_active) === 1 && u2.payout_status === "active", "帳號恢復 active");
  ok(!u2.reset_token, "重設 token 已清除");
  const tk2 = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(t.ticket.id);
  ok(tk2.lockdown_state === "recovered", "工單標記 recovered");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='security.coach_account_recovered'").get(), "有復原審計");

  console.log("🧪 7. 自我保護與前端");
  const self = await call(lock, { user: { id: "adm", role: "super_admin" }, body: { coach_id: "adm", ticket_id: t.ticket.id, admin_pin: "246810", reason: "測試熔斷" } });
  ok(self.statusCode === 400 && self.body.code === "PROTECTED_ROLE", "不可熔斷管理員", self.body);
  const fs = require("fs");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-risk-console.html"), "utf8");
  ok(/確認帳號失竊：立即封鎖/.test(page) && /emergency-lockdown/.test(page), "前端有熔斷入口");
  ok(/帳號復原/.test(page) && /account-recovery/.test(page), "前端有復原流程");
  ok(/安全 PIN/.test(page) && /security\/admin-pin/.test(page), "前端可設定 PIN");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
