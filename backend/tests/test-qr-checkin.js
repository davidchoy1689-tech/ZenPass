/**
 * QR 簽到：HMAC 憑證、教練掃碼、竄改防護
 */
process.env["JWT" + "_SECRET"] = "test-secret-local";

const path = require("path");
const express = require(path.join(__dirname, "..", "node_modules", "express"));
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { make, verify } = require("../src/services/booking-qr");

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
  CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, subscription TEXT, user_agent TEXT, created_at TEXT, updated_at TEXT);
`);
const iso = (m) => new Date(Date.now() + m * 60000).toISOString();
db.prepare("INSERT INTO users VALUES ('coach','靜儀導師','90000000',NULL,NULL)").run();
db.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001','Karen','92345678')").run();
db.prepare("INSERT INTO classes VALUES ('c1','樂齡深層伸展','青衣楓樹窩體育館','楓樹窩路 1 號','coach')").run();
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1',?,?,1,8)").run(iso(-20), iso(70));
db.prepare("INSERT INTO class_schedules VALUES ('s2','c1',?,?,0,8)").run(iso(-10), iso(50));
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type,notify_sponsor_on_checkin)
  VALUES ('qr-b1','ZP-QR1','u1','s1','confirmed','paid','self',0)`).run();
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type)
  VALUES ('qr-b2','ZP-QR2','u1','s2','confirmed','paid','self')`).run();

const dbmod = require("../src/services/database");
dbmod.getDb = () => db;
const router = require("../src/routes/coach-checkin");
const { sign } = require("../src/services/coach-checkin-token");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

(async () => {
  console.log("\n🧪 1. QR 憑證格式");
  const qr = make("qr-b1");
  ok("前綴正確", qr.startsWith("zenpass:checkin:qr-b1:"), qr);
  ok("verify 成功", verify(qr).ok === true && verify(qr).bookingId === "qr-b1");
  ok("竄改 tag 失敗", verify(qr.slice(0, -1) + "X").ok === false);
  ok("亂字失敗", verify("zenpass:checkin:fake:1234567890").ok === false);

  const app = express();
  app.use("/api", router);
  const server = app.listen(0);
  const port = server.address().port;
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const exp = Math.floor(Date.now() / 1000) + 4 * 3600;
  const token = sign({ scheduleId: "s1", coachId: "coach", expiresAt: exp });

  console.log("\n🧪 2. 掃碼簽到");
  const r = await call("POST", "/api/coach/checkin", { token, qr, action: "checkin" });
  ok("200", r.status === 200, JSON.stringify(r.data));
  ok("已簽到 1/1", r.data.attended_count === 1 && r.data.total_enrolled === 1);
  ok("DB attended + method", (() => { const b = db.prepare("SELECT * FROM bookings WHERE id='qr-b1'").get(); return b.status === "attended" && b.checkin_method === "coach_link"; })());

  console.log("\n🧪 3. 冪等");
  const r2 = await call("POST", "/api/coach/checkin", { token, qr, action: "checkin" });
  ok("仍然 200 且 1/1", r2.status === 200 && r2.data.attended_count === 1);

  console.log("\n🧪 4. 跨班 QR 被拒");
  const cross = await call("POST", "/api/coach/checkin", { token, qr: make("qr-b2"), action: "checkin" });
  ok("404", cross.status === 404);

  console.log("\n🧪 5. 篡改 QR 被拒");
  const bad = await call("POST", "/api/coach/checkin", { token, qr: qr.slice(0, -1) + "Z", action: "checkin" });
  ok("400 QR_BAD_SIGNATURE", bad.status === 400 && bad.data.code === "QR_BAD_SIGNATURE");

  server.close();
  console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
