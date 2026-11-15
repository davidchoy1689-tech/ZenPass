/**
 * 一次性入場憑證 × 教練點名（coach-checkin 路由）
 * 覆蓋：JSON QR 掃碼、核銷後 token 失效、跨班次攔截、靜態 QR 回歸
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-onetime";

const path = require("path");
const express = require(path.join(__dirname, "..", "node_modules", "express"));
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT, emergency_name TEXT, emergency_phone TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, venue_name TEXT, venue_address TEXT, coach_id TEXT);
  CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT, enrolled_count INTEGER, max_participants INTEGER);
  CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, status TEXT,
    payment_status TEXT, attendee_type TEXT, parent_name TEXT, parent_phone TEXT, notify_sponsor_on_checkin INTEGER,
    medical_notes TEXT, checked_in_at TEXT, checkin_method TEXT, cancel_reason TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT, user_id TEXT,
    new_values TEXT, description TEXT, created_at TEXT);
`);

const iso = (min) => new Date(Date.now() + min * 60000).toISOString();
db.prepare("INSERT INTO users VALUES ('coach','靜儀導師','90000000',NULL,NULL)").run();
db.prepare("INSERT INTO classes VALUES ('c1','樂齡深層伸展','青衣楓樹窩體育館','青衣楓樹窩路 1 號','coach')").run();
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1',?,?,0,8)").run(iso(-10), iso(50));
db.prepare("INSERT INTO class_schedules VALUES ('s2','c1',?,?,0,8)").run(iso(-10), iso(50));
db.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001',NULL,NULL)").run();
db.prepare("INSERT INTO users VALUES ('u2','李伯','91234567',NULL,NULL)").run();
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type,created_at)
  VALUES ('bk01','ZP-01','u1','s1','confirmed','paid','self',datetime('now'))`).run();
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type,created_at)
  VALUES ('bk02','ZP-02','u2','s2','confirmed','paid','self',datetime('now'))`).run();

const dbmod = require("../src/services/database");
dbmod.getDb = () => db;
const router = require("../src/routes/coach-checkin");
const { sign } = require("../src/services/coach-checkin-token");
const cat = require("../src/services/checkin-access-token");
const bookingQr = require("../src/services/booking-qr");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };
const exp = Math.floor(Date.parse(new Date(Date.now() + 4 * 3600e3).toISOString()) / 1000) + 3 * 3600;

(async () => {
  const app = express();
  app.use("/api", router);
  const server = app.listen(0);
  const port = server.address().port;
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const token = sign({ scheduleId: "s1", coachId: "coach", expiresAt: exp });
  const token2 = sign({ scheduleId: "s2", coachId: "coach", expiresAt: exp });

  console.log("\n🧪 1. 一次性憑證 JSON QR 掃碼");
  cat.ensureSchema(db);
  const t1 = cat.issue(db, "bk01", { ttlHours: 2 });
  const jsonQr = JSON.stringify({ access_token: t1.token, v: 1 });
  const r1 = await call("POST", "/api/coach/checkin", { token, qr: jsonQr, action: "checkin" });
  ok("200", r1.status === 200, JSON.stringify(r1.data));
  ok("公域學員姓名遮罩（陳＊＊）", r1.data.student_name === "陳＊＊", r1.data.student_name);
  ok("booking attended", db.prepare("SELECT status FROM bookings WHERE id='bk01'").get().status === "attended");
  ok("checkin_method = coach_link", db.prepare("SELECT checkin_method m FROM bookings WHERE id='bk01'").get().m === "coach_link");
  ok("token is_used=1", db.prepare("SELECT is_used FROM checkin_access_tokens WHERE id=?").get(t1.id).is_used === 1);

  console.log("\n🧪 2. 重播防護");
  const r2 = await call("POST", "/api/coach/checkin", { token, qr: jsonQr, action: "checkin" });
  ok("第二次 400", r2.status === 400, String(r2.status));
  ok("code = TOKEN_ALREADY_USED", r2.data.code === "TOKEN_ALREADY_USED", r2.data.code);

  console.log("\n🧪 3. 跨班次攔截");
  const t2 = cat.issue(db, "bk02", { ttlHours: 2 });
  const r3 = await call("POST", "/api/coach/checkin", {
    token, qr: JSON.stringify({ access_token: t2.token, v: 1 }), action: "checkin",
  });
  ok("404（不在本班名冊）", r3.status === 404, String(r3.status));
  ok("跨班 token 未被消耗", db.prepare("SELECT is_used FROM checkin_access_tokens WHERE id=?").get(t2.id).is_used === 0);

  console.log("\n🧪 4. 過期憑證");
  db.prepare("UPDATE checkin_access_tokens SET expires_at=datetime('now','-5 minutes') WHERE id=?").run(t2.id);
  const r4 = await call("POST", "/api/coach/checkin", {
    token: token2, qr: JSON.stringify({ access_token: t2.token, v: 1 }), action: "checkin",
  });
  ok("400 TOKEN_EXPIRED", r4.status === 400 && r4.data.code === "TOKEN_EXPIRED", r4.data.code);

  console.log("\n🧪 5. 靜態 QR 回歸");
  const r5 = await call("POST", "/api/coach/checkin", { token: token2, qr: bookingQr.make("bk02"), action: "checkin" });
  ok("200", r5.status === 200, JSON.stringify(r5.data));
  ok("b2 attended", db.prepare("SELECT status FROM bookings WHERE id='bk02'").get().status === "attended");

  console.log("\n🧪 6. 垃圾 JSON 不誤放行");
  const r6 = await call("POST", "/api/coach/checkin", { token, qr: '{"foo":1}', action: "checkin" });
  ok("400", r6.status === 400, String(r6.status));

  server.close();
  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
