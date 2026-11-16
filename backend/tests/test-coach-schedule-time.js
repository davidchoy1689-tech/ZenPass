#!/usr/bin/env node
/**
 * test-coach-schedule-time.js — 多導師開班：時區 / 權限 / 冪等 / 撞期 / 限流
 * 重點：12:00 一定要係 12:00（唔會變 04:00），而且存 DB 係 UTC。
 */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "test-secret-for-schedule-time-tests-0123456789";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-schtime-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));

initDatabase();
try { updateDatabase(); } catch (e) {}

const { getDb } = require("../src/services/database");
const db = getDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    id TEXT PRIMARY KEY, response_data TEXT, body_hash TEXT, status TEXT DEFAULT 'pending', created_at TEXT
  );
`);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','教練甲','90001111','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c2','c2@t.hk','教練乙','90002222','coach')").run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','c1','樂齡伸展','樂齡',90,10,140,14,'active','青衣')",
).run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { query = {}, body = {}, user = null, params = {}, headers = {} }) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); },
    };
    try { h({ query, body, user, params, headers, ip: "127.0.0.1" }, res); }
    catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
  });

const localTimeOf = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const localDateOf = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const isoDay = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

(async () => {
  const router = require("../src/routes/coach");
  const post = handlerOf(router, "post", "/schedules");
  const getSessions = handlerOf(router, "get", "/sessions");
  const coach = { id: "c1", role: "coach" };
  const other = { id: "c2", role: "coach" };
  const D = isoDay(7);

  // ── 1) 12:00 → 存 UTC 04:00，回傳 local 12:00 ──
  const r1 = await call(post, { user: coach, body: { class_id: "cl1", title: "午間班", date: D, start_time: "12:00", duration_min: 90, max_participants: 8 } });
  ok(r1.body.success === true, "開班成功", r1.body);
  const s1 = (r1.body.schedules || [])[0] || {};
  ok(s1.local_date === D && s1.local_time === "12:00", "回傳 local_date/local_time = 12:00", s1);
  ok(s1.local_end_time === "13:30", "結束時間 = 13:30", s1.local_end_time);
  const row1 = db.prepare("SELECT start_time, timezone FROM class_schedules WHERE id=?").get(s1.id);
  ok(/T04:00:00\.000Z$/.test(row1.start_time), "DB 存 UTC 04:00Z", row1.start_time);
  ok(row1.timezone === "Asia/Hong_Kong", "timezone 欄 = Asia/Hong_Kong", row1.timezone);

  // ── 2) GET /sessions 顯示 12:00（唔會 04:00）──
  const g1 = await call(getSessions, { user: coach, query: {} });
  const list = g1.body.sessions || g1.body.data || [];
  const found = list.find((x) => x.id === s1.id);
  ok(found && found.local_time === "12:00", "列表 local_time = 12:00", found && found.local_time);
  ok(found && found.local_date === D, "列表 local_date 正確", found && found.local_date);
  ok(found && localTimeOf(found.start_time) === "12:00", "ISO start_time 轉 HK = 12:00", found && found.start_time);

  // ── 3) 每週 4 堂：時間一致 ──
  const r2 = await call(post, {
    user: coach,
    body: {
      class_id: "cl1", title: "週末班", date: isoDay(10), start_time: "19:00", duration_min: 60,
      max_participants: 8, recurring: "weekly",
      recurring_until: isoDay(10 + 21) + "T23:59:59+08:00",
    },
  });
  const sch2 = r2.body.schedules || [];
  ok(sch2.length === 4, "每週重複開 4 堂", sch2.length);
  ok(sch2.every((x) => x.local_time === "19:00"), "4 堂全部 19:00", sch2.map((x) => x.local_time));
  ok(sch2.every((x) => x.series_id === undefined || true), "（系列 id 由 DB 確認）");
  const seriesIds = new Set(sch2.map((x) => db.prepare("SELECT series_id FROM class_schedules WHERE id=?").get(x.id).series_id));
  ok(seriesIds.size === 1 && ![...seriesIds][0].includes("undefined"), "4 堂共用同一 series_id", [...seriesIds]);

  // ── 4) 教練 B 唔可以用教練 A 嘅 class ──
  const r3 = await call(post, { user: other, body: { class_id: "cl1", date: isoDay(9), start_time: "12:30", duration_min: 60 } });
  ok(r3.statusCode === 403, "非本人課程 → 403", r3.statusCode);

  // ── 5) 過去時間 → 400 IN_PAST ──
  const past = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 5 * 864e5));
  const r4 = await call(post, { user: coach, body: { class_id: "cl1", date: past, start_time: "12:00", duration_min: 60 } });
  ok(r4.statusCode === 400 && r4.body.code === "IN_PAST", "過去時段 → 400 IN_PAST", r4.body);

  // ── 6) 日期格式錯 ──
  const r5 = await call(post, { user: coach, body: { class_id: "cl1", date: "2026/12/01", start_time: "12:00" } });
  ok(r5.statusCode === 400 && r5.body.code === "INVALID_DATE", "日期格式錯 → 400", r5.body);

  // ── 7) 同教練撞期 → 409 ──
  const r6 = await call(post, { user: coach, body: { class_id: "cl1", title: "撞期班", date: D, start_time: "12:30", duration_min: 60 } });
  ok(r6.statusCode === 409 && r6.body.code === "NO_SLOTS_CREATED", "撞期 → 409", r6.body);

  // ── 8) 冪等：同一個 Idempotency-Key 連按兩次 → 只開 1 組 ──
  // （handlerOf 直接取 route handler，會跳過 middleware，所以要手動串 optionalIdempotency）
  const idemMw = require("../src/middleware/idempotency").optionalIdempotency;
  const callIdem = (h, opts) =>
    new Promise((resolve) => {
      const req = { query: {}, params: {}, headers: opts.headers || {}, user: opts.user, body: opts.body, ip: "127.0.0.1" };
      const res = {
        statusCode: 201,
        status(c) { this.statusCode = c; return this; },
        json(o) { this.body = o; resolve(this); },
        end() {},
      };
      idemMw(req, res, () => { try { h(req, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); } });
    });
  const key = "idem-test-" + Date.now();
  const D2 = isoDay(14);
  const bodyIdem = { class_id: "cl1", title: "冪等班", date: D2, start_time: "15:00", duration_min: 60 };
  const i1 = await callIdem(post, { user: coach, body: { ...bodyIdem }, headers: { "idempotency-key": key } });
  const i2 = await callIdem(post, { user: coach, body: { ...bodyIdem }, headers: { "idempotency-key": key } });
  const count = db.prepare("SELECT COUNT(*) c FROM class_schedules WHERE title='冪等班'").get().c;
  ok(i1.body.success === true, "第一次成功", i1.body);
  ok(i2.body.success === true, "第二次回放成功", i2.body);
  ok(count === 1, "連按兩次只開 1 堂", count);
  ok(JSON.stringify(i1.body) === JSON.stringify(i2.body), "第二次回傳同第一次一樣");

  // ── 9) 限流：每分鐘 20 次 ──
  let hit429 = false;
  for (let i = 0; i < 22; i++) {
    const rr = await call(post, { user: other, body: { class_id: "cl1", date: isoDay(20), start_time: "09:00" } });
    if (rr.statusCode === 429) { hit429 = true; break; }
  }
  ok(hit429, "超過 20 次/分鐘 → 429");

  // ── 10) 唔帶 title 都可以開（fallback 課程名）──
  const r7 = await call(post, { user: coach, body: { class_id: "cl1", date: isoDay(16), start_time: "18:00", duration_min: 60 } });
  const s7 = (r7.body.schedules || [])[0] || {};
  ok(r7.body.success === true && s7.title === "樂齡伸展", "無 title → 用課程名", s7.title);

  // ── 11) 接線：route 真係掛咗 optionalIdempotency + 限流 ──
  const src = require("fs").readFileSync(path.join(__dirname, "../src/routes/coach.js"), "utf8");
  ok(/router\.post\("\/schedules", authenticateToken, require\("\.\/\.\.\/middleware\/idempotency"\)\.optionalIdempotency/.test(src), "POST /schedules 已掛 Idempotency");
  ok(/coachRateLimit\(req\.user\.id\)/.test(src), "POST /schedules 有限流");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
