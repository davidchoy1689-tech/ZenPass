#!/usr/bin/env node
/** test-coach-p3.js — 發放日計算 + 代堂審批安全閉環 + 收入歸屬 */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p3-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const start = new Date("2026-12-20T02:30:00Z"), end = new Date("2026-12-20T04:00:00Z");

db.prepare("INSERT INTO users (id,email,name,role) VALUES ('admin1','a@t.hk','管理員','platform_manager')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('ca','ca@t.hk','原教練','coach')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('cb','cb@t.hk','代堂教練','coach')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','ca','芬蘭木柱','新興運動',90,10,200,20,'active','測試場')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1',?,?,10,1,'available')").run(fmt(start), fmt(end));
db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
  id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT, license_expiry TEXT,
  first_aid_type TEXT, first_aid_expiry TEXT, doc_url TEXT, certificate_url TEXT,
  insurance_policy_url TEXT, insurance_expiry_date TEXT, is_starred INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', reviewer_id TEXT, created_at TEXT DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status TEXT,
  checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS coach_substitution_requests (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, from_coach_id TEXT NOT NULL, target_coach_id TEXT NOT NULL,
  reason TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT, reviewed_by TEXT, review_note TEXT)`);
db.prepare("INSERT INTO coach_credentials (id,user_id,license_type,license_expiry,insurance_expiry_date,status) VALUES ('cc1','cb','一級教練','2027-12-31','2027-06-30','verified')").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  if (!l) return null;
  return l.route.stack[l.route.stack.length - 1].handle;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  console.log("🧪 1. 下次發放日（每月 5 號，週末順延）");
  const { buildMonthlyBreakdown } = require("../src/routes/coach-earnings");
  const nov = buildMonthlyBreakdown(db, "ca", "2026-11");
  ok(nov.next_payout_date === "2026-12-07", "2026-11 → 12/5 週六順延 12/07（週一）", nov.next_payout_date);
  ok(/2026年12月07日（週一）/.test(nov.next_payout_label), "標籤含星期", nov.next_payout_label);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','cl1','2026-10-10 02:00:00','2026-10-10 03:30:00',10,0,'available')").run();
  const oct = buildMonthlyBreakdown(db, "ca", "2026-10");
  ok(oct.next_payout_date === "2026-11-05", "2026-10 → 11/05（週四，不順延）", oct.next_payout_date);
  const dec = buildMonthlyBreakdown(db, "ca", "2026-12");
  ok(dec.next_payout_date === "2027-01-05", "跨年 2026-12 → 2027-01-05", dec.next_payout_date);

  console.log("🧪 2. 代堂申請（pending，未改導師）");
  db.prepare("INSERT INTO coach_substitution_requests (id,session_id,from_coach_id,target_coach_id,reason,status) VALUES ('r1','s1','ca','cb','身體不適','pending')").run();
  const s0 = db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s1'").get();
  ok(!s0.coach_override_id, "申請階段導師維持原教練");

  const router = require("../src/routes/admin-substitutes");
  const pending = handlerOf(router, "get", "/substitutes/pending");
  const approve = handlerOf(router, "post", "/substitutes/:id/approve");
  const reject = handlerOf(router, "post", "/substitutes/:id/reject");
  ok(!!pending && !!approve && !!reject, "三個 handler 存在");

  console.log("🧪 3. 權限");
  const coachTry = await call(pending, { user: { id: "ca", role: "coach" } });
  ok(coachTry.statusCode === 403, "教練不可讀審批清單（403）", coachTry.statusCode);
  const coachApprove = await call(approve, { user: { id: "ca", role: "coach" }, params: { id: "r1" } });
  ok(coachApprove.statusCode === 403, "教練不可自行核准（403）", coachApprove.statusCode);

  console.log("🧪 4. 管理員清單 + 合規檢查");
  const list = await call(pending, { user: { id: "admin1", role: "platform_manager" } });
  ok(list.body.items.length === 1, "見到 1 個待審批", list.body.items.length);
  ok(list.body.items[0].eligible === true, "資質齊 → eligible", JSON.stringify(list.body.items[0].blockers));
  ok(list.body.items[0].warnings.some((w) => w.includes("PLI")), "未連結場地 → PLI 警告（非阻擋）");

  console.log("🧪 5. 收入歸屬（審批前後）");
  db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount) VALUES ('b1','ca','cl1','s1','attended','paid',200)").run();
  db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status,created_at,updated_at) VALUES ('a1','s1','b1','原教練','present',datetime('now'),datetime('now'))").run();
  const beforeA = buildMonthlyBreakdown(db, "ca", "2026-12");
  const beforeB = buildMonthlyBreakdown(db, "cb", "2026-12");
  ok(beforeA.total_sessions === 1 && beforeA.total_earned === 160, "審批前收入歸原教練（$160）", beforeA.total_earned);
  ok(beforeB.total_sessions === 0, "審批前代堂教練 0 堂", beforeB.total_sessions);

  console.log("🧪 6. 核准（原子更新）");
  const ap = await call(approve, { user: { id: "admin1", role: "platform_manager" }, params: { id: "r1" }, body: {} });
  ok(ap.statusCode === 200 && ap.body.status === "approved", "核准成功", ap.statusCode);
  const s1 = db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s1'").get();
  ok(s1.coach_override_id === "cb", "班次導師已轉為代堂教練");
  const r1 = db.prepare("SELECT status, reviewed_by FROM coach_substitution_requests WHERE id='r1'").get();
  ok(r1.status === "approved" && r1.reviewed_by === "admin1", "申請狀態 approved + 審批人");
  const afterA = buildMonthlyBreakdown(db, "ca", "2026-12");
  const afterB = buildMonthlyBreakdown(db, "cb", "2026-12");
  ok(afterA.total_sessions === 0 && afterA.total_earned === 0, "核准後原教練不再計入", afterA.total_earned);
  ok(afterB.total_sessions === 1 && afterB.total_earned === 160, "核准後收入歸代堂教練", afterB.total_earned);
  const again = await call(approve, { user: { id: "admin1", role: "platform_manager" }, params: { id: "r1" } });
  ok(again.statusCode === 409, "重複核准 → 409", again.statusCode);

  console.log("🧪 7. 合規阻擋（保險過期）");
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s3','cl1','2026-12-28 02:00:00','2026-12-28 03:30:00',10,0,'available')").run();
  db.prepare("INSERT INTO coach_credentials (id,user_id,license_type,license_expiry,insurance_expiry_date,status) VALUES ('cc2','cb','一級教練','2027-12-31','2024-01-01','verified')").run();
  db.prepare("INSERT INTO coach_substitution_requests (id,session_id,from_coach_id,target_coach_id,reason,status) VALUES ('r2','s3','ca','cb','旅行','pending')").run();
  const bad2 = await call(approve, { user: { id: "admin1", role: "platform_manager" }, params: { id: "r2" } });
  ok(bad2.statusCode === 409 && /保險已過期/.test(bad2.body.error), "保險過期 → 409", bad2.body.error);
  const s3 = db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s3'").get();
  ok(!s3.coach_override_id, "拒絕時導師不變");

  console.log("🧪 8. 駁回");
  const noReason = await call(reject, { user: { id: "admin1", role: "platform_manager" }, params: { id: "r2" }, body: {} });
  ok(noReason.statusCode === 400, "冇原因 → 400");
  const rj = await call(reject, { user: { id: "admin1", role: "platform_manager" }, params: { id: "r2" }, body: { reason: "保險未覆蓋該場地" } });
  ok(rj.statusCode === 200 && rj.body.status === "rejected", "駁回成功");
  ok(db.prepare("SELECT status FROM coach_substitution_requests WHERE id='r2'").get().status === "rejected", "DB 狀態 rejected");

  console.log("🧪 9. 稽核");
  const audits = db.prepare("SELECT action_type FROM audit_log WHERE action_type LIKE 'coach.substitute_%'").all().map((x) => x.action_type);
  ok(audits.includes("coach.substitute_approved") && audits.includes("coach.substitute_rejected"), "核准／駁回都有審計", audits.join(","));

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
