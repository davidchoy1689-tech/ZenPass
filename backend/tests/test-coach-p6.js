#!/usr/bin/env node
/** test-coach-p6.js — 現場補錄、健康警示、批次手冊、地圖、勾選廣播 */
const fs = require("fs"), os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p6-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const root = path.join(__dirname, "../../frontend-v2");
const roster = fs.readFileSync(path.join(root, "coach-roster.html"), "utf8");
const handbook = fs.readFileSync(path.join(root, "coach-handbook.html"), "utf8");
const schedule = fs.readFileSync(path.join(root, "coach-schedule.html"), "utf8");
const ann = fs.readFileSync(path.join(root, "coach-announcements.html"), "utf8");

db.exec(`CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status TEXT, checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`);

db.prepare("INSERT INTO users (id,email,name,role) VALUES ('coach','c@t.hk','教練','coach')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('coach2','c2@t.hk','其他教練','coach')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('u1','u1@t.hk','學員一','user')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('u2','u2@t.hk','學員二','user')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,max_participants) VALUES ('cl1','coach','樂齡深層伸展','樂齡',90,140,'active',8)").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1','2026-12-01T02:00:00.000Z','2026-12-01T03:30:00.000Z',2,2,'available')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','cl1','2026-12-08T02:00:00.000Z','2026-12-08T03:30:00.000Z',8,0,'available')").run();
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','u1','s1','cl1','confirmed','paid',140)").run();
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b2','u2','s1','cl1','confirmed','paid',140)").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/coach-walkin");
  const walkin = handlerOf(router, "post", "/attendance/walk-in");
  ok(!!walkin, "walk-in handler 存在");

  console.log("🧪 1. 權限");
  const denied = await call(walkin, { user: { id: "coach2", role: "coach" }, body: { session_id: "s2", student_name: "陳大文", contact_phone: "98765432", payment_method: "cash" } });
  ok(denied.statusCode === 403, "其他教練 → 403", denied.statusCode);
  const userTry = await call(walkin, { user: { id: "u1", role: "user" }, body: { session_id: "s2", student_name: "陳大文", contact_phone: "98765432" } });
  ok(userTry.statusCode === 403, "學員 → 403");

  console.log("🧪 2. 額滿硬擋");
  const full = await call(walkin, { user: { id: "coach", role: "coach" }, body: { session_id: "s1", student_name: "陳大文", contact_phone: "98765432", payment_method: "cash" } });
  ok(full.statusCode === 409 && full.body.code === "CLASS_FULL", "8/8（此班 2/2）→ 409 CLASS_FULL", full.body);

  console.log("🧪 3. 補錄成功");
  const r1 = await call(walkin, { user: { id: "coach", role: "coach" }, body: { session_id: "s2", student_name: "陳大文", contact_phone: "98765432", payment_method: "cash", notes: "婆婆朋友，膝痛" } });
  ok(r1.statusCode === 201 && r1.body.success, "201 成功", r1.statusCode);
  const bk = db.prepare("SELECT * FROM bookings WHERE id=?").get(r1.body.booking_id);
  ok(bk && bk.is_walkin === 1 && bk.status === "confirmed" && bk.payment_status === "paid" && bk.payment_method === "walkin_cash" && bk.collected_by === "coach", "booking 標記 walk-in + 已付 + coach collected");
  ok(bk.amount === 140, "金額 = 課程價 $140", bk.amount);
  const at = db.prepare("SELECT * FROM attendances WHERE booking_id=?").get(r1.body.booking_id);
  ok(at && at.status === "present", "已自動簽到 present");
  ok(db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s2'").get().enrolled_count === 1, "enrolled_count +1");
  const user = db.prepare("SELECT id,name,phone FROM users WHERE phone='98765432'").get();
  ok(!!user && user.name === "陳大文", "自動建立／重用學員帳號");

  console.log("🧪 4. 重複電話重用帳號");
  const r2 = await call(walkin, { user: { id: "coach", role: "coach" }, body: { session_id: "s2", student_name: "陳大文", contact_phone: "98765432", payment_method: "fps_direct" } });
  ok(r2.statusCode === 409 && r2.body.code === "ALREADY_BOOKED", "同一人重複補錄 → 409", r2.body);
  ok(db.prepare("SELECT COUNT(*) c FROM users WHERE phone='98765432'").get().c === 1, "唔會重複建帳號");
  const r3 = await call(walkin, { user: { id: "coach", role: "coach" }, body: { session_id: "s2", student_name: "李婆婆", contact_phone: "91234567", payment_method: "cash" } });
  ok(r3.statusCode === 201 && r3.body.amount === 140, "第二位（另一電話）成功", r3.body);
  ok(db.prepare("SELECT COUNT(*) c FROM bookings WHERE schedule_id='s2'").get().c === 2, "名單有 2 筆");

  console.log("🧪 4b. 扣 Pass + 現場辨識");
  const passesSvc = require("../src/services/passes");
  passesSvc.ensureSchema(db);
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u3','u3@t.hk','黃志明','93334444','user')").run();
  const exp = new Date(Date.now() + 30 * 864e5).toISOString().replace("T", " ").slice(0, 19);
  db.prepare("INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at) VALUES ('wp1','u3','93334444','黃志明',2,2,0,'active',?)").run(exp);
  db.exec(`CREATE TABLE IF NOT EXISTS student_onboarding_invites (id TEXT PRIMARY KEY, coach_id TEXT, student_name TEXT, phone TEXT, notes TEXT, token TEXT, status TEXT, created_at TEXT)`);
  db.prepare("INSERT INTO student_onboarding_invites (id,coach_id,student_name,phone,notes,token,status,created_at) VALUES ('iv1','coach','黃志明','93334444','膝蓋手術 2025','" + "b".repeat(64) + "','claimed',datetime('now'))").run();
  db.prepare("INSERT INTO student_coach_affiliations (student_user_id,origin_coach_id) VALUES ('u3','coach')").run();

  const lookup = handlerOf(require("../src/routes/coach-walkin"), "get", "/students/lookup");
  const lk = await call(lookup, { user: { id: "coach", role: "coach" }, query: { phone: "93334444", session_id: "s2" } });
  ok(lk.statusCode === 200 && lk.body.pass_remaining === 2, "lookup 見到 2 堂", lk.body);
  ok(lk.body.is_own_student === true && /膝蓋手術/.test(lk.body.health_notes), "lookup 見到自有＋舊患", lk.body);

  const r4 = await call(walkin, { user: { id: "coach", role: "coach" }, body: { session_id: "s2", student_name: "黃志明", contact_phone: "93334444", payment_method: "pass", notes: "膝部活動度良好" } });
  ok(r4.statusCode === 201 && r4.body.payment_method === "pass" && r4.body.amount === 0, "扣 Pass 入場", r4.body);
  ok(db.prepare("SELECT remaining_credits FROM user_passes WHERE id='wp1'").get().remaining_credits === 1, "Pass 2→1");
  ok(!!db.prepare("SELECT 1 FROM pass_redemptions WHERE pass_id='wp1' AND booking_id=?").get(r4.body.booking_id), "有 redemption 紀錄");
  ok(!!db.prepare("SELECT 1 FROM student_handbooks WHERE booking_id=?").get(r4.body.booking_id), "備註寫入手冊");

  console.log("🧪 5. 計入月結");
  const { buildMonthlyBreakdown } = require("../src/routes/coach-earnings");
  const m = buildMonthlyBreakdown(db, "coach", "2026-12");
  ok(m.total_sessions === 1, "1 個班次", m.total_sessions);
  const row2 = m.sessions_breakdown.find((x) => x.session_id === "s2");
  ok(row2 && row2.attended_count === 3, "出席 3 人", row2 && row2.attended_count);
  ok(m.total_earned === 364, "3 堂價值 ×80% + 自有 20% 補足 = $364", m.total_earned);

  console.log("🧪 6. 前端檢查");
  ok(/walkinBtn/.test(roster) && /schedules\/.*walkin/.test(roster), "點名冊有現場補錄掣 + API");
  ok(/wiLookup/.test(roster) && /students\/lookup/.test(roster), "現場電話辨識");
  ok(/扣 1 堂 Pass/.test(roster) && /CLASS_FULL/.test(roster), "扣堂＋滿額確認");
  ok(/r-danger/.test(roster) && /舊患注意/.test(roster), "健康高危紅色徽章");
  ok(/心臟\|心管\|血壓\|手術\|膝/.test(roster), "關鍵字判定（心臟／血壓／膝／手術）");
  ok(/hb-qbtn/.test(handbook) && /快速全班套用/.test(handbook), "手冊批次套用工具列");
  ok(/google\.com\/maps\/search\/\?api=1&query=/.test(schedule), "更表有 Google Maps 導航");
  ok(/ph-chk/.test(ann) && /selectedPhones/.test(ann), "公告有學員勾選");
  ok(/list\.length === 1/.test(ann) && /wa\.me\/852/.test(ann), "單選時私訊該學員");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
