#!/usr/bin/env node
/** Phase 2.5 — 私人專屬時段、扣堂（一對一 3 堂；2026-11-12 起）、退訂、收益 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase25-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const passes = require("../src/services/passes");
const privateSlots = require("../src/routes/private-slots");
const coachAffiliate = require("../src/services/coach-affiliate");
const { bindStudent } = coachAffiliate;
const { syncCoachEarningsForSchedule } = require("../src/routes/coach-earnings");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
passes.ensureSchema(db);
privateSlots.ensureSchema(db);
coachAffiliate.ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);
require("../src/routes/coach-scheduling").ensureSchedulingSchema(db);

function addUser(id, name, phone, coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified) VALUES (?,?,?,?,?,?,?)")
    .run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach ? 1 : 0);
}
addUser("coachA", "蔡教練", "60005001", 1);
addUser("stu1", "學員一", "60005002");
addUser("stu2", "學員二", "60005003");
bindStudent(db, "stu1", "coachA");
const token = (id) => jwt.sign({ id, role: id.startsWith("coach") ? "coach" : "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const tokenA = token("coachA"), token1 = token("stu1"), token2 = token("stu2");

// 既有團體班 12/01 19:00–20:00（HKT）
db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,district,venue_name)
            VALUES ('group-cls','coachA','團體痛症班','fitness',60,140,8,'active',1,'葵青','葵芳體育館')`).run();
db.prepare(`INSERT INTO class_schedules (id,class_id,coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district)
            VALUES ('group-sch','group-cls','coachA','2026-12-01 11:00:00','2026-12-01 12:00:00',8,0,'available',1,'葵青')`).run();

const app = express();
app.use(express.json());
app.use("/api", privateSlots);
app.use("/api/bookings", require("../src/routes/bookings"));
app.use("/api/coach", require("../src/routes/coach"));
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body, tk = tokenA) => fetch(base + url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ["Bea", "rer "].join("") + tk },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url) => fetch(base + url).then(async (r) => ({ status: r.status, body: await r.json() }));

  console.log("🧪 1. AC-1 防重疊排時段");
  const batch = (ranges) => post("/api/coach/slots/batch-create", {
    venue_name: "葵芳體育館 活動室",
    district: "葵青",
    date: "2026-12-01",
    time_ranges: ranges,
    price_cents: 28000,
    pass_units_required: 2,
    max_attendees: 1,
  });
  const clash = await batch([{ start: "19:00", end: "20:00" }]);
  ok(clash.status === 409 && clash.body.code === "CONFLICT", "與團體班重疊 409 CONFLICT", clash);
  const made = await batch([{ start: "15:00", end: "16:00" }, { start: "16:00", end: "17:00" }]);
  ok(made.status === 201 && made.body.count === 2 && made.body.created.length === 2, "批次建立 2 個私人時段", made);
  const slot1 = made.body.created[0], slot2 = made.body.created[1];
  ok(db.prepare("SELECT status,class_id,schedule_id FROM coach_availability_slots WHERE id=?").get(slot1.slot_id).status === "available", "slot 狀態 available");
  const cls = db.prepare("SELECT c.is_private,c.price_hkd C, cs.max_participants FROM coach_availability_slots s JOIN classes c ON c.id=s.class_id JOIN class_schedules cs ON cs.id=s.schedule_id WHERE s.id=?").get(slot1.slot_id);
  ok(cls.is_private === 1 && Number(cls.C) === 280 && cls.max_participants === 1, "私人 class 標記＋價格＋1 對 1");

  console.log("🧪 2. 公開私人時段");
  const pub = await get("/api/public/explore/private-slots?district=葵青&date=2026-12-01");
  ok(pub.status === 200 && pub.body.slots.length === 2, "公開列表 2 個時段");
  ok(pub.body.slots[0].pass_units_required === 3 && pub.body.slots[0].price_cents === 28000, "回傳扣 3 堂／HK$280（一對一規則）");
  ok(!require("../src/routes/public-explore").listExplore(db, { audience: "office_worker", district: "葵青" }).classes.some((c) => c.class_id === cls.class_id), "私人班不混入團體探索");

  console.log("🧪 3. AC-2 兩堂原子扣減");
  const p1 = passes.issuePass(db, { userId: "stu1", phone: "60005002", studentName: "學員一", totalCredits: 4, pricePaid: 520, validDays: 60 });
  const book1 = await post("/api/bookings/book-private-slot", { slot_id: slot1.slot_id, attendee_user_id: "stu1", health_focus: "右膝痛" }, token1);
  ok(book1.status === 201 && book1.body.units_consumed === 3, "私人時段預約成功、扣 3 堂", book1);
  ok(book1.body.pass.remaining_credits === 1, "Pass 4→1");
  ok(db.prepare("SELECT status FROM coach_availability_slots WHERE id=?").get(slot1.slot_id).status === "booked", "slot booked");
  const pub2 = await get("/api/public/explore/private-slots?district=葵青&date=2026-12-01");
  ok(pub2.body.slots.length === 1 && pub2.body.slots[0].slot_id === slot2.slot_id, "已預約 slot 從公開 API 消失");
  const bk = db.prepare("SELECT * FROM bookings WHERE id=?").get(book1.body.booking_id);
  ok(bk.units_consumed === 3 && bk.slot_id === slot1.slot_id && bk.health_focus === "右膝痛" && bk.payment_type === "pass", "booking 記錄 slot／3 堂／health_focus");

  console.log("🧪 4. AC-3 餘額不足");
  passes.issuePass(db, { userId: "stu2", phone: "60005003", studentName: "學員二", totalCredits: 1, pricePaid: 130, validDays: 60 });
  const book2 = await post("/api/bookings/book-private-slot", { slot_id: slot2.slot_id, attendee_user_id: "stu2" }, token2);
  ok(book2.status === 400 && book2.body.code === "INSUFFICIENT_PASS_UNITS", "1 堂不可預約 3 堂時段", book2);
  ok(db.prepare("SELECT status FROM coach_availability_slots WHERE id=?").get(slot2.slot_id).status === "available", "失敗後 slot 保持 available");

  console.log("🧪 5. AC-4 取消雙倍返還");
  const cancel = await post("/api/bookings/" + book1.body.booking_id + "/cancel", { reason: "user_self_cancel" }, token1);
  ok(cancel.status === 200 && cancel.body.pass_refunded, "48h 前取消成功", cancel);
  ok(Number(db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(p1.pass.id).remaining_credits) === 4, "Pass 2→4");
  ok(db.prepare("SELECT status FROM coach_availability_slots WHERE id=?").get(slot1.slot_id).status === "available", "slot 恢復 available");
  const pub3 = await get("/api/public/explore/private-slots?district=葵青&date=2026-12-01");
  ok(pub3.body.slots.length === 2, "公開 API 重新可見");

  console.log("🧪 6. AC-5 點名後收益 80/20");
  const reb = await post("/api/bookings/book-private-slot", { slot_id: slot1.slot_id, attendee_user_id: "stu1" }, token1);
  ok(reb.status === 201, "重新預約");
  db.prepare("UPDATE bookings SET status='attended', payment_status='paid' WHERE id=?").run(reb.body.booking_id);
  syncCoachEarningsForSchedule(slot1 && db.prepare("SELECT schedule_id FROM coach_availability_slots WHERE id=?").get(slot1.slot_id).schedule_id);
  const earn = db.prepare("SELECT net_amount,gross_amount FROM coach_earnings WHERE schedule_id=?").get(db.prepare("SELECT schedule_id FROM coach_availability_slots WHERE id=?").get(slot1.slot_id).schedule_id);
  ok(earn && Number(earn.gross_amount) === 280 && Number(earn.net_amount) === 224, "80% 帶班 = HK$224", earn);
  coachAffiliate.settleSchedule(db.prepare("SELECT schedule_id FROM coach_availability_slots WHERE id=?").get(slot1.slot_id).schedule_id);
  const uplift = db.prepare("SELECT SUM(uplift_cents) c FROM coach_own_student_uplifts WHERE booking_id=?").get(reb.body.booking_id);
  ok(Number(uplift.c) === 5600, "自有學生 20% 補足 = HK$56", uplift);

  console.log("🧪 7. 前端接線");
  const fs = require("fs");
  const ex = fs.readFileSync(path.join(__dirname, "../../frontend-v2/explore.html"), "utf8");
  ok(/private-slots/.test(ex) && /book-private-slot/.test(ex), "探索大廳有私人時段切換＋預約");
  const cs = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-schedule.html"), "utf8");
  ok(/slots\/batch-create/.test(cs) && /開放私人時段/.test(cs), "教練端有批次開放私人時段");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  server.close(() => process.exit(bad === 0 ? 0 : 1));
});
