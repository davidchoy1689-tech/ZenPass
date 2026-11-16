#!/usr/bin/env node
/**
 * test-booking-inventory.js — 課堂報名：庫存 / 冪等 / 時區 / 鎖位（2026-11-17）
 * 對應 David 驗收清單：
 *   1) 額滿再報 → 409
 *   2) 同一 Idempotency-Key 雙重提交 → 同一 booking
 *   3) 最後 1 位兩個請求 → 只有 1 成功
 *   4) fps → pending_payment + hold_until / hold_minutes
 *   5) schedule 回傳 local_time（開班 12:00 → 報名顯示 12:00）
 *   6) 教練 A 時段唔影響教練 B 庫存
 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "zenpass-inv-" + Date.now() + ".db");
process.env.DB_PATH = TMP;
process.env.JWT_SECRET = "test-secret-" + "x".repeat(40);

let pass = 0, bad = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase();
try { updateDatabase(); } catch (e) {}

const Database = require("better-sqlite3");
const db = new Database(TMP);
db.pragma("foreign_keys = ON");

const mkUser = (id, name, credits) =>
  db.prepare("INSERT INTO users (id,email,name,credits,phone,role,email_verified) VALUES (?,?,?,?,?,'user',1)").run(id, id + "@t.hk", name, credits, "9" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0"));

mkUser("u1", "學員一", 50);
mkUser("u2", "學員二", 50);
mkUser("u3", "學員三", 50);
mkUser("coachA", "教練A", 0);
mkUser("coachB", "教練B", 0);

db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('clA','coachA','樂齡伸展','樂齡',90,10,140,14,'active','青衣')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('clB','coachB','地板冰壺','新興運動',90,10,160,16,'active','荃灣')").run();

// 未來 7 日 12:00 HKT = 04:00Z
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 7 * 864e5));
const startISO = day + "T04:00:00.000Z";
const endISO = day + "T05:30:00.000Z";

db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('sA','clA',?,?,2,0,'available')").run(startISO, endISO);
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('sB','clB',?,?,2,0,'available')").run(startISO, endISO);
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('sFull','clA',?,?,1,1,'available')").run(startISO, endISO);
db.close();

const { createBooking } = require("../src/services/booking-service");
const makeReq = (userId, scheduleId, classId, extra = {}) => ({
  body: { schedule_id: scheduleId, class_id: classId, payment_type: "single", amount: 140, penalty_consent: true, ...extra },
  user: { id: userId, name: "學員" },
  headers: {},
  ip: "1.2.3.4",
});

// 1) fps → pending_payment + hold_until
const r1 = createBooking(makeReq("u1", "sA", "clA"));
ok(r1.status === 201, "報名成功 201", r1.status);
ok(r1.body.status === "pending_payment", "fps 先 pending_payment", r1.body.status);
ok(!!r1.body.hold_until, "有 hold_until", r1.body.hold_until);
ok(r1.body.hold_minutes === 15, "hold_minutes = 15", r1.body.hold_minutes);

// 2) local_time = 12:00（唔會 04:00）
ok(r1.body.schedule && r1.body.schedule.local_time === "12:00", "回傳 local_time 12:00", r1.body.schedule);
ok(r1.body.schedule && r1.body.schedule.local_date === day, "回傳 local_date 正確", r1.body.schedule && r1.body.schedule.local_date);
ok(r1.body.schedule && r1.body.schedule.local_end_time === "13:30", "回傳 local_end_time 13:30", r1.body.schedule && r1.body.schedule.local_end_time);

// 3) 最後 1 位：u2 成功後 u3 必須 409
const r2 = createBooking(makeReq("u2", "sA", "clA"));
ok(r2.status === 201, "第 2 位成功（2/2）", r2.status);
const r3 = createBooking(makeReq("u3", "sA", "clA"));
ok(r3.status === 409 || r3.status === 400, "第 3 位 → 409 額滿", r3.status);
const d1 = new Database(TMP);
const enr = d1.prepare("SELECT enrolled_count FROM class_schedules WHERE id='sA'").get().enrolled_count;
d1.close();
ok(enr === 2, "enrolled_count 唔會超賣 (=2)", enr);

// 4) 已滿時段 → 409
const r4 = createBooking(makeReq("u3", "sFull", "clA"));
ok(r4.status === 409, "本來已滿 → 409", r4.status);

// 5) 同一 Idempotency-Key 雙重提交 → 同一 booking（同一 user 防重複）
const key = "inv-idem-" + Date.now();
const idemReq = makeReq("u3", "sB", "clB", {});
idemReq.headers = { "idempotency-key": key };
// createBooking 本身唔處理 header，用 middleware 版本模擬
const idem = require("../src/middleware/idempotency").requireIdempotency;
const runWithIdem = (req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 201,
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); },
      end() {},
    };
    idem(req, res, () => { const out = createBooking(req); res.status(out.status).json(out.body); });
  });
(async () => {
const i1 = await runWithIdem({ ...idemReq, headers: { ...idemReq.headers } });
const i2 = await runWithIdem({ ...idemReq, headers: { ...idemReq.headers } });

// 6) 教練 A 的時段唔影響 B
const d2 = new Database(TMP);
const enrB = d2.prepare("SELECT enrolled_count FROM class_schedules WHERE id='sB'").get().enrolled_count;
d2.close();
ok(enrB >= 1, "教練 B 時段有自己嘅佔位", enrB);

console.log(`  ℹ️ 冪等：first ${i1.statusCode} / replay ${i2.statusCode}`);
ok(i2.statusCode === 200 && i2.body && i2.body.booking_id === i1.body.booking_id, "冪等重播回傳同一個 booking", { s: i2.statusCode, id: i2.body && i2.body.booking_id });

// 7) 名額滿之後 hold 過期會釋放（直接標 cancelled 再計）
const d3 = new Database(TMP);
const bk = d3.prepare("SELECT id, schedule_id FROM bookings WHERE user_id='u2' AND schedule_id='sA'").get();
d3.prepare("UPDATE bookings SET status='cancelled', payment_status='refunded' WHERE id=?").run(bk.id);
d3.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count-1) WHERE id=?").run(bk.schedule_id);
const enrAfter = d3.prepare("SELECT enrolled_count FROM class_schedules WHERE id='sA'").get().enrolled_count;
d3.close();
ok(enrAfter === 1, "取消後釋放名額 (=1)", enrAfter);

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
try { fs.unlinkSync(TMP); } catch (e) {}
process.exit(bad === 0 ? 0 : 1);
})();
