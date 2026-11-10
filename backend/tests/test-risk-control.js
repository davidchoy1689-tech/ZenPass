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
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c3','c3@t.hk','陳教練','92345678','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c4','c4@t.hk','李教練','93456789','coach')").run();

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

  console.log("🧪 4b. 工單詳情＋首屏統計");
  const detailFn = handlerOf(riskRouter, "get", "/risk-tickets/:id");
  const summaryFn = handlerOf(riskRouter, "get", "/risk-summary");
  const dt = await call(detailFn, { user: { id: "adm", role: "super_admin" }, params: { id: t1.ticket.id } });
  ok(dt.statusCode === 200 && dt.body.data.ticket.coach_name === "蔡教練", "詳情有教練名", dt.body.data && dt.body.data.ticket);
  ok(!!dt.body.data.environment && typeof dt.body.data.amount_at_stake_cents === "number", "詳情有環境＋金額");
  ok(!!dt.body.data.ticket.reason_label, "詳情有原因標籤");
  const sm = await call(summaryFn, { user: { id: "adm", role: "super_admin" } });
  ok(sm.statusCode === 200 && sm.body.data.open_tickets >= 1 && sm.body.data.frozen_coaches >= 1, "統計：待審＋凍結人數", sm.body.data);
  ok(typeof sm.body.data.dual_threshold_cents === "number", "統計：雙人門檻");

  console.log("🧪 4c. Maker–Checker 雙人覆核（大額）");
  db.exec("CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO platform_settings (key,value) VALUES ('risk.dual_approval_threshold_cents','100') ON CONFLICT(key) DO UPDATE SET value='100'").run();
  const t3 = risk.trigger(db, { coachId: "c3", reason: "pre_payout_change", ip: "5.6.7.8" });
  db.prepare("UPDATE risk_audit_tickets SET amount_at_stake_cents=5000000 WHERE id=?").run(t3.ticket.id);
  const p1 = await call(resolve, { user: { id: "admin_04", role: "super_admin" }, params: { id: t3.ticket.id }, body: { action: "unlock", notes: "初審：電話核實本人，戶名一致" } });
  ok(p1.statusCode === 200 && p1.body.requires_secondary === true && !!p1.body.challenge, "第一次 → 初審＋覆核碼", p1.body);
  ok(risk.payoutState(db, "c3") === "frozen", "初審後仍然凍結");
  const p2 = await call(resolve, { user: { id: "admin_04", role: "super_admin" }, params: { id: t3.ticket.id }, body: { action: "unlock", notes: "自己覆核", challenge: p1.body.challenge } });
  ok(p2.statusCode === 403 && p2.body.code === "SAME_ADMIN", "同一管理員不可自行覆核", p2.body);
  const p3 = await call(resolve, { user: { id: "admin_05", role: "super_admin" }, params: { id: t3.ticket.id }, body: { action: "unlock", notes: "覆核：確認無誤", challenge: "BADCHALLENGE" } });
  ok(p3.statusCode === 400 && p3.body.code === "CHALLENGE_INVALID", "錯覆核碼被拒", p3.body);
  const p4 = await call(resolve, { user: { id: "admin_05", role: "super_admin" }, params: { id: t3.ticket.id }, body: { action: "unlock", notes: "覆核：確認無誤，批准", challenge: p1.body.challenge } });
  ok(p4.statusCode === 200 && p4.body.status === "resolved", "第二位管理員 → 解凍", p4.body);
  ok(risk.payoutState(db, "c3") === "active", "c3 payout_status → active");
  const row3 = db.prepare("SELECT * FROM risk_audit_tickets WHERE id=?").get(t3.ticket.id);
  ok(row3.primary_approved_by === "admin_04" && row3.secondary_approved_by === "admin_05", "雙簽人身份已記錄");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='risk.ticket_dual_approved'").get(), "有雙人覆核審計");

  console.log("🧪 4d. 駁回維持凍結");
  const t4 = risk.trigger(db, { coachId: "c4", reason: "unusual_ip", ip: "9.9.9.9", meta: { country: "NL" } });
  const rj = await call(resolve, { user: { id: "adm", role: "super_admin" }, params: { id: t4.ticket.id }, body: { action: "reject", notes: "未能聯絡本人，維持凍結調查" } });
  ok(rj.statusCode === 200 && rj.body.status === "rejected", "駁回成功", rj.body);
  ok(risk.payoutState(db, "c4") === "frozen", "駁回後保持凍結");
  ok(db.prepare("SELECT COUNT(*) c FROM risk_audit_tickets WHERE id=?").get(t4.ticket.id).c === 1, "駁回唔會刪單");

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
  ok(/風控與帳戶安全審核/.test(adminPage) && /risk-tickets/.test(adminPage) && /解除凍結/.test(adminPage), "admin 風控台");
  ok(/risk-summary/.test(adminPage) && /二次簽署/.test(adminPage) && /覆核碼/.test(adminPage), "風控台有統計＋雙人覆核 UI");
  ok(/routes\/admin-risk/.test(fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8")), "admin-risk 已掛載");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
