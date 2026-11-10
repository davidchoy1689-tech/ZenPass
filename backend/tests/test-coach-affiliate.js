#!/usr/bin/env node
/**
 * test-coach-affiliate.js — 工單十六
 * 私域 0% 抽成（教練 100%）＋跨界 5% 被動回佣
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-affiliate-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase();
updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const affiliate = require("../src/services/coach-affiliate");
const { syncCoachEarningsForSchedule, buildMonthlyBreakdown } = require("../src/routes/coach-earnings");

db.exec(`CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, booking_id TEXT NOT NULL,
  student_name TEXT NOT NULL, status TEXT NOT NULL, checkin_time TEXT, notes TEXT,
  updated_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);

function user(id, name, role = "user", rate = 0.8) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,commission_rate) VALUES (?,?,?,?,?,?)")
    .run(id, `${id}@t.hk`, name, "9" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0"), role, rate);
}
let seq = 0;
function venue(id, sandbox = 0) {
  const cols = db.prepare("PRAGMA table_info(partner_venues)").all().map((c) => c.name);
  const has = (n) => cols.includes(n);
  const f = ["id", "name"];
  const v = [id, "測試場地" + id];
  if (has("is_sandbox")) { f.push("is_sandbox"); v.push(sandbox); }
  if (has("status")) { f.push("status"); v.push("active"); }
  db.prepare(`INSERT INTO partner_venues (${f.join(",")}) VALUES (${f.map(() => "?").join(",")})`).run(...v);
  return id;
}
function klass(id, coachId, price, vid) {
  db.prepare(
    "INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,partner_venue_id,status) VALUES (?,?,?,?,?,?,?,'active')",
  ).run(id, coachId, "班" + id, "fitness", 60, price, vid);
}
function sched(id, classId, start) {
  db.prepare(
    "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants) VALUES (?,?,?,?,20)",
  ).run(id, classId, start, start);
}
function booking(id, userId, scheduleId, classId, amount, status = "attended") {
  db.prepare(
    "INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_type,payment_status,amount) VALUES (?,?,?,?,?,?,'single','paid',?)",
  ).run(id, "B" + (++seq), userId, scheduleId, classId, status, amount);
}

const now = new Date();
const start = now.toISOString().slice(0, 19).replace("T", " ");
const month = now.toISOString().slice(0, 7);

user("coachA", "教練甲", "coach");
user("coachB", "教練乙", "coach");
user("s1", "李淑芬", "user");
user("s2", "黃伯", "user");
venue("v1", 0);
venue("vsand", 1);
klass("cA", "coachA", 140, "v1");
klass("cB", "coachB", 140, "v1");
klass("cSand", "coachB", 140, "vsand");
sched("sA", "cA", start);
sched("sB", "cB", start);
sched("sSand", "cSand", start);
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a1','sA','b1','李淑芬','present')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a2','sB','b2','李淑芬','present')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a3','sSand','b3','李淑芬','present')").run();
booking("b1", "s1", "sA", "cA", 140);
booking("b2", "s1", "sB", "cB", 140);
booking("b3", "s1", "sSand", "cSand", 140);

console.log("🧪 1. 綁定（第一位教練永久保留）");
ok(affiliate.bindStudent(db, "s1", "coachA").bound === true, "首次綁定成功");
ok(affiliate.bindStudent(db, "s1", "coachB").bound === false, "第二次綁定被拒（唔會搶客）");
ok(affiliate.originCoachId(db, "s1") === "coachA", "origin 仍係教練甲");

console.log("🧪 2. 私域 0% 抽成（100% 歸教練）");
const rA = syncCoachEarningsForSchedule("sA");
ok(rA.enrolled === 1 && rA.net === 112, "底薪 80% = HK$112", rA);
const up = db.prepare("SELECT * FROM coach_own_student_uplifts WHERE booking_id='b1'").get();
ok(up && up.uplift_cents === 2800, "補足 20% = 2800 cents", up);
const walletA = db.prepare("SELECT wallet_balance FROM users WHERE id='coachA'").get();
ok(Math.round(walletA.wallet_balance * 100) === 14000, "教練甲實收 HK$140（100%）", walletA);
ok(db.prepare("SELECT COUNT(*) c FROM wallet_transactions WHERE user_id='coachA' AND source_type='own_student_uplift'").get().c === 1, "只有一筆補足入帳");

console.log("🧪 3. 跨界 5% 被動回佣");
const rB = syncCoachEarningsForSchedule("sB");
ok(rB.net === 112, "帶班教練乙實收 HK$112（80%）", rB);
const aff = db.prepare("SELECT * FROM coach_affiliate_payouts WHERE booking_id='b2'").get();
ok(aff && aff.beneficiary_coach_id === "coachA" && aff.actual_coach_id === "coachB", "受益人＝原教練甲");
ok(aff.commission_amount_cents === 700 && aff.status === "cleared", "5% = 700 cents、已清算", aff);
const walletA2 = db.prepare("SELECT wallet_balance FROM users WHERE id='coachA'").get();
ok(Math.round(walletA2.wallet_balance * 100) === 14700, "教練甲累計 HK$147（140 + 7）", walletA2);
const walletB = db.prepare("SELECT wallet_balance FROM users WHERE id='coachB'").get();
ok(Math.round(walletB.wallet_balance * 100) === 11200, "教練乙只有 HK$112（平台 15%＋回佣 5%）", walletB);
ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='affiliate.commission_earned' AND entity_id='b2'").get(), "寫入 affiliate.commission_earned");
ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='own_student.uplift' AND entity_id='b1'").get(), "寫入 own_student.uplift");

console.log("🧪 4. 冪等（重覆結算／重點名）");
syncCoachEarningsForSchedule("sA");
syncCoachEarningsForSchedule("sB");
affiliate.settleSchedule("sA");
affiliate.settleSchedule("sB");
ok(db.prepare("SELECT COUNT(*) c FROM coach_affiliate_payouts WHERE booking_id='b2'").get().c === 1, "回佣唔會重複");
ok(db.prepare("SELECT COUNT(*) c FROM coach_own_student_uplifts WHERE booking_id='b1'").get().c === 1, "補足唔會重複");
ok(Math.round(db.prepare("SELECT wallet_balance FROM users WHERE id='coachA'").get().wallet_balance * 100) === 14700, "錢包金額不變");

console.log("🧪 5. 沙盒場地排除");
const rS = affiliate.settleSchedule("sSand");
ok(rS.skipped === "SANDBOX", "沙盒班次跳過", rS);
ok(db.prepare("SELECT COUNT(*) c FROM coach_affiliate_payouts WHERE booking_id='b3'").get().c === 0, "冇分佣紀錄");

console.log("🧪 6. 月結 Summary");
const bd = buildMonthlyBreakdown(db, "coachA", month);
ok(bd.affiliate_passive_cents === 700, "affiliate_passive_cents = 700", bd.affiliate_passive_cents);
ok(bd.affiliate_students_count === 1, "帶來分佣學員 1 人");
ok(bd.own_student_uplift_cents === 2800, "私域補足 2800 cents");
ok(bd.direct_teaching_cents === 11200, "直接授課 11200 cents");
ok(bd.total_payout_cents === 14700, "total = 11200 + 2800 + 700", bd.total_payout_cents);
ok(bd.total_earned === 147, "total_earned = HK$147", bd.total_earned);
  ok((bd.affiliate_recent || []).length === 1, "有回佣明細");
  ok((bd.sessions_breakdown || []).some((r) => r.own_student_count === 1 && Math.round(r.session_payout * 100) === 14000), "班次顯示自有學生 100%");
  ok(bd.payout_summary && bd.payout_summary.total_payout_cents === 14700 && bd.payout_summary.teaching_earnings_cents === 11200, "payout_summary 以 cents 傳輸", bd.payout_summary);
  ok(bd.kpis && bd.kpis.affiliate_active_students === 1 && bd.kpis.own_students_served === 1, "KPI 反映被動學員／自有學生", bd.kpis);
  const brk = (bd.affiliate_payouts_breakdown || [])[0];
  ok(brk && /^\d{4}\*{4}$/.test(brk.student_phone_masked || ""), "流水有遮罩電話", brk && brk.student_phone_masked);
  ok(brk && brk.actual_coach_name === "教練乙" && brk.commission_rate === 0.05, "流水有帶班教練＋5%", brk);
  ok(brk && brk.commission_amount_cents === 700 && brk.order_amount_cents === 14000, "流水以 cents 回傳", brk);
  ok((bd.sessions_breakdown || []).some((r) => r.platform_student_count === 0), "班次分開自有／平台人數");

console.log("🧪 7. 未綁定學員唔會有分佣");
booking("b4", "s2", "sB", "cB", 140, "confirmed");
syncCoachEarningsForSchedule("sB");
ok(db.prepare("SELECT COUNT(*) c FROM coach_affiliate_payouts WHERE booking_id='b4'").get().c === 0, "無 affiliation → 無 5%");

console.log("🧪 8. 前端與文案");
const fs = require("fs");
const base = path.join(__dirname, "../../frontend-v2");
const earn = fs.readFileSync(path.join(base, "coach-earnings.html"), "utf8");
const imp = fs.readFileSync(path.join(base, "coach-students-import.html"), "utf8");
  ok(/跨界被動分佣/.test(earn) && /affiliate_passive/.test(earn), "收益頁有 5% KPI");
  ok(/自有學生/.test(earn) && /100%/.test(earn), "班次有自有學生標籤");
  ok(/終身鎖定/.test(earn) && /平台提撥零扣減/.test(earn), "Bento 金色卡有終身／零扣減文案");
  ok(/下次 FPS 自動入數/.test(earn), "有 FPS 入數提示");
  ok(/student_phone_masked/.test(earn) && /actual_coach_name/.test(earn), "流水顯示電話遮罩／帶班教練");
ok(/您的學生，永遠是您的資產/.test(imp) && /0% 抽佣/.test(imp), "匯入頁有利益保證文案");
ok(/終身享 5% 被動回佣/.test(imp), "匯入頁有 5% 文案");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
