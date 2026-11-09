#!/usr/bin/env node
/**
 * test-coach-portal.js — 教練批量點名 + 課後手冊
 */
const os = require("os");
const path = require("path");
process.env.JWT_SECRET = "a".repeat(48);
process.env.CHECKIN_TOKEN_SECRET = "b".repeat(48);
const tmp = path.join(os.tmpdir(), "zenpass-coachportal-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const Database = require("better-sqlite3");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

let pass = 0, bad = 0;
const ok = (c, m, extra) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, extra == null ? "" : extra)); };

initDatabase(); updateDatabase();

const { getDb } = require("../src/services/database");
const db = getDb();
const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const start = new Date(Date.now() - 20 * 60000);
const end = new Date(Date.now() + 70 * 60000);

db.prepare("INSERT INTO users (id,email,name,phone,role,email_verified) VALUES ('c1','coach1@t.hk','教練甲','90001111','coach',1)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,email_verified) VALUES ('c2','coach2@t.hk','教練乙','90002222','coach',1)").run();
for (let i = 1; i <= 10; i++) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,email_verified) VALUES (?,?,?,?, 'user',1)").run(`u${i}`, `u${i}@t.hk`, `學員${i}`, `9111000${String(i).padStart(2, "0")}`);
}
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('cl1','c1','樂齡伸展','樂齡',90,20,140,14,'active','青衣體育館')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1',?,?,20,10,'available')").run(fmt(start), fmt(end));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','cl1',?,?,20,0,'available')").run(fmt(start), fmt(end));
const insB = db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference) VALUES (?,?, 'cl1','s1','confirmed','paid',140,?)");
for (let i = 1; i <= 10; i++) insB.run(`b${i}`, `u${i}`, `ZP-T${i}`);

function handlerOf(router, method, p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) return null;
  const st = layer.route.stack;
  return st[st.length - 1].handle;
}
function call(handler, { query = {}, body = {}, user = null }) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
    try { handler({ query, body, user, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
  });
}

