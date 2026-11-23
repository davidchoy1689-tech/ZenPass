#!/usr/bin/env node
/** 教練學員名冊（v2）overview API tests */
process.env.JWT_SECRET = "roster-test-secret-roster-test-secret-roster-test-secret";
const os = require("os");
const path = require("path");
const fs = require("fs");

const tmp = path.join(os.tmpdir(), "zenpass-roster-admin-" + Date.now() + ".db");
process.env.DB_PATH = tmp;
require("../src/config/init-db")();
require("../src/config/update-db")();

const express = require("express");
const jwt = require("jsonwebtoken");
const { getDb } = require("../src/services/database");
const svc = require("../src/services/coach-students");
const db = getDb();
svc.ensureSchema(db);

let pass = 0, fail = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));

for (const c of ["coach_id TEXT", "coach_override_id TEXT", "title TEXT"]) {
  try { db.exec("ALTER TABLE class_schedules ADD COLUMN " + c); } catch (e) {}
}
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('co1','co1@t.hk','教練一','91110000','coach',1,1,0.8,0)").run();
for (const c of ["coach_id TEXT", "coach_override_id TEXT", "title TEXT"]) {
  try { db.exec("ALTER TABLE class_schedules ADD COLUMN " + c); } catch (e) {}
}
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('st1','st1@t.hk','陳學員','92220000','user',0,0,0,0)").run();
for (const c of ["coach_id TEXT", "coach_override_id TEXT", "title TEXT"]) {
  try { db.exec("ALTER TABLE class_schedules ADD COLUMN " + c); } catch (e) {}
}
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('u2','u2@t.hk','路人','93330000','user',0,0,0,0)").run();
db.prepare("INSERT INTO classes (id,title,coach_id,price_hkd,credits_cost,status,duration,category) VALUES ('c1','木柱班','co1',140,14,'active',90,'新興運動')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,coach_id,start_time,end_time,max_participants,status,title) VALUES ('s1','c1','co1',datetime('now','+1 day'),datetime('now','+1 day','+90 minutes'),8,'available','木柱班')").run();
for (const c of ["attendance_status TEXT", "checked_in_at TEXT", "updated_at TEXT", "parent_name TEXT", "parent_phone TEXT"]) {
  try { db.exec("ALTER TABLE bookings ADD COLUMN " + c); } catch (e) {}
}
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,amount,payment_status,status,group_size) VALUES ('b1','st1','s1','c1',140,'paid','confirmed',1)").run();
db.prepare(
  "INSERT INTO student_onboarding_invites (id,coach_id,student_name,phone,notes,tags,initial_pass_quota,token,status) VALUES ('inv1','co1','陳學員','92220000','','VIP',1,'tok','pending')",
).run();

const app = express();
app.use(express.json());
app.use("/api/coach", require("../src/routes/coach-roster-admin"));
const token = (id, role) => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const get = (p, tk) => fetch(base + p, { headers: tk ? { authorization: "Bearer " + tk } : {} }).then(async (r) => ({ status: r.status, data: await r.json() }));

  console.log("🧪 1. 教練讀取名冊總覽");
  const r1 = await get("/api/coach/roster/overview", token("co1", "coach"));
  ok(r1.status === 200 && r1.data.success, "200 success", r1.status);
  ok(r1.data.stats && r1.data.stats.students === 1, "學生數 1", r1.data.stats);
  ok(r1.data.stats.enrollments >= 1, "有報名紀錄", r1.data.stats.enrollments);
  ok(r1.data.sessions.length >= 1, "有課堂", r1.data.sessions.length);
  const en = (r1.data.enrollments || [])[0] || {};
  ok(en.student_name === "陳學員" && en.status === "booked" && en.title === "木柱班", "報名欄位正確", en);

  console.log("🧪 2. 權限");
  const r2 = await get("/api/coach/roster/overview", token("u2", "user"));
  ok(r2.status === 403, "非教練 403", r2.status);
  const r3 = await get("/api/coach/roster/overview");
  ok(r3.status === 401, "未登入 401", r3.status);

  console.log("🧪 3. 靜態頁面接線");
  const root = path.join(__dirname, "../..");
  const page = fs.readFileSync(path.join(root, "frontend-v2/coach-students-v2.html"), "utf8");
  ok(/\/coach\/roster\/overview/.test(page), "頁面呼叫 overview API");
  ok(/\/coach\/attendance\/batch/.test(page) && /\/coach\/students/.test(page), "簽到／新增學生接現有 API");
  ok(/api\.js\?v=19/.test(page), "使用 api.js v19");
  const hub = fs.readFileSync(path.join(root, "frontend-v2/coach-hub.html"), "utf8");
  ok(/coach-students-v2\.html/.test(hub), "coach-hub 有入口");

  server.close();
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.log(fail === 0 ? `\n🎉 全部通過（${pass} 項）` : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
});
