/**
 * 教練免登入點名：token、名冊脫敏、簽到冪等、報平安、缺席
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-coach";

const path = require("path");
const fs = require("fs");
const http = require("http");
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
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1',?,?,2,8)").run(iso(-30), iso(90));
db.prepare("INSERT INTO class_schedules VALUES ('s2','c1',?,?,0,8)").run(iso(-10), iso(50));

db.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001','女兒 Karen','92345678')").run();
db.prepare("INSERT INTO users VALUES ('u2','李伯','91234567',NULL,NULL)").run();
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type,parent_name,parent_phone,notify_sponsor_on_checkin,medical_notes)
  VALUES ('b1','ZP-1','u1','s1','confirmed','paid','parent','陳伯伯','98765432',1,'右膝微創，避免深蹲')`).run();
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type,medical_notes)
  VALUES ('b2','ZP-2','u1','s1','confirmed','paid','self',NULL)`).run();
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status,attendee_type)
  VALUES ('b3','ZP-3','u2','s2','confirmed','paid','self')`).run();

// 用測試 DB 取代 getDb
const dbmod = require("../src/services/database");
dbmod.getDb = () => db;
const router = require("../src/routes/coach-checkin");
const { sign } = require("../src/services/coach-checkin-token");

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

  console.log("\n🧪 1. 名冊（脫敏、代報、同行合併）");
  const r1 = await call("GET", `/api/coach/checkin/roster?token=${encodeURIComponent(token)}`);
  ok("200", r1.status === 200);
  const g1 = (r1.data.roster || []).find((x) => x.user_id === "u1");
  ok("同一 user 合併 2 位", g1 && g1.seats === 2);
  ok("顯示父母名", g1 && g1.attendee_name === "陳伯伯");
  ok("子女代報標記", g1 && g1.is_parent === true && g1.sponsor_name === "陳小姐");
  ok("電話脫敏", g1 && g1.phone_masked === "9876 ****", g1 && g1.phone_masked);
  ok("健康備註", g1 && g1.health_notes.includes("右膝"));
  ok("總人數 2", r1.data.schedule.total_enrolled === 2);

  console.log("\n🧪 2. 簽到 + 報平安");
  const r2 = await call("POST", "/api/coach/checkin", { token, booking_id: "b1", action: "checkin" });
  ok("200", r2.status === 200);
  ok("已到 2 / 2", r2.data.attended_count === 2 && r2.data.total_enrolled === 2);
  ok("sponsor_notified", r2.data.sponsor_notified === true && r2.data.sponsor.wa_url.includes("wa.me/85298770001"));
  ok("booking attended", db.prepare("SELECT status FROM bookings WHERE id='b1'").get().status === "attended");
  ok("同行另一位都 attended", db.prepare("SELECT status FROM bookings WHERE id='b2'").get().status === "attended");
  ok("audit sponsor 一次", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='checkin.sponsor_notified'").get().n === 1);

  console.log("\n🧪 3. 重複簽到（冪等、不重發）");
  const r3 = await call("POST", "/api/coach/checkin", { token, booking_id: "b1", action: "checkin" });
  ok("仍然 200", r3.status === 200);
  ok("sponsor_notified=false", r3.data.sponsor_notified === false);
  ok("audit 仍只有一次", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='checkin.sponsor_notified'").get().n === 1);

  console.log("\n🧪 4. 缺席");
  const r4 = await call("POST", "/api/coach/checkin", { token, booking_id: "b3", action: "no_show" });
  ok("跨班 booking 被拒 404", r4.status === 404);
  const t2 = sign({ scheduleId: "s1", coachId: "coach", expiresAt: exp });
  const r4b = await call("POST", "/api/coach/checkin", { token: t2, booking_id: "b2", action: "no_show" });
  ok("已簽到不可改缺席 409", r4b.status === 409 && r4b.data.code === "ALREADY_ATTENDED");

  console.log("\n🧪 5. Token 安全");
  const bad = await call("GET", "/api/coach/checkin/roster?token=abc.def");
  ok("假 token 403", bad.status === 403);
  const expired = sign({ scheduleId: "s1", coachId: "coach", expiresAt: Math.floor(Date.now() / 1000) - 10 });
  const ex = await call("GET", `/api/coach/checkin/roster?token=${encodeURIComponent(expired)}`);
  ok("過期 403", ex.status === 403 && ex.data.code === "TOKEN_EXPIRED");
  const wrongScope = sign({ scheduleId: "s2", coachId: "coach", expiresAt: exp });
  const ws = await call("GET", `/api/coach/checkin/roster?token=${encodeURIComponent(wrongScope)}`);
  ok("其他班名冊只含該班", ws.status === 200 && ws.data.roster.length === 1 && ws.data.roster[0].user_id === "u2");

  console.log("\n🧪 6. 簽名竄改");
  const parts = token.split(".");
  const tampered = parts[0] + "." + parts[1].slice(0, -2) + "AA";
  const tp = await call("GET", `/api/coach/checkin/roster?token=${encodeURIComponent(tampered)}`);
  ok("竄改簽名 403", tp.status === 403);

  console.log("\n🧪 7. 前端 CSRF（教練只開連結都可以簽到）");
  {
    const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-checkin.html"), "utf8");
    ok("會主動攞 /api/csrf-token", /fetch\("\/api\/csrf-token"/.test(html));
    ok("api() 對非 GET 自動帶 x-csrf-token", /x-csrf-token/.test(html) && /method !== "GET"/.test(html));
    ok("提交課後簡評有帶 CSRF", /checkin\/tags[\s\S]{0,400}x-csrf-token/.test(html));
    ok("請求帶 credentials: include", /credentials:\s*"include"/.test(html));
  }

  server.close();
  console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
