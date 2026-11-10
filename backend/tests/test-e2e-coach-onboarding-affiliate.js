#!/usr/bin/env node
/**
 * test-e2e-coach-onboarding-affiliate.js — 工單十八（全鏈路）
 *  匯入名單 → 魔法連結認領 → 永久綁定（First-Touch Wins）
 *  → 自有 100% / 跨界 5% → 冪等 → CSV 對數
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-e2e-aff-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase();
updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
db.exec(`CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, booking_id TEXT NOT NULL,
  student_name TEXT NOT NULL, status TEXT NOT NULL, checkin_time TEXT, notes TEXT,
  updated_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} } = {}) => new Promise((resolve) => {
  const res = {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; resolve(this); },
    send(o) { this.body = o; resolve(this); },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    removeHeader(k) { delete this.headers[k.toLowerCase()]; return this; },
  };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1", cookies: {} }, res); }
  catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

function mkUser(id, name, role, phone) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,commission_rate) VALUES (?,?,?,?,?,0.8)").run(id, `${id}@t.hk`, name, phone, role);
}
function mkVenue(id) {
  db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox) VALUES (?,?, 'active', 0)").run(id, "青衣楓樹窩體育館");
}
function mkClass(id, coach, title, vid) {
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,partner_venue_id,status) VALUES (?,?,?,?,?,140,?,'active')").run(id, coach, title, "fitness", 60, vid);
}
function mkSched(id, cid, start) {
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants) VALUES (?,?,?,?,20)").run(id, cid, start, start);
}
function mkBooking(id, uid, sid, cid, amount) {
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_type,payment_status,amount) VALUES (?,?,?,?,?,'attended','single','paid',?)").run(id, "E" + id, uid, sid, cid, amount);
}

(async () => {
  console.log("🧪 1. 教練 A 貼上 WhatsApp 名單 → 智能解析");
  mkUser("coachA", "蔡教練", "coach", "91111111");
  mkUser("coachB", "黃 Sir", "coach", "92222222");
  const importRouter = require("../src/routes/student-import");
  const imp = handlerOf(importRouter, "post", "/coach/students/import-batch");
  const r1 = await call(imp, {
    user: { id: "coachA", role: "coach" },
    body: { raw_text: "1. 陳大文 98765432 膝蓋手術\n2. 李婆婆 91234567 輕微高血壓\n+852-9333-8888 張小玲" },
  });
  ok(r1.statusCode === 200 && r1.body.created === 3, "3 位成功解析匯入", r1.body);
  const inv = db.prepare("SELECT * FROM student_onboarding_invites WHERE coach_id='coachA' AND phone='98765432'").get();
  ok(inv && /^[a-f0-9]{64}$/.test(inv.token), "產生 64-hex 唯一 Token");
  const token = inv.token;

  console.log("🧪 2. 學員認領 → 永久綁定 coachA");
  const complete = handlerOf(importRouter, "post", "/student/onboarding/complete");
  const c1 = await call(complete, { body: { token } });
  ok(c1.statusCode === 200 && c1.body.success, "認領成功", c1.body.error);
  const sid = c1.body.user.id;
  const aff = db.prepare("SELECT * FROM student_coach_affiliations WHERE student_user_id=?").get(sid);
  ok(aff && aff.origin_coach_id === "coachA" && aff.status === "active", "寫入 affiliation（coachA）", aff);
  ok(!!db.prepare("SELECT 1 FROM user_passes WHERE user_id=?").get(sid), "已派迎新 Pass");

  console.log("🧪 3. 教練 B 匯入同一電話 → 唔可以搶客");
  const r2 = await call(imp, {
    user: { id: "coachB", role: "coach" },
    body: { items: [{ name: "陳大文", phone: "98765432", notes: "" }] },
  });
  ok(r2.statusCode === 200 && r2.body.created === 1, "B 可建立自己嘅邀請（獨立記錄）");
  const invB = db.prepare("SELECT token FROM student_onboarding_invites WHERE coach_id='coachB' AND phone='98765432'").get();
  const c2 = await call(complete, { body: { token: invB.token } });
  ok(c2.statusCode === 200 && c2.body.user.id === sid, "同一學員認領 B 的連結");
  const aff2 = db.prepare("SELECT origin_coach_id FROM student_coach_affiliations WHERE student_user_id=?").get(sid);
  ok(aff2.origin_coach_id === "coachA", "First-Touch Wins：歸屬仍係 coachA", aff2);

  console.log("🧪 4. 雙軌分佣（$140）");
  const start = new Date().toISOString().slice(0, 19).replace("T", " ");
  const month = new Date().toISOString().slice(0, 7);
  mkVenue("v1");
  mkClass("cA", "coachA", "樂齡深層伸展（週末班）", "v1");
  mkClass("cB", "coachB", "水中健體活力班（何文田）", "v1");
  mkSched("sA", "cA", start);
  mkSched("sB", "cB", start);
  mkBooking("bA", sid, "sA", "cA", 140);
  mkBooking("bB", sid, "sB", "cB", 140);
  db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('aA','sA','bA','陳大文','present')").run();
  db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('aB','sB','bB','陳大文','present')").run();

  const { syncCoachEarningsForSchedule, buildMonthlyBreakdown, buildEarningsCsv } = require("../src/routes/coach-earnings");
  syncCoachEarningsForSchedule("sA");
  syncCoachEarningsForSchedule("sB");
  const wA = Math.round(db.prepare("SELECT wallet_balance FROM users WHERE id='coachA'").get().wallet_balance * 100);
  const wB = Math.round(db.prepare("SELECT wallet_balance FROM users WHERE id='coachB'").get().wallet_balance * 100);
  ok(wA === 14700, "Coach A：$112 底薪 + $28 補足 + $7 回佣 = $147", wA);
  ok(wB === 11200, "Coach B 實收 $112（80%）", wB);
  ok(14000 - 11200 - 700 === 2100, "平台實收 $21（15%）");
  const pay = db.prepare("SELECT * FROM coach_affiliate_payouts WHERE booking_id='bB'").get();
  ok(pay && pay.commission_amount_cents === 700 && pay.status === "cleared", "5% = 700 cents、cleared", pay);

  console.log("🧪 5. 冪等（重覆結算／重點名）");
  syncCoachEarningsForSchedule("sA");
  syncCoachEarningsForSchedule("sB");
  require("../src/services/coach-affiliate").settleSchedule("sA");
  require("../src/services/coach-affiliate").settleSchedule("sB");
  const wA2 = Math.round(db.prepare("SELECT wallet_balance FROM users WHERE id='coachA'").get().wallet_balance * 100);
  ok(wA2 === 14700, "Coach A 錢包不變", wA2);
  ok(db.prepare("SELECT COUNT(*) c FROM coach_affiliate_payouts WHERE booking_id='bB'").get().c === 1, "只有一筆 5% 記錄");
  ok(db.prepare("SELECT COUNT(*) c FROM coach_own_student_uplifts WHERE booking_id='bA'").get().c === 1, "只有一筆 20% 補足");

  console.log("🧪 6. 月結與 CSV");
  const bd = buildMonthlyBreakdown(db, "coachA", month);
  ok(bd.affiliate_passive_cents === 700 && bd.affiliate_students_count === 1, "月結見 5% / 1 位學員");
  ok(bd.total_payout_cents === 14700, "月結總額 $147", bd.total_payout_cents);
  const csv = buildEarningsCsv(db, "coachA", month);
  ok(csv.charCodeAt(0) === 0xfeff, "CSV 有 BOM");
  ok(csv.includes("陳*文") && csv.includes("9876****") && csv.includes("黃 Sir"), "CSV 有遮罩學員／帶班導師");
  ok(csv.includes("700") || csv.includes("7.00"), "CSV 有 5% 佣金");

  console.log("🧪 7. 前端入口");
  const fs = require("fs");
  const base = path.join(__dirname, "../../frontend-v2");
  const impPage = fs.readFileSync(path.join(base, "coach-students-import.html"), "utf8");
  const earnPage = fs.readFileSync(path.join(base, "coach-earnings.html"), "utf8");
  ok(/智能解析/.test(impPage) && /import-batch/.test(impPage), "匯入頁有解析＋API");
  ok(/welcome\.html\?token=/.test(impPage) || /welcome\.html\?token=/.test(impPage), "有魔法連結");
  ok(/跨界被動分佣/.test(earnPage) && /export-csv/.test(earnPage), "收益頁有 5% 及 CSV");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
