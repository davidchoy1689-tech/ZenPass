#!/usr/bin/env node
/**
 * test-session-title.js — 時段顯示名稱（可編輯）
 * 覆蓋：
 *   1) POST /coach/schedules 帶 title → 存 DB，GET /sessions 回傳自訂名（class_title 保留課程名）
 *   2) POST 唔帶 title → 回傳 fallback 課程名
 *   3) title 超過 60 字 → 截短
 *   4) PATCH /coach/schedules/:id 改名 → 生效
 *   5) PATCH title=null / 空白 → 還原跟課程名
 *   6) 非本人班次 → 403
 *   7) 不存在班次 → 404
 */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-test-secret";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-title-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));
initDatabase(); updateDatabase();

const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");

const start = new Date(Date.now() + 6 * 864e5);
const end = new Date(start.getTime() + 90 * 60000);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','教練甲','90001111','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c2','c2@t.hk','教練乙','90002222','coach')").run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','c1','樂齡伸展','樂齡',90,10,140,14,'active','青衣')",
).run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl2','c2','地板冰壺','新興運動',90,10,160,16,'active','荃灣')",
).run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { query = {}, body = {}, user = null, params = {} }) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); },
    };
    try { h({ query, body, user, params, headers: {}, ip: "127.0.0.1" }, res); }
    catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
  });

(async () => {
  const router = require("../src/routes/coach");
  const post = handlerOf(router, "post", "/schedules");
  const patch = handlerOf(router, "patch", "/schedules/:id");
  const getSessions = handlerOf(router, "get", "/sessions");
  const coach = { id: "c1", role: "coach" };
  const other = { id: "c2", role: "coach" };

  ok(!!post && !!patch && !!getSessions, "路由存在（POST/GET/PATCH）");

  // 1) 建立帶自訂名嘅時段
  const r1 = await call(post, {
    user: coach,
    body: {
      class_id: "cl1", title: "週末加強班",
      start_time: start.toISOString(), end_time: end.toISOString(),
      max_participants: 8,
    },
  });
  ok(r1.body.success === true, "建立時段成功", r1.body);
  const sid1 = (r1.body.schedule_ids || [])[0];
  ok(!!sid1, "有回傳 schedule id");

  const row1 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid1);
  ok(row1 && row1.title === "週末加強班", "DB title 寫入正確", row1);

  // 2) GET /sessions → title = 自訂，class_title = 課程名
  const g1 = await call(getSessions, { user: coach, query: { filter: "upcoming" } });
  const s1 = (g1.body.sessions || g1.body.data || []).find((x) => x.id === sid1);
  ok(s1 && s1.title === "週末加強班", "GET /sessions 顯示自訂名", s1 && s1.title);
  ok(s1 && s1.class_title === "樂齡伸展", "class_title 保留課程名", s1 && s1.class_title);

  // 3) 唔帶 title → fallback 課程名
  const r2 = await call(post, {
    user: coach,
    body: {
      class_id: "cl1",
      start_time: new Date(start.getTime() + 864e5).toISOString(),
      end_time: new Date(end.getTime() + 864e5).toISOString(),
      max_participants: 8,
    },
  });
  const sid2 = (r2.body.schedule_ids || [])[0];
  const row2 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid2);
  ok(row2 && row2.title === null, "無 title → DB 存 NULL", row2);
  const g2 = await call(getSessions, { user: coach, query: {} });
  const s2 = (g2.body.sessions || g2.body.data || []).find((x) => x.id === sid2);
  ok(s2 && s2.title === "樂齡伸展", "無 title → 回傳課程名", s2 && s2.title);

  // 4) 超長名稱截 60 字
  const long = "長".repeat(80);
  await call(patch, { user: coach, params: { id: sid2 }, body: { title: long } });
  const row3 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid2);
  ok(row3 && row3.title && row3.title.length === 60, "超長名稱截到 60 字", row3 && row3.title.length);

  // 5) 改名成功
  const p1 = await call(patch, { user: coach, params: { id: sid1 }, body: { title: "晚間進階班" } });
  ok(p1.body.success === true, "PATCH 改名成功", p1.body);
  const row4 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid1);
  ok(row4 && row4.title === "晚間進階班", "DB 已更新", row4);

  // 6) title=null → 還原跟課程名
  const p2 = await call(patch, { user: coach, params: { id: sid1 }, body: { title: null } });
  const row5 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid1);
  ok(row5 && row5.title === null, "title=null → 還原 NULL", row5);
  ok(p2.body.data && p2.body.data.title === "樂齡伸展", "回傳 fallback 課程名", p2.body.data);

  // 7) 空白字串 → NULL
  await call(patch, { user: coach, params: { id: sid1 }, body: { title: "   " } });
  const row6 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid1);
  ok(row6 && row6.title === null, "空白 → NULL", row6);

  // 8) 他人班次 → 403
  const p3 = await call(patch, { user: other, params: { id: sid1 }, body: { title: "偷改名" } });
  ok(p3.statusCode === 403, "非本人班次 403", p3.statusCode);
  const row7 = db.prepare("SELECT title FROM class_schedules WHERE id=?").get(sid1);
  ok(row7 && row7.title === null, "403 無改動", row7);

  // 9) 不存在 → 404
  const p4 = await call(patch, { user: coach, params: { id: "nope" }, body: { title: "x" } });
  ok(p4.statusCode === 404, "不存在班次 404", p4.statusCode);

  // 10) 管理員可改他人班次
  const admin = { id: "adm", role: "super_admin" };
  const p5 = await call(patch, { user: admin, params: { id: sid1 }, body: { title: "管理員改名" } });
  ok(p5.body.success === true, "管理員可改名", p5.body);

  // 11) 名額編輯：不可少過已報名人數（group_size 計）
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u1','u1@t.hk','學員甲','90003333','user')").run();
  db.prepare(
    "INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,group_size) VALUES ('b1','u1',?,'cl1','confirmed','paid',3)",
  ).run(sid1);
  const capLow = await call(patch, { user: coach, params: { id: sid1 }, body: { max_participants: 2 } });
  ok(capLow.statusCode === 409, "名額少過已報名 → 409", capLow.body);
  const capBad = await call(patch, { user: coach, params: { id: sid1 }, body: { max_participants: 300 } });
  ok(capBad.statusCode === 400, "名額超上限 → 400", capBad.body);
  const capOk = await call(patch, { user: coach, params: { id: sid1 }, body: { max_participants: 5 } });
  ok(capOk.body.success === true, "名額提高成功", capOk.body);
  ok(Number(db.prepare("SELECT max_participants FROM class_schedules WHERE id=?").get(sid1).max_participants) === 5, "DB 名額已更新");

  // 12) 名稱＋名額一次更新
  const both = await call(patch, { user: coach, params: { id: sid1 }, body: { title: "雙改", max_participants: 6 } });
  ok(both.body.success === true && both.body.data.max_participants === 6, "名稱＋名額同時更新", both.body);

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