(async () => {
  const portal = require("../src/routes/coach-portal");
  const checkin = require("../src/routes/coach-checkin");
  const coach1 = { id: "c1", role: "coach" };
  const coach2 = { id: "c2", role: "coach" };

  console.log("🧪 1. 批量點名（JWT）");
  const batch = handlerOf(portal, "post", "/attendance/batch-check");
  ok(!!batch, "handler 存在");
  const t0 = Date.now();
  const r1 = await call(batch, { user: coach1, body: { schedule_id: "s1" } });
  ok(r1.statusCode === 200 && r1.body.success, "10 人批量成功", JSON.stringify(r1.body).slice(0, 160));
  ok(r1.body.updated === 10, "更新 10 人", r1.body.updated);
  ok(Date.now() - t0 < 20000, "少於 20 秒", Date.now() - t0 + "ms");
  ok(/^[0-9a-f]{64}$/.test(r1.body.digest || ""), "有 SHA-256 digest");
  ok(!!r1.body.block_hash, "已寫 blockchain block");
  const att = db.prepare("SELECT COUNT(*) c FROM bookings WHERE schedule_id='s1' AND status='attended' AND checkin_method='batch'").get().c;
  ok(att === 10, "DB 狀態 attended=10", att);
  const auditRows = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action_type='attendance.batch_check'").get().c;
  ok(auditRows === 1, "有 audit 紀錄");
  const block = db.prepare("SELECT COUNT(*) c FROM blockchain_blocks WHERE entity_type='attendance_batch' AND entity_id='s1'").get().c;
  ok(block === 1, "有存證區塊");

  const r2 = await call(batch, { user: coach1, body: { schedule_id: "s1" } });
  ok(r2.body.updated === 0, "重複點名唔會重扣", r2.body.updated);

  const r3 = await call(batch, { user: coach2, body: { schedule_id: "s1" } });
  ok(r3.statusCode === 404, "其他教練 → 404", r3.statusCode);

  console.log("🧪 2. 課後手冊");
  const hb = handlerOf(portal, "post", "/handbook");
  ok(!!hb, "handler 存在");
  const photo = "data:image/png;base64," + Buffer.from("fake-png").toString("base64");
  const h1 = await call(hb, { user: coach1, body: { schedule_id: "s1", booking_id: "b1", comment: "今日動作好穩，下次試加阻力。", photos: [photo] } });
  ok(h1.statusCode === 201 && h1.body.success, "首次發佈 201", JSON.stringify(h1.body).slice(0, 120));
  ok(/^[0-9a-f]{64}$/.test(h1.body.sha256 || ""), "有 SHA-256");
  ok(!!h1.body.block_hash, "有 blockchain block");
  const note = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id='u1'").get().c;
  ok(note >= 1, "已通知學員", note);

  const h2 = await call(hb, { user: coach1, body: { schedule_id: "s1", booking_id: "b1", comment: "更新：下次記得帶水。", photos: [] } });
  ok(h2.statusCode === 200 && h2.body.updated === true, "重複提交 → 更新", h2.statusCode);

  const badPhoto = await call(hb, { user: coach1, body: { schedule_id: "s1", booking_id: "b2", comment: "測試", photos: ["data:text/html;base64,abc"] } });
  ok(badPhoto.statusCode === 400, "非圖片被拒", badPhoto.statusCode);
  const shortC = await call(hb, { user: coach1, body: { schedule_id: "s1", booking_id: "b2", comment: "a" } });
  ok(shortC.statusCode === 400, "評語太短被拒", shortC.statusCode);
  const hOther = await call(hb, { user: coach2, body: { schedule_id: "s1", booking_id: "b2", comment: "亂入" } });
  ok(hOther.statusCode === 404, "其他教練 → 404", hOther.statusCode);

  const gl = handlerOf(portal, "get", "/handbook");
  const list = await call(gl, { user: coach1, query: { schedule_id: "s1" } });
  ok(list.body.handbooks.length === 1, "列表 1 份", list.body.handbooks.length);

  console.log("🧪 3. 免登入連結批量點名");
  const tokens = require("../src/services/coach-checkin-token");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = tokens.sign({ scheduleId: "s2", coachId: "c1", expiresAt: exp });
  // s2 加 2 個 confirmed 名額
  db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference) VALUES ('b21','u1','cl1','s2','confirmed','paid',140,'ZP-T21')").run();
  db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status,payment_status,amount,booking_reference) VALUES ('b22','u2','cl1','s2','confirmed','paid',140,'ZP-T22')").run();
  const cb = handlerOf(checkin, "post", "/coach/checkin/batch");
  ok(!!cb, "token batch handler 存在");
  const rb = await call(cb, { body: { token: tok } });
  ok(rb.statusCode === 200 && rb.body.updated === 2, "token 批量 2 人", JSON.stringify(rb.body).slice(0, 140));
  ok(!!rb.body.block_hash, "token 批量有存證");
  const rb2 = await call(cb, { body: { token: tok } });
  ok(rb2.body.updated === 0, "重複 token 批量 = 0", rb2.body.updated);

  console.log("🧪 4. 工單 payload 兼容（scheduleId / records / PRESENT）");
  // 重設 s2 兩個 booking 為 confirmed
  db.prepare("UPDATE bookings SET status='confirmed', checked_in_at=NULL, cert_hash=NULL WHERE schedule_id='s2'").run();
  const rw = await call(batch, {
    user: coach1,
    body: {
      scheduleId: "s2",
      records: [
        { attendanceId: "b21", userId: "u1", status: "PRESENT" },
        { attendanceId: "b22", userId: "u2", status: "ABSENT" },
      ],
    },
  });
  ok(rw.body.updated === 2, "records 更新 2 人", JSON.stringify(rw.body).slice(0, 120));
  ok(Array.isArray(rw.body.data) && rw.body.data.length === 2, "回傳 data[]");
  ok(/^[0-9a-f]{64}$/.test((rw.body.data[0] || {}).certHash || ""), "PRESENT 有 certHash");
  const st = db.prepare("SELECT status, cert_hash FROM bookings WHERE id='b21'").get();
  ok(st.status === "attended" && /^[0-9a-f]{64}$/.test(st.cert_hash || ""), "DB cert_hash 已寫入");
  const ab = db.prepare("SELECT status FROM bookings WHERE id='b22'").get();
  ok(ab.status === "no_show", "ABSENT → no_show", ab.status);

  const hb2 = await call(hb, {
    user: coach1,
    body: { scheduleId: "s2", userId: "u1", notes: "工單格式評語，動作穩定。", mediaUrls: [] },
  });
  ok(hb2.statusCode === 201 && !!hb2.body.handbookId, "notes/mediaUrls/userId 兼容", JSON.stringify(hb2.body).slice(0, 120));

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
