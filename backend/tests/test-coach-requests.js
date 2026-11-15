/**
 * 教練取消／改期申請 + 重複開班（2026-11-16）
 */
process.env.JWT_SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8";
const path = require("path"), os = require("os");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-cr-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

// stub auth
const authPath = require.resolve("../src/middleware/auth");
const real = Object.assign({}, require(authPath));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: Object.assign({}, real, {
    authenticateToken: (req, _r, next) => { req.user = global.__me; next(); },
    requirePermission: () => (_q, _r, next) => next(),
  }),
};

const express = require(path.join(__dirname, "..", "node_modules", "express"));
const reqRouter = require("../src/routes/coach-requests");
const schedRouter = require("../src/routes/coach-scheduling");
const app = express();
app.use("/api", reqRouter);
app.use("/api/coach", schedRouter);
const server = app.listen(0);
const port = server.address().port;

const post = (u, body) => fetch(`http://127.0.0.1:${port}${u}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (u) => fetch(`http://127.0.0.1:${port}${u}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

for (const col of ["target_audience_enum TEXT", "target_audience_label TEXT", "venue_name TEXT", "district TEXT", "min_participants INTEGER DEFAULT 1", "price_hkd REAL", "category TEXT", "venue_address TEXT", "coach_id TEXT"]) {
  try { db.exec("ALTER TABLE classes ADD COLUMN " + col); } catch (e) {}
}
db.prepare("INSERT INTO users (id,email,name,role,is_coach,coach_verified) VALUES ('coach','c@t.hk','教練','coach',1,1)").run();
db.prepare("INSERT INTO users (id,email,name,role,is_coach,coach_verified) VALUES ('coach2','c2@t.hk','其他教練','coach',1,1)").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('admin1','a@t.hk','營運','super_admin')").run();
for (const col of ["booking_open INTEGER DEFAULT 1", "status TEXT DEFAULT 'available'", "coach_override_id TEXT", "studio_id TEXT", "district TEXT", "created_at TEXT"]) {
  try { db.exec("ALTER TABLE class_schedules ADD COLUMN " + col); } catch (e) {}
}
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,max_participants) VALUES ('cl','coach','伸展班','樂齡',60,140,'active',8)").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl',?,?,8,1,'available')").run(iso(48), iso(50));
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('stu','s@t.hk','學生','user')").run();
db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','R1','stu','s1','cl','confirmed','paid',140)").run();

(async () => {
  console.log("\n🧪 1. 教練提交申請");
  global.__me = { id: "coach", role: "coach" };
  let r = await post("/api/coach/change-requests", { type: "cancel_session", schedule_id: "s1", reason: "場地臨時維修" });
  ok(r.status === 201, "取消申請 201", JSON.stringify(r.body));
  const rid = r.body.id;

  r = await post("/api/coach/change-requests", { type: "cancel_session", schedule_id: "s1", reason: "重複申請" });
  ok(r.status === 409 && r.body.code === "DUPLICATE", "重複申請 → 409", r.body.code);

  global.__me = { id: "coach2", role: "coach" };
  r = await post("/api/coach/change-requests", { type: "cancel_session", schedule_id: "s1", reason: "唔係我堂" });
  ok(r.status === 403, "非該堂教練 → 403", String(r.status));

  global.__me = { id: "coach", role: "coach" };
  r = await post("/api/coach/change-requests", { type: "reschedule", schedule_id: "s1", reason: "希望改期到晚上", preferred_time: "11/25 晚上" });
  ok(r.status === 409, "已有 pending → 改期都擋", String(r.status));

  r = await get("/api/coach/change-requests");
  ok(r.status === 200 && r.body.requests.length === 1, "教練睇到自己申請", r.body.requests && r.body.requests.length);

  console.log("\n🧪 2. 營運審批");
  global.__me = { id: "admin1", role: "super_admin" };
  r = await get("/api/admin/coach-change-requests?status=pending");
  ok(r.status === 200 && r.body.requests.length === 1, "營運見到 pending", r.body.requests && r.body.requests.length);
  ok(r.body.requests[0].booked === 1, "顯示已報人數", r.body.requests[0] && r.body.requests[0].booked);

  const rej = await post(`/api/admin/coach-change-requests/${rid}/reject`, { note: "" });
  ok(rej.status === 400, "駁回必須填原因", String(rej.status));

  const app1 = await post(`/api/admin/coach-change-requests/${rid}/approve`, {});
  ok(app1.status === 200 && app1.body.success, "批准成功", JSON.stringify(app1.body).slice(0, 160));
  const sch = db.prepare("SELECT status FROM class_schedules WHERE id='s1'").get();
  ok(sch.status === "cancelled", "班次已取消", sch.status);
  const bk = db.prepare("SELECT status FROM bookings WHERE id='b1'").get();
  ok(bk.status === "cancelled", "學生預約已取消", bk.status);

  console.log("\n🧪 3. 重複開班（4 週）");
  global.__me = { id: "coach", role: "coach" };
  const start = new Date(Date.now() + 5 * 864e5); start.setHours(11, 0, 0, 0);
  const end = new Date(start.getTime() + 3600e3);
  const series = await post("/api/coach/schedules/create-series", {
    course_title: "每週伸展班", target_audience_enum: "elderly", target_audience_label: "熟齡防跌",
    venue_name: "青衣楓樹窩體育館", district: "青衣",
    start_time: start.toISOString(), end_time: end.toISOString(),
    capacity: 8, price_per_class_cents: 14000, repeat_weeks: 4,
  });
  console.log("   series:", series.status, JSON.stringify(series.body).slice(0, 200));
  ok(series.status === 201 && (series.body.created || []).length === 4, "成功開 4 週", JSON.stringify(series.body).slice(0, 160));
  const cnt = db.prepare("SELECT COUNT(*) c FROM class_schedules cs JOIN classes c ON c.id=cs.class_id WHERE c.title LIKE '每週伸展班%'").get().c;
  ok(cnt === 4, "DB 有 4 個時段", String(cnt));

  console.log("\n🧪 4. 死 API 已修");
  const proof = require("fs").readFileSync(path.join(__dirname, "..", "src", "routes", "coach.js"), "utf8");
  ok(!/from\("coaches"\)/.test(proof), "GET /profile 已改 SQLite");
  ok(/ENDPOINT_RETIRED/.test(proof), "POST /profile 明確退役");

  server.close();
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
