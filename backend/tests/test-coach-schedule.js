#!/usr/bin/env node
/** test-coach-schedule.js — 更表 / 鎖時段 / 代堂申請 */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-sched-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const start = new Date(Date.now() + 5 * 864e5), end = new Date(Date.now() + 5 * 864e5 + 5400000);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','教練甲','90001111','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c2','c2@t.hk','教練乙','90002222','coach')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','c1','樂齡伸展','樂齡',90,10,140,14,'active','青衣')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1',?,?,10,2,'available')").run(fmt(start), fmt(end));

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { query = {}, body = {}, user = null }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ query, body, user, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/coach-schedule");
  const get = handlerOf(router, "get", "/schedule");
  const lock = handlerOf(router, "post", "/schedules/lock-slot");
  const sub = handlerOf(router, "post", "/schedules/substitute");
  const coach = { id: "c1", role: "coach" };

  const g = await call(get, { user: coach, query: {} });
  ok(g.body.success && g.body.sessions.length === 1, "讀到 1 個班次", g.body.sessions && g.body.sessions.length);
  ok(Array.isArray(g.body.locks) && Array.isArray(g.body.substitutions), "回傳 locks/substitutions");

  const badLock = await call(lock, { user: coach, body: { start_time: "2026-11-10 10:00:00", end_time: "2026-11-10 09:00:00" } });
  ok(badLock.statusCode === 400, "無效時間 400");
  const lk = await call(lock, { user: coach, body: { start_time: "2026-11-10 10:00:00", end_time: "2026-11-10 12:00:00", reason: "休假" } });
  ok(lk.body.success && lk.body.lock_id, "鎖時段成功");
  const g2 = await call(get, { user: coach, query: {} });
  ok(g2.body.locks.length === 1, "locks 已回傳");

  const badTarget = await call(sub, { user: coach, body: { session_id: "s1", target_coach_id: "nope" } });
  ok(badTarget.statusCode === 400, "無效教練 400");
  const sr = await call(sub, { user: coach, body: { session_id: "s1", target_coach_id: "c2", reason: "身體不適" } });
  ok(sr.body.success && sr.body.status === "pending", "代堂申請 pending");
  const row = db.prepare("SELECT status FROM coach_substitution_requests WHERE id=?").get(sr.body.request_id);
  ok(row && row.status === "pending", "DB 有申請紀錄");
  const other = await call(sub, { user: { id: "c2", role: "coach" }, body: { session_id: "s1", target_coach_id: "c1" } });
  ok(other.statusCode === 404, "非自己班次 404");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
