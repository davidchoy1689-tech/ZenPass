#!/usr/bin/env node
/** Phase 3.1 — Studio 入駐、空位拋售、三方分帳 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase31-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const merchant = require("../src/routes/merchant");
const studioLedger = require("../src/services/studio-ledger");
const explore = require("../src/routes/public-explore");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
merchant.ensureSchema(db);
studioLedger.ensureSchema(db);
explore.ensureExploreSchema(db);
const passes = require("../src/services/passes");
passes.ensureSchema(db);

function addUser(id, name, phone, coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified) VALUES (?,?,?,?,?,?,?)")
    .run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach ? 1 : 0);
}
addUser("ownerA", "Studio A 老闆", "60007001");
addUser("ownerB", "Studio B 老闆", "60007002");
addUser("coachA", "Mary 教練", "60007003", 1);
addUser("student", "學員甲", "60007004");
const token = (id) => jwt.sign({ id, role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const app = express();
app.use(express.json());
app.use("/api", merchant);
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body, tk) => fetch(base + url, { method: "POST", headers: { "content-type": "application/json", authorization: ["Bea", "rer "].join("") + tk }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url, tk) => fetch(base + url, { headers: { authorization: ["Bea", "rer "].join("") + tk } }).then(async (r) => ({ status: r.status, text: await r.text(), type: r.headers.get("content-type") }));

  console.log("🧪 1. AC-1 商戶入駐＋拋售 3 個名額");
  const regA = await post("/api/merchant/studios/register", {
    studio_name: "Zenith Pilates", district: "灣仔", address: "灣仔軒尼詩道 123 號 2 樓",
    contact_phone: "60007001", category_tags: ["pilates", "pain_relief"], payout_fps_id: "FPS-A",
  }, token("ownerA"));
  ok(regA.status === 201 && regA.body.studio_id, "Studio A 入駐", regA);
  const studioA = regA.body.studio_id;
  db.prepare(`INSERT INTO studio_coaches (id,studio_id,coach_user_id,role_title,coach_payout_rate,status)
              VALUES ('sc-coach','${studioA}','coachA','Instructor',0.5,'active')`).run();
  const start = new Date(Date.now() + 48 * 3600000).toISOString();
  const end = new Date(Date.now() + 49 * 3600000).toISOString();
  const push = await post("/api/merchant/schedules/push-capacity", {
    studio_id: studioA, course_title: "普拉提深層核心 Reformer", target_audience_enum: "office_worker",
    target_audience_label: "辦公室肩頸腰痛修復", start_time: start, end_time: end,
    coach_user_id: "coachA", dropin_capacity: 3, price_per_class_cents: 18000,
  }, token("ownerA"));
  ok(push.status === 201 && push.body.schedule_id, "拋售成功", push);
  const sid = push.body.schedule_id;
  const srow = db.prepare("SELECT studio_id,is_dropin_enabled FROM class_schedules WHERE id=?").get(sid);
  ok(srow.studio_id === studioA && srow.is_dropin_enabled === 1, "schedule 關聯 studio／dropin");
  const pub = explore.listExplore(db, { district: "灣仔" }).classes.find((c) => c.schedule_id === sid);
  ok(pub && pub.remaining_seats === 3 && pub.studio_name === "Zenith Pilates" && pub.is_studio === 1, "探索即時可見、剩 3 位、Studio 標籤", pub);

  console.log("🧪 2. AC-2 三方分帳");
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,created_at)
              VALUES ('bk-studio','ZP-STUDIO','student',?,(SELECT class_id FROM class_schedules WHERE id=?),'single','paid','attended',180,18000,datetime('now'))`).run(sid, sid);
  const settle = studioLedger.settleStudioSchedule(sid);
  ok(settle.ok && settle.count === 1, "結算 1 筆", settle);
  ok(settle.platform_fee_cents === 2700 && settle.coach_payout_cents === 7650 && settle.studio_payout_cents === 7650, "15% / 50% / 50% 整數", settle);
  ok(settle.platform_fee_cents + settle.coach_payout_cents + settle.studio_payout_cents === 18000, "2700+7650+7650=18000");
  const ledger = db.prepare("SELECT * FROM studio_earnings_ledger WHERE booking_id='bk-studio'").get();
  ok(ledger && ledger.gross_cents === 18000, "ledger 寫入");

  console.log("🧪 3. AC-3 自有舊生 0% 抽佣");
  const push2 = await post("/api/merchant/schedules/push-capacity", {
    studio_id: studioA, course_title: "館內月費班", start_time: new Date(Date.now() + 72 * 3600000).toISOString(),
    end_time: new Date(Date.now() + 73 * 3600000).toISOString(), coach_user_id: "coachA", dropin_capacity: 2, price_per_class_cents: 18000,
  }, token("ownerA"));
  ok(push2.status === 201, "第二班建立");
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,attendee_type,created_at)
              VALUES ('bk-internal','ZP-INT','student',?,(SELECT class_id FROM class_schedules WHERE id=?),'single','paid','attended',180,18000,'studio_internal_student',datetime('now'))`).run(push2.body.schedule_id, push2.body.schedule_id);
  const internal = studioLedger.settleStudioSchedule(push2.body.schedule_id);
  ok(internal.ok && internal.count === 0, "館內舊生不計平台分帳", internal);
  ok(!db.prepare("SELECT 1 FROM studio_earnings_ledger WHERE booking_id='bk-internal'").get(), "無內部學生 ledger");

  console.log("🧪 4. AC-4 權限與報表");
  const regB = await post("/api/merchant/studios/register", { studio_name: "Pulse Boxing", district: "旺角", address: "旺角登打士街 56 號", contact_phone: "60007002" }, token("ownerB"));
  const cross = await post("/api/merchant/schedules/push-capacity", { studio_id: studioA, course_title: "偷開班", start_time: start, end_time: end, dropin_capacity: 1, price_per_class_cents: 18000 }, token("ownerB"));
  ok(cross.status === 403, "Studio B 不可操作 Studio A（403）", cross);
  const csv = await get("/api/merchant/studios/" + studioA + "/statement.csv", token("ownerA"));
  ok(csv.status === 200 && /text\/csv/.test(csv.type || "") && csv.text.includes("Studio Name") && csv.text.includes("Zenith Pilates"), "CSV 有 Studio Name");
  ok(!csv.text.includes("prodtest"), "CSV 排除 prodtest");

  console.log("🧪 5. 前端與 migration");
  const fs = require("fs");
  const portal = fs.readFileSync(path.join(__dirname, "../../frontend-v2/studio-portal.html"), "utf8");
  ok(/push-capacity/.test(portal) && /Studio 商戶工作台/.test(portal), "studio-portal 有拋售表單");
  const ex = fs.readFileSync(path.join(__dirname, "../../frontend-v2/explore.html"), "utf8");
  ok(/studio_name/.test(ex), "探索卡顯示 Studio");
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  ok(cols.includes("studio_id") && cols.includes("is_dropin_enabled"), "schedules 有 studio_id／is_dropin");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  server.close(() => process.exit(bad === 0 ? 0 : 1));
});
