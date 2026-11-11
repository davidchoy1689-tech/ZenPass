#!/usr/bin/env node
/** test-phase1-reconciliation.js — Phase 1.2 四學員閉環對賬（整數 cents） */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase1-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")(); require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const aff = require("../src/services/coach-affiliate");
aff.ensureSchema(db);
require("../src/services/risk-control").ensureSchema(db);
try { db.exec("ALTER TABLE bookings ADD COLUMN is_walkin INTEGER DEFAULT 0"); } catch (e) {}
db.exec(`CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY, booking_id TEXT, schedule_id TEXT, user_id TEXT, status TEXT, checked_in_at TEXT
)`);

const U = (id, name, phone, rate = 0.8) =>
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status,commission_rate) VALUES (?,?,?,?,'coach',1,1,'active',?)")
    .run(id, id + "@t.hk", name, phone, rate);
U("coachA", "蔡教練", "98760001");
U("coachB", "黃Sir", "98760002");

db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,district,venue_name,status) VALUES ('cl1','coachA','樂齡防跌與關節減壓班','stretch',90,20,140,14,'葵青','青衣楓樹窩體育館','active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,status,enrolled_count,max_participants) VALUES ('s1','cl1','2026-11-15 02:00:00','2026-11-15 03:30:00','available',4,20)").run();

const students = [
  ["s1", "學員一", "61110001", "coachA", "online"],
  ["s2", "學員二", "61110002", "coachB", "online"],
  ["s3", "學員三", "61110003", "coachA", "cash"],
  ["s4", "學員四", "61110004", "coachB", "cash"],
];
for (const [id, name, phone, origin, mode] of students) {
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES (?,?,?,?,'user')").run(id, id + "@t.hk", name, phone);
  db.prepare("INSERT INTO student_coach_affiliations (student_user_id,origin_coach_id,status) VALUES (?,?,'active')").run(id, origin);
  const bId = "b-" + id;
  const walkin = mode === "cash" ? 1 : 0;
  const method = mode === "cash" ? "walkin_cash" : "user_pass";
  const ptype = mode === "cash" ? "single" : "pass";
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,payment_method,payment_type,is_walkin,created_at)
     VALUES (?,?,?,?,?,'attended','paid',140,?,?,?,datetime('now'))`,
  ).run(bId, "ZP-" + id.toUpperCase(), id, "s1", "cl1", method, ptype, walkin);
  db.prepare("INSERT INTO attendances (id,booking_id,schedule_id,user_id,status,checked_in_at) VALUES (?,?,?,?,'present',datetime('now'))")
    .run("a-" + id, bId, "s1", id);
}

// 黃 Sir 的 5% 被動分佣（兩單跨界：線上 + 現場現金）
for (const b of ["b-s2", "b-s4"]) {
  db.prepare(
    `INSERT INTO coach_affiliate_payouts (id,beneficiary_coach_id,actual_coach_id,student_user_id,booking_id,session_id,course_id,order_amount_cents,commission_amount_cents,status)
     VALUES (?,?,?,?,?,?,?,?,?,'cleared')`,
  ).run("ap-" + b, "coachB", "coachA", b.replace("b-", ""), b, "s1", "cl1", 14000, 700);
}

const { buildMonthlyBreakdown } = require("../src/routes/coach-earnings");
const A = buildMonthlyBreakdown(db, "coachA", "2026-11");
const B = buildMonthlyBreakdown(db, "coachB", "2026-11");

console.log("🧪 Phase 1.2 四學員閉環對賬");
console.log("  A:", JSON.stringify({
  total: A.total_payout_cents, direct: A.direct_teaching_cents, uplift: A.own_student_uplift_cents,
  cash: A.cash_collected_cents, net: A.net_payout_cents, aff: A.affiliate_passive_cents,
}));
console.log("  B:", JSON.stringify({ aff: B.affiliate_passive_cents }));

// 學員1：自有線上 100% = $140
// 學員2：跨界線上 80% = $112（B 5% = $7）
// 學員3：自有現金 $140 → 沖抵後 0
// 學員4：跨界現金 $140 → A 應得 $112，已收 $140，需回繳 $28
ok(A.total_payout_cents === 50400, "應得總額 50400 cents（140+112+140+112）", A.total_payout_cents);
ok(A.direct_teaching_cents === 44800, "帶班 80% = 44800 cents", A.direct_teaching_cents);
ok(A.own_student_uplift_cents === 5600, "自有補足 20% = 5600 cents", A.own_student_uplift_cents);
ok(A.cash_collected_cents === 28000, "現場現金 = 28000 cents", A.cash_collected_cents);
ok(A.net_payout_cents === 22400, "淨發放 = 22400 cents（504−280）", A.net_payout_cents);
ok(A.net_payout_cents === A.total_payout_cents - A.cash_collected_cents, "淨額 = 總額 − 現金沖銷");
ok(B.affiliate_passive_cents === 1400, "黃 Sir 5% 被動分佣 = 1400 cents（2×700）", B.affiliate_passive_cents);

// 逐學員驗算
const row = A.payment_breakdown.find((p) => p.student_phone_masked.startsWith("6111") && p.booking_type === "現場Walk-in");
ok(A.payment_breakdown.length === 4, "4 筆付款明細", A.payment_breakdown.length);
const ownCash = A.payment_breakdown.filter((p) => p.split_mode === "自有學生100%" && p.collected_cents > 0);
const crossCash = A.payment_breakdown.filter((p) => p.split_mode !== "自有學生100%" && p.collected_cents > 0);
ok(ownCash.length === 1 && ownCash[0].coach_cents - ownCash[0].collected_cents === 0, "學員3：$140 − $140 = $0");
ok(crossCash.length === 1 && crossCash[0].coach_cents - crossCash[0].collected_cents === -2800, "學員4：$112 − $140 = −$28（回繳平台）", crossCash[0]);

// 整數 cents：所有金額欄位必須係整數，唔可以有浮點誤差
const centsFields = ["total_payout_cents", "direct_teaching_cents", "own_student_uplift_cents", "cash_collected_cents", "net_payout_cents"];
ok(centsFields.every((f) => Number.isInteger(A[f])), "所有結算金額為整數 cents", centsFields.map((f) => [f, A[f]]));
ok(A.payment_breakdown.every((p) => Number.isInteger(p.coach_cents) && Number.isInteger(p.collected_cents)), "逐筆明細為整數 cents");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
