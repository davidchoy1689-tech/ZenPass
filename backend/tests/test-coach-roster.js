#!/usr/bin/env node
/** test-coach-roster.js — 點名冊狀態機 + 合規請假退堂 */
const os = require("os");
const path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
const tmp = path.join(os.tmpdir(), "zenpass-roster-" + Date.now() + ".db");
process.env.DB_PATH = tmp;
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const start = new Date(Date.now() - 10 * 60000), end = new Date(Date.now() + 80 * 60000);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c1','c1@t.hk','教練甲','90001111','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('c2','c2@t.hk','教練乙','90002222','coach')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u1','u1@t.hk','陳伯','91110001','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u2','u2@t.hk','李太','91110002','user')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','c1','樂齡伸展','樂齡',90,20,140,14,'active','青衣體育館')").run();
try { db.prepare("ALTER TABLE bookings ADD COLUMN medical_notes TEXT").run(); } catch (e) {}
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1',?,?,20,2,'available')").run(fmt(start), fmt(end));
db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference,pass_id,medical_notes) VALUES ('b1','u1','cl1','s1','confirmed','paid',0,'ZP-R1','p1','膝關節舊患')").run();
db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference) VALUES ('b2','u2','cl1','s1','confirmed','paid',140,'ZP-R2')").run();
db.prepare("INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at) VALUES ('p1','u1','91110001','陳伯',4,3,480,'active',?)").run(fmt(new Date(Date.now() + 30 * 864e5)));
db.prepare("INSERT INTO pass_redemptions (id,pass_id,booking_id,user_id,credits,status) VALUES ('pr1','p1','b1','u1',1,'used')").run();

function handlerOf(router, method, p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) return null;
  const st = layer.route.stack;
  return st[st.length - 1].handle;
}
const call = (handler, { body = {}, user = null, params = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { handler({ body, user, params, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/coach-roster");
  const get = handlerOf(router, "get", "/sessions/:sid/roster");
  const batch = handlerOf(router, "post", "/attendance/batch");
  const coach1 = { id: "c1", role: "coach" }, coach2 = { id: "c2", role: "coach" };

  console.log("🧪 1. 名冊讀取");
  ok(!!get && !!batch, "handlers 存在");
  const r0 = await call(get, { user: coach1, params: { sid: "s1" } });
  ok(r0.statusCode === 200 && r0.body.roster.length === 2, "2 位學員", r0.body && r0.body.roster && r0.body.roster.length);
  const chen = r0.body.roster.find((x) => x.booking_id === "b1");
  ok(chen && chen.medical_notes === "膝關節舊患", "舊患帶出");
  ok(chen && chen.pass_remaining === 3, "通行卡剩 3 堂", chen && chen.pass_remaining);
  const rOther = await call(get, { user: coach2, params: { sid: "s1" } });
  ok(rOther.statusCode === 404, "其他教練 404", rOther.statusCode);

  console.log("🧪 2. 狀態切換");
  const b1 = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "b1", status: "present" }] } });
  ok(b1.body.success && b1.body.updated === 1, "present 成功", JSON.stringify(b1.body).slice(0, 100));
  ok(db.prepare("SELECT status FROM bookings WHERE id='b1'").get().status === "attended", "bookings → attended");
  const a1 = db.prepare("SELECT status FROM attendances WHERE booking_id='b1'").get();
  ok(a1 && a1.status === "present", "attendances → present");

  const b2 = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "b2", status: "absent_notified" }] } });
  ok(b2.body.success, "absent_notified 成功");
  ok(db.prepare("SELECT status FROM bookings WHERE id='b2'").get().status === "confirmed", "合規請假保留 confirmed");
  ok(db.prepare("SELECT status FROM attendances WHERE booking_id='b2'").get().status === "absent_notified", "attendance 記錄請假");

  console.log("🧪 3. 合規請假退堂（通行卡）");
  // b1 用 pass，改成 absent_notified → 應退 1 堂
  const b3 = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "b1", status: "absent_notified" }] } });
  ok(b3.body.success && b3.body.results[0].pass_restored === true, "已退 1 堂", JSON.stringify(b3.body.results));
  ok(db.prepare("SELECT remaining_credits FROM user_passes WHERE id='p1'").get().remaining_credits === 4, "通行卡 3→4");
  ok(db.prepare("SELECT status FROM pass_redemptions WHERE id='pr1'").get().status === "refunded", "redemption → refunded");
  const b4 = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "b1", status: "absent_notified" }] } });
  ok(b4.body.results[0].pass_restored === false, "重複唔會再退");
  ok(db.prepare("SELECT remaining_credits FROM user_passes WHERE id='p1'").get().remaining_credits === 4, "堂數仍 4");

  console.log("🧪 4. 缺席扣堂 / 驗證");
  const b5 = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "b2", status: "absent_unexcused" }] } });
  ok(b5.body.success, "absent_unexcused 成功");
  ok(db.prepare("SELECT status FROM bookings WHERE id='b2'").get().status === "no_show", "bookings → no_show");
  const badStatus = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "b2", status: "UNKNOWN" }] } });
  ok(badStatus.statusCode === 400, "無效狀態 400", badStatus.statusCode);
  const wrongClass = await call(batch, { user: coach1, body: { session_id: "s1", records: [{ booking_id: "nope", status: "present" }] } });
  ok(wrongClass.statusCode === 400, "不在此班 400", wrongClass.statusCode);
  const blk = db.prepare("SELECT COUNT(*) c FROM blockchain_blocks WHERE entity_type='attendance_roster'").get().c;
  ok(blk >= 4, "每批有存證區塊", blk);

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
