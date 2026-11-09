#!/usr/bin/env node
/** test-ux-cro.js — 自助改期、Dock 聯動、行內校驗、FPS 複製、方案切換 */
const fs = require("fs"), os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-cro-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const root = path.join(__dirname, "../../frontend-v2");
const detail = fs.readFileSync(path.join(root, "detail.html"), "utf8");
const booking = fs.readFileSync(path.join(root, "booking.html"), "utf8");
const mine = fs.readFileSync(path.join(root, "my-bookings.html"), "utf8");

const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('u1','u1@t.hk','學員','user')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('u2','u2@t.hk','路人','user')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('c1','c1@t.hk','教練','coach')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('cl1','c1','樂齡伸展','樂齡',90,140,'active')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('cl2','c1','地板冰壺','新興運動',90,180,'active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s_old','cl1',?,?,8,3,'available')").run(iso(48), iso(49.5));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s_new','cl1',?,?,8,2,'available')").run(iso(96), iso(97.5));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s_full','cl1',?,?,2,2,'available')").run(iso(120), iso(121.5));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s_soon','cl1',?,?,8,2,'available')").run(iso(5), iso(6.5));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s_other','cl2',?,?,8,2,'available')").run(iso(96), iso(97.5));
db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount) VALUES ('b1','u1','cl1','s_old','confirmed','paid',140)").run();
db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount) VALUES ('b_soon','u1','cl1','s_soon','confirmed','paid',140)").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/student-bookings");
  const rsv = handlerOf(router, "post", "/bookings/:id/reschedule");
  ok(!!rsv, "reschedule handler 存在");

  console.log("🧪 1. 權限與時限");
  const idor = await call(rsv, { user: { id: "u2", role: "user" }, params: { id: "b1" }, body: { new_session_id: "s_new" } });
  ok(idor.statusCode === 403, "非本人 → 403");
  const soon = await call(rsv, { user: { id: "u1", role: "user" }, params: { id: "b_soon" }, body: { new_session_id: "s_new" } });
  ok(soon.statusCode === 400 && /24 小時/.test(soon.body.error), "開課前 <24h → 400", soon.body.error);

  console.log("🧪 2. 驗證");
  const other = await call(rsv, { user: { id: "u1", role: "user" }, params: { id: "b1" }, body: { new_session_id: "s_other" } });
  ok(other.statusCode === 400 && /同一課程/.test(other.body.error), "不同課程 → 400");
  const full = await call(rsv, { user: { id: "u1", role: "user" }, params: { id: "b1" }, body: { new_session_id: "s_full" } });
  ok(full.statusCode === 409 && /已滿/.test(full.body.error), "滿額 → 409");
  const same = await call(rsv, { user: { id: "u1", role: "user" }, params: { id: "b1" }, body: { new_session_id: "s_old" } });
  ok(same.statusCode === 400, "同班次 → 400");

  console.log("🧪 3. 原子轉移");
  const before = {
    old: db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s_old'").get().enrolled_count,
    new: db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s_new'").get().enrolled_count,
  };
  const good = await call(rsv, { user: { id: "u1", role: "user" }, params: { id: "b1" }, body: { new_session_id: "s_new" } });
  ok(good.statusCode === 200 && good.body.success, "25h 前改期成功", good.body.error);
  const after = {
    old: db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s_old'").get().enrolled_count,
    new: db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s_new'").get().enrolled_count,
    sid: db.prepare("SELECT schedule_id,rescheduled_at FROM bookings WHERE id='b1'").get(),
  };
  ok(after.old === before.old - 1, "舊班 -1", after.old);
  ok(after.new === before.new + 1, "新班 +1", after.new);
  ok(after.sid.schedule_id === "s_new" && !!after.sid.rescheduled_at, "預約已轉 + 改期時間");
  ok(db.prepare("SELECT action_type FROM audit_log WHERE entity_id='b1'").all().some((x) => x.action_type === "booking.rescheduled"), "有審計");

  console.log("🧪 4. 前端 CRO");
  ok(/syncDockToSelection/.test(detail) && /"已選 "/.test(detail) && /（剩 /.test(detail), "Dock 與時段聯動");
  ok(/location\.href = "booking\.html\?id=" \+ encodeURIComponent\(c\.id\)/.test(detail), "Dock 直達 booking");
  ok(/inlineValidate/.test(booking) && /\^\[4-9\]\\d\{7\}\$/.test(booking), "電話行內校驗");
  ok(/aria-invalid/.test(booking) && /#EF4444/.test(booking), "錯誤紅框 + aria");
  ok(/✓ 已成功複製！/.test(booking), "FPS 複製微動態");
  ok(/checkout_tier/.test(booking) && /planPass/.test(booking), "單堂／通行卡切換");
  ok(/PLAN_TIER === "pass_4"/.test(booking) && /認購 4 堂通行卡/.test(booking), "切換後金額與 CTA");
  ok(/更改上課時間/.test(mine), "我的預約有改期入口");
  ok(/student\/bookings\//.test(mine), "前端接新 endpoint");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
