#!/usr/bin/env node
/** test-coach-p1.js — 學員手冊（標籤/回覆/IDOR）＋ 收入月結 CSV */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p1-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const month = new Date().toISOString().slice(0, 7);
const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 90 * 60000);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('coach','c@t.hk','教練甲','90001111','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('coach2','c2@t.hk','教練乙','90002222','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('stu','s@t.hk','陳伯','91110001','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('other','o@t.hk','路人','91110009','user')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl','coach','樂齡伸展','樂齡',90,10,100,10,'active','青衣')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl',?,?,10,8,'available')").run(fmt(start), fmt(end));
db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference) VALUES ('b0','stu','cl','s1','attended','paid',100,'ZP-P0')").run();
for (let i = 1; i <= 7; i++) {
  db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference) VALUES (?,?,'cl','s1','attended','paid',100,?)").run(`b${i}`, i === 1 ? "stu" : "other", `ZP-P${i}`);
}
// attendances: 6 present, 1 absent_notified, 1 absent_unexcused
db.prepare("CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status TEXT, checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))").run();
for (let i = 0; i <= 5; i++) db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES (?,?,?,?,?)").run("a" + i, "s1", "b" + i, "學員", "present");
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a6','s1','b6','學員','absent_notified')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a7','s1','b7','學員','absent_unexcused')").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); }, send(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const hb = require("../src/routes/handbook-p1");
  const log = handlerOf(hb, "post", "/coach/handbook/log");
  const listCoach = handlerOf(hb, "get", "/coach/handbook/students/:sid");
  const listStudent = handlerOf(hb, "get", "/student/handbook/:sid");
  const reply = handlerOf(hb, "post", "/student/handbook/:id/reply");
  const coach = { id: "coach", role: "coach" }, stu = { id: "stu", role: "user" }, other = { id: "other", role: "user" };

  console.log("🧪 1. 手冊發佈");
  const photo = "data:image/png;base64," + Buffer.from("x").toString("base64");
  const h1 = await call(log, { user: coach, body: { session_id: "s1", student_id: "stu", comment: "膝關節伸展進步明顯，步態穩定。", tags: ["關節活動度提升", "防跌重心穩健"], homework: "每日 10 次坐站", photos: [photo] } });
  ok(h1.statusCode === 201 && h1.body.success, "新增手冊 201", JSON.stringify(h1.body).slice(0, 120));
  ok(/^[0-9a-f]{64}$/.test(h1.body.sha256 || ""), "有 SHA-256");
  const h2 = await call(log, { user: coach, body: { session_id: "s1", student_id: "stu", comment: "更新評語：今日表現更好。", tags: ["握法熟練"], homework: "" } });
  ok(h2.statusCode === 200 && h2.body.updated, "同班同學員再提交 → 更新");
  const badCoach = await call(log, { user: { id: "coach2", role: "coach" }, body: { session_id: "s1", student_id: "stu", comment: "亂入評語" } });
  ok(badCoach.statusCode === 403, "非此班教練 403", badCoach.statusCode);

  console.log("🧪 2. 學員查看 + 回覆 + IDOR");
  const v = await call(listStudent, { user: stu, params: { sid: "stu" } });
  ok(v.body.success && v.body.handbooks.length === 1, "學員見到 1 份", v.body.handbooks && v.body.handbooks.length);
  ok(v.body.handbooks[0].tags.length === 1 && v.body.handbooks[0].homework === "", "標籤/功課已更新");
  const vOther = await call(listStudent, { user: other, params: { sid: "stu" } });
  ok(vOther.statusCode === 403, "路人查看 403", vOther.statusCode);
  const rep = await call(reply, { user: stu, params: { id: h1.body.handbook_id }, body: { content: "多謝教練！" } });
  ok(rep.statusCode === 201, "學員回覆成功", rep.statusCode);
  const repOther = await call(reply, { user: other, params: { id: h1.body.handbook_id }, body: { content: "亂入" } });
  ok(repOther.statusCode === 403, "路人回覆 403", repOther.statusCode);
  const v2 = await call(listStudent, { user: stu, params: { sid: "stu" } });
  ok((v2.body.handbooks[0].replies || []).length === 1, "回覆已顯示");

  console.log("🧪 3. 收入月結");
  const earn = require("../src/routes/coach-earnings");
  const sum = handlerOf(earn, "get", "/earnings/summary");
  const csv = handlerOf(earn, "get", "/earnings/export-csv");
  const s = await call(sum, { user: coach, query: { month } });
  ok(s.body.total_attended_students === 7, "7 人計入（排 1 個請假）", s.body.total_attended_students);
  ok(Math.abs(s.body.total_earned - 560) < 0.001, "80% × $100 × 7 = $560", s.body.total_earned);
  ok(s.body.total_sessions === 1, "1 個班次", s.body.total_sessions);
  const s2 = await call(sum, { user: { id: "coach2", role: "coach" }, query: { month } });
  ok(s2.body.total_earned === 0 && s2.body.total_attended_students === 0, "其他教練見 0（隔離）");

  console.log("🧪 4. CSV");
  const c = await call(csv, { user: coach, query: { month } });
  ok(typeof c.body === "string" && c.body.charCodeAt(0) === 0xfeff, "有 UTF-8 BOM");
  ok(c.body.includes("收據/場次編號") && c.body.includes("樂齡伸展"), "有標題及課程");
  ok(c.body.includes("560.00"), "合計 560.00", c.body.split("\n").slice(-1)[0]);
  ok(c.body.split("\r\n").length >= 3, "有明細行");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
