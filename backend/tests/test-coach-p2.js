#!/usr/bin/env node
/** test-coach-p2.js — 公告 CRUD + 權限 + 學生查詢 + URL encode */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ann-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const start = new Date(Date.now() + 2 * 864e5), end = new Date(start.getTime() + 90 * 60000);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','教練甲','90001111','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c2','c2@t.hk','教練乙','90002222','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u1','u1@t.hk','學員','91110001','user')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','c1','樂齡伸展','樂齡',90,10,140,14,'active','青衣')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1',?,?,10,1,'available')").run(fmt(start), fmt(end));

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/coach-announcements");
  const post = handlerOf(router, "post", "/coach/announcements");
  const list = handlerOf(router, "get", "/coach/announcements");
  const del = handlerOf(router, "delete", "/coach/announcements/:id");
  const put = handlerOf(router, "put", "/coach/announcements/:id");
  const stu = handlerOf(router, "get", "/student/announcements");
  const c1 = { id: "c1", role: "coach" }, c2 = { id: "c2", role: "coach" }, u = { id: "u1", role: "user" };

  console.log("🧪 1. 路由安全（無全局 middleware）");
  ok(router.stack[0].route, "第一層就係 route，冇全局 auth 攔截");

  console.log("🧪 2. 建立 / 查詢");
  const p1 = await call(post, { user: c1, body: { title: "🌧️ 天氣通知", content: "八號風球，課堂暫停。\n堂數保留。", target_type: "session_specific", target_id: "s1", template_type: "weather", is_pinned: true } });
  ok(p1.statusCode === 201 && p1.body.success, "建立公告 201", p1.statusCode);
  const id = p1.body.announcement.id;
  const l1 = await call(list, { user: c1 });
  ok(l1.body.announcements.length === 1 && l1.body.announcements[0].is_pinned === 1, "教練見到置頂公告");
  const l2 = await call(list, { user: c2 });
  ok(l2.body.announcements.length === 0, "其他教練見唔到");
  const cross = await call(post, { user: c2, body: { title: "亂入", content: "亂入內容", target_type: "session_specific", target_id: "s1" } });
  ok(cross.statusCode === 403, "其他教練不可對他人班次發公告", cross.statusCode);

  console.log("🧪 3. 學生查詢");
  const s1 = await call(stu, { user: u, query: { session_id: "s1" } });
  ok(s1.body.success && s1.body.announcements.length === 1, "學生見到該班公告", s1.body.announcements && s1.body.announcements.length);
  ok(s1.body.announcements[0].coach_name === "教練甲", "有教練署名");
  const s2 = await call(stu, { user: u, query: { session_id: "" } });
  ok(s2.body.announcements.length === 0, "無 session/course 唔會洩漏任何公告");

  console.log("🧪 4. 編輯公告（PUT）");
  const up1 = await call(put, { user: c1, params: { id }, body: { title: "🌧️ 天氣通知（更新）", content: "改為明日復課。", is_pinned: false } });
  ok(up1.statusCode === 200 && up1.body.announcement.title.includes("更新"), "本人可更新", up1.statusCode);
  ok(up1.body.announcement.is_pinned === 0, "可取消置頂");
  const upBad = await call(put, { user: c1, params: { id }, body: { title: "x", content: "y" } });
  ok(upBad.statusCode === 400, "太短標題 → 400", upBad.statusCode);
  const upOther = await call(put, { user: c2, params: { id }, body: { title: "亂改", content: "亂改內容" } });
  ok(upOther.statusCode === 404, "其他教練改 → 404", upOther.statusCode);
  const s3 = await call(stu, { user: u, query: { session_id: "s1" } });
  ok(s3.body.announcements[0].content === "改為明日復課。", "學員即時見到更新內容");

  console.log("🧪 5. 刪除權限（IDOR）");
  const dOther = await call(del, { user: c2, params: { id } });
  ok(dOther.statusCode === 404, "其他教練刪除 → 404");
  const d1 = await call(del, { user: c1, params: { id } });
  ok(d1.body.success, "本人刪除成功");

  console.log("🧪 6. WhatsApp URL Encode");
  const text = "🌧️ 天氣通知\n\n八號風球，課堂暫停，堂數保留。";
  const url = "https://wa.me/?text=" + encodeURIComponent(text);
  ok(decodeURIComponent(url.split("text=")[1]) === text, "Emoji + 換行可完整還原");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
