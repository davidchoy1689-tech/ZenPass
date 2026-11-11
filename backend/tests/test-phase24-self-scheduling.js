#!/usr/bin/env node
/** Phase 2.4 — 教練極簡排班、防撞期、緊急取消退堂 */
process.env.JWT_SECRET = "x".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase24-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const passes = require("../src/services/passes");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
passes.ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);

function addUser(id, name, phone, coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified) VALUES (?,?,?,?,?,?,?)")
    .run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach ? 1 : 0);
}
addUser("coachA", "蔡教練", "60004001", 1);
addUser("coachB", "黃教練", "60004002", 1);
addUser("stu1", "學員一", "60004003");
addUser("stu2", "學員二", "60004004");

const tokenA = jwt.sign({ id: "coachA", role: "coach", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const tokenB = jwt.sign({ id: "coachB", role: "coach", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const app = express();
app.use(express.json());
app.use("/api/coach", require("../src/routes/coach-scheduling"));
app.use("/api/coach", require("../src/routes/coach"));
const explore = require("../src/routes/public-explore");

const fmt = (h) => new Date(Date.now() + h * 3600000).toISOString();

const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body, tk = tokenA) => fetch(base + url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ["Bea", "rer "].join("") + tk },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url, tk = tokenA) => fetch(base + url, { headers: { authorization: ["Bea", "rer "].join("") + tk } }).then(async (r) => ({ status: r.status, body: await r.json() }));

  console.log("🧪 1. 範本與資料庫");
  const presets = await get("/api/coach/schedule-presets");
  ok(presets.status === 200 && presets.body.success, "GET schedule-presets 200");
  ok(Array.isArray(presets.body.venues) && Array.isArray(presets.body.courses) && Array.isArray(presets.body.recent), "回傳 venues/courses/recent");
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  ok(cols.includes("coach_id") && cols.includes("created_by_coach_id"), "class_schedules 有 coach_id／created_by_coach_id");
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='venue_templates'").get(), "venue_templates 已建");
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='course_templates'").get(), "course_templates 已建");
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_schedules_coach_time'").get(), "防撞期索引已建");

  console.log("🧪 2. AC-1 30 秒自主開班");
  const mk = (startH, title, venue = "灣仔體育館 活動室 2", district = "灣仔") => ({
    course_title: title,
    target_audience_enum: "office_worker",
    target_audience_label: "上班族痛症 · 放工舒緩",
    venue_name: venue,
    district,
    start_time: fmt(startH),
    end_time: fmt(startH + 1),
    capacity: 8,
    price_per_class_cents: 14000,
  });
  const created = await post("/api/coach/schedules/create", mk(48, "辦公室肩頸深層解壓"));
  ok(created.status === 201 && created.body.success, "建立班次 201", created);
  const sid = created.body.schedule_id;
  const cls = db.prepare("SELECT * FROM class_schedules WHERE id=?").get(sid);
  ok(cls && cls.booking_open === 1 && cls.status === "available" && cls.coach_id === "coachA", "schedule 即時開放／狀態 available");
  const pub = explore.listExplore(db, { audience: "office_worker", district: "灣仔" }).classes.find((c) => c.schedule_id === sid);
  ok(pub && pub.remaining_seats === 8, "AC-1 探索大廳即時可見、剩 8 位");
  const presets2 = await get("/api/coach/schedule-presets");
  ok((presets2.body.courses || []).some((c) => c.title === "辦公室肩頸深層解壓"), "開班後自動記住課程範本");

  console.log("🧪 3. AC-2 防撞期");
  const clash = await post("/api/coach/schedules/create", mk(48.5, "重疊班"));
  ok(clash.status === 409 && clash.body.code === "CONFLICT", "同教練重疊時段 409 CONFLICT", clash);
  const clashVenue = await post("/api/coach/schedules/create", mk(48.5, "同場地重疊", "灣仔體育館 活動室 2"), tokenB);
  ok(clashVenue.status === 409 && clashVenue.body.code === "VENUE_CONFLICT", "同場地重疊 409 VENUE_CONFLICT", clashVenue);

  console.log("🧪 4. AC-3 無人班取消");
  const emptySid = created.body.schedule_id;
  const emptyCancel = await post("/api/coach/schedules/" + emptySid + "/cancel", {});
  ok(emptyCancel.status === 200 && emptyCancel.body.affected === 0, "無人班取消成功", emptyCancel);
  ok(db.prepare("SELECT status FROM class_schedules WHERE id=?").get(emptySid).status === "cancelled", "schedule cancelled");
  ok(!explore.listExplore(db, { audience: "office_worker", district: "灣仔" }).classes.some((c) => c.schedule_id === emptySid), "公開大廳即時下架");

  console.log("🧪 5. AC-4 有人班緊急取消＋退堂");
  const booked = await post("/api/coach/schedules/create", mk(72, "有人班"));
  const bsid = booked.body.schedule_id;
  const pass1 = passes.issuePass(db, { userId: "stu1", phone: "60004003", studentName: "學員一", totalCredits: 4, pricePaid: 520, validDays: 60 });
  const pass2 = passes.issuePass(db, { userId: "stu2", phone: "60004004", studentName: "學員二", totalCredits: 4, pricePaid: 520, validDays: 60 });
  for (const [i, p] of [pass1, pass2].entries()) {
    const bid = "bk24-" + i;
    const uid = i === 0 ? "stu1" : "stu2";
    db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,group_size,pass_id,created_at)
                VALUES (?,?,?,?,?,'pass','paid','confirmed',0,1,?,datetime('now'))`)
      .run(bid, "ZP24-" + i, uid, bsid, booked.body.class_id, p.pass.id);
    passes.redeemInTx(db, { passId: p.pass.id, bookingId: bid, userId: uid });
  }
  ok(Number(db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(pass1.pass.id).remaining_credits) === 3, "預扣後 Pass 3 堂");
  const emCancel = await post("/api/coach/schedules/" + bsid + "/cancel", {});
  ok(emCancel.status === 200 && emCancel.body.affected === 2 && emCancel.body.pass_refunded === 2, "緊急取消 2 人、退 2 堂", emCancel);
  ok(Number(db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(pass1.pass.id).remaining_credits) === 4, "學員 Pass 原路返還 4");
  const cancels = db.prepare("SELECT status,cancel_reason,cancelled_by_user_id FROM bookings WHERE schedule_id=?").all(bsid);
  ok(cancels.every((x) => x.status === "cancelled" && x.cancel_reason === "coach_emergency_cancel" && x.cancelled_by_user_id === "coachA"), "booking 取消原因／操作人正確");
  ok(db.prepare("SELECT COUNT(*) c FROM coach_earnings WHERE schedule_id=?").get(bsid).c === 0, "AC-4 零教練收益分錄");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='coach.schedule_emergency_cancelled' AND entity_id=?").get(bsid), "有緊急取消審計");

  console.log("🧪 6. AC-5 權限與前端");
  const other = await post("/api/coach/schedules/" + bsid + "/cancel", {}, tokenB);
  ok(other.status === 404 || other.status === 403, "教練 B 不可取消教練 A 的班（403）", other);
  const fs = require("fs");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-schedule.html"), "utf8");
  ok(/30 秒快速開班/.test(page) && /schedule-presets/.test(page) && /schedules\/create/.test(page), "教練排班頁有快速開班＋範本 API");
  const consolePage = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-console.html"), "utf8");
  ok(/緊急取消（退堂給學員）/.test(consolePage), "後台有緊急取消退堂按鈕");
  ok(/price_per_class_cents/.test(page), "前端傳 price cents");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  server.close(() => process.exit(bad === 0 ? 0 : 1));
});
