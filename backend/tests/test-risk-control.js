#!/usr/bin/env node
/** test-risk-control.js — 工單二十二：風控凍結／工單／解凍 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-risk-" + Date.now() + ".db");
delete process.env.NODE_ENV;
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const risk = require("../src/services/risk-control");
risk.ensureSchema(db);
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
  console.log("🧪 1. 觸發風控（出糧前改資料）");
  const t1 = risk.trigger(db, { coachId: "c1", reason: "pre_payout_change", ip: "1.2.3.4" });
  ok(t1.ticket && /^TICKET-RISK-/.test(t1.ticket.id), "產生 TICKET-RISK", t1.ticket && t1.ticket.id);
  ok(risk.payoutState(db, "c1") === "frozen", "教練出糧狀態 → frozen");
  const t2 = risk.trigger(db, { coachId: "c1", reason: "pre_payout_change", ip: "1.2.3.4" });
  ok(t2.duplicated === true && db.prepare("SELECT COUNT(*) c FROM risk_audit_tickets WHERE coach_id='c1'").get().c === 1, "同原因唔會重複開單");
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE user_id='c1' AND type='risk'").get(), "有通知教練");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='risk.ticket_opened'").get(), "有審計");

  console.log("🧪 2. 凍結期間不可出糧");
  const admin = require("../src/routes/admin-payouts");
  const disburse = handlerOf(admin, "post", "/coach-payouts/disburse");
  const d1 = await call(disburse, { user: { id: "adm", role: "super_admin" }, body: { coach_id: "c1", month: "2026-11" } });
  ok(d1.statusCode === 409 && d1.body.code === "COACH_FROZEN", "出糧被擋", d1.body);

  console.log("🧪 3. 風控台列表與解凍");
  const riskRouter = require("../src/routes/admin-risk");
  const list = handlerOf(riskRouter, "get", "/risk-tickets");
  const resolve = handlerOf(riskRouter, "post", "/risk-tickets/:id/resolve");
  const l1 = await call(list, { user: { id: "adm", role: "super_admin" }, query: {} });
  ok(l1.statusCode === 200 && l1.body.data.length === 1, "列表 1 張", l1.body.data && l1.body.data.length);
  const short = await call(resolve, { user: { id: "adm", role: "super_admin" }, params: { id: t1.ticket.id }, body: { action: "unlock", notes: "ok" } });
  ok(short.statusCode === 400, "備註太短 → 400");
  const r1 = await call(resolve, { user: { id: "adm", role: "super_admin" }, params: { id: t1.ticket.id }, body: { action: "unlock", notes: "已致電教練核實身份，確認本人更改" } });
  ok(r1.statusCode === 200 && r1.body.status === "resolved", "解凍成功", r1.body);
  ok(risk.payoutState(db, "c1") === "active", "payout_status → active");
  const row = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(t1.ticket.id);
  ok(row.reviewed_by_admin_id === "adm" && /核實/.test(row.resolution_notes), "記錄審核者＋備註");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='risk.ticket_resolved'").get(), "有解凍審計");

  console.log("🧪 4. OTP 連續錯誤自動開單");
  const cr = require("../src/routes/coach-earnings");
  const otpFn = handlerOf(cr, "post", "/payout-settings/otp");
  const putFn = handlerOf(cr, "put", "/payout-settings");
  const o = await call(otpFn, { user: { id: "c2", role: "coach" } });
  ok(o.statusCode === 200, "OTP 發出");
  for (let i = 0; i < 5; i++) {
    await call(putFn, { user: { id: "c2", role: "coach" }, body: { otp_session_id: o.body.otp_session_id, otp_code: "000000", fps_type: "mobile", fps_proxy_value: "91234567", bank_code: "024", account_holder_name: "WONG TAI MAN" } });
  }
  ok(db.prepare("SELECT COUNT(*) c FROM risk_audit_tickets WHERE coach_id='c2' AND trigger_reason='otp_exhausted'").get().c === 1, "OTP 5 次錯誤 → 開單");
  ok(risk.payoutState(db, "c2") === "frozen", "c2 出糧凍結");

  console.log("🧪 5. 凍結窗（6–7 號）");
  const ps = require("../src/services/payout-settings");
  ok(ps.inFreezeWindow(new Date("2026-12-06T00:30:00+08:00")) === true, "6 號全日凍結");
  ok(ps.inFreezeWindow(new Date("2026-12-07T23:00:00+08:00")) === true, "7 號凍結");
  ok(ps.inFreezeWindow(new Date("2026-12-08T00:10:00+08:00")) === false, "8 號解凍");

  console.log("🧪 6. 前端");
  const fs = require("fs");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-earnings.html"), "utf8");
  const adminPage = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-risk-console.html"), "utf8");
  ok(/帳戶安全保護中/.test(page) && /riskBanner/.test(page), "教練端有風控橫幅");
  ok(/風控工單/.test(adminPage) && /risk-tickets/.test(adminPage) && /解除凍結/.test(adminPage), "admin 風控台");
  ok(/routes\/admin-risk/.test(fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8")), "admin-risk 已掛載");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
