#!/usr/bin/env node
/** Phase 2.2 — 探索大廳＋家庭 Pass 一鍵預約 */
process.env.JWT_SECRET = "phase22-secret-".repeat(4);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase22-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const passes = require("../src/services/passes");
const fw = require("../src/services/family-wallet");
const explore = require("../src/routes/public-explore");
const jwt = require("jsonwebtoken");
const db = getDb();
passes.ensureSchema(db);
fw.ensureSchema(db);
explore.ensureExploreSchema(db);

function addUser(id, name, phone, role = "user") {
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES (?,?,?,?,?)").run(id, id + "@t.hk", name, phone, role);
}
addUser("daughter", "陳小姐", "60003001");
addUser("father", "陳大文", "60003002");
addUser("stranger", "陌生人", "60003003");
addUser("coach1", "蔡教練", "60003004", "coach");
addUser("nopass", "無Pass學員", "60003005");
db.prepare("INSERT INTO family_groups (id,owner_user_id,group_name) VALUES ('fam22','daughter','陳氏家庭')").run();
db.prepare("INSERT INTO family_members (id,family_group_id,member_user_id,relation_title,can_consume_pass) VALUES ('fm22','fam22','father','father',1)").run();

const tomorrow = new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const later = new Date(Date.now() + 26 * 3600000 + 3600000).toISOString().slice(0, 19).replace("T", " ");
function addClass(id, title, aud, district, open = 1, ref = null) {
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,target_audience_enum,target_audience_label,district,booking_open,venue_name,class_reference)
              VALUES (?,?,?,?,60,?,?, 'active', ?, ?, ?, ?, ?, ?)`)
    .run(id, "coach1", title, "stretch", 140, 8, aud, aud === "elderly" ? "熟齡防跌" : "上班族痛症", district, open, district + "體育館", ref);
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district)
              VALUES (?,?,?,?,8,0,'available',?,?)`).run("sch-" + id, id, tomorrow, later, open, district);
}
addClass("c-elder", "樂齡防跌與膝關節減壓班", "elderly", "葵青");
addClass("c-office", "辦公室肩頸深層解壓", "office_worker", "灣仔");
addClass("c-full", "已滿防跌班", "elderly", "葵青");
addClass("c-closed", "未開放班", "elderly", "葵青", 0);
addClass("c-test", "PRODTEST 防跌", "elderly", "葵青", 1, "VERIFIED_TEST_20261111");
db.prepare("UPDATE class_schedules SET enrolled_count=8 WHERE id='sch-c-full'").run();
db.prepare("UPDATE class_schedules SET id='prodtest-sch-22' WHERE id='sch-c-test'").run();

console.log("🧪 1. 公開探索 API");
const all = explore.listExplore(db, {});
ok(all.classes.length === 2, "只回傳有位、開放、非測試班", all.classes.map((c) => c.schedule_id));
ok(!all.classes.some((c) => c.schedule_id.includes("prodtest")), "排除 prodtest");
ok(!all.classes.some((c) => c.schedule_id === "sch-c-closed"), "排除未開放");
ok(!all.classes.some((c) => c.schedule_id === "sch-c-full"), "排除已滿");
const elder = explore.listExplore(db, { audience: "elderly", district: "kts" });
ok(elder.classes.length === 1 && elder.classes[0].schedule_id === "sch-c-elder", "受眾＋葵青複合篩選");
ok(elder.classes[0].remaining_seats === 8 && elder.classes[0].district === "葵青", "剩餘席位與地區正確");
ok(elder.classes[0].target_audience_enum === "elderly" && elder.classes[0].price_cents === 14000, "受眾 enum 與金額 cents 正確");
const office = explore.listExplore(db, { audience: "office_worker", district: "wc" });
ok(office.classes.length === 1 && office.classes[0].schedule_id === "sch-c-office", "灣仔＋上班族篩選");
const t0 = process.hrtime.bigint();
for (let i = 0; i < 30; i++) explore.listExplore(db, { audience: "elderly", district: "kts" });
const avgMs = Number(process.hrtime.bigint() - t0) / 1e6 / 30;
ok(avgMs < 50, `複合查詢平均 ${avgMs.toFixed(2)}ms < 50ms`, avgMs);

console.log("🧪 2. 家庭 Pass 一鍵預約 HTTP");
const issued = passes.issuePass(db, { userId: "daughter", phone: "60003001", studentName: "陳小姐", totalCredits: 4, pricePaid: 520, validDays: 60, familyGroupId: "fam22", ownerUserId: "daughter" });
ok(issued.ok, "家庭 Pass 簽發");
const token = jwt.sign({ id: "daughter", role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const tokenFather = jwt.sign({ id: "father", role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const tokenNoPass = jwt.sign({ id: "nopass", role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const express = require("express");
const app = express();
app.use(express.json());
app.use("/api/bookings", require("../src/routes/bookings"));
app.use("/api/public/explore", explore);
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const pub = await fetch(base + "/api/public/explore/classes?audience=elderly&district=kts").then((r) => r.json());
  ok(pub.success && pub.classes.length === 1 && pub.classes[0].schedule_id === "sch-c-elder", "公開 HTTP 端點回傳正確");
  const call = (body, key, tk) => fetch(base + "/api/bookings/book-with-pass", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + (tk || token), "idempotency-key": key || "k-" + Date.now() + Math.random() },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const r1 = await call({ schedule_id: "sch-c-elder", attendee_user_id: "father" });
  ok(r1.status === 201 && r1.body.success, "女兒為父親扣家庭 Pass 預約", r1);
  ok(r1.body.pass && r1.body.pass.remaining_credits === 3 && r1.body.attendee.id === "father", "Pass 4→3、出席人＝父親");
  const bk = db.prepare("SELECT * FROM bookings WHERE id=?").get(r1.body.booking_id);
  ok(bk && bk.user_id === "father" && bk.payment_type === "pass" && bk.payment_status === "paid" && bk.status === "confirmed", "booking 寫入父親、pass/paid/confirmed");
  ok(Number(db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(issued.pass.id).remaining_credits) === 3, "DB Pass 餘 3");
  const badge = fw.describePass(db, "father", issued.pass.id);
  ok(badge.pass_type === "family" && badge.remaining_units === 3 && badge.display_badge.includes("陳小姐"), "Roster 家庭 Pass badge");

  const r2 = await call({ schedule_id: "sch-c-elder", attendee_user_id: "father" });
  ok(r2.status === 409 && r2.body.code === "ALREADY_BOOKED", "重複預約被擋");

  const r3 = await call({ schedule_id: "sch-c-office", attendee_user_id: "stranger" });
  ok(r3.status === 403 && r3.body.code === "FAMILY_MEMBER_REQUIRED", "不可替非家庭成員預約");

  const r4 = await call({ schedule_id: "sch-c-full", attendee_user_id: "father" }, null, tokenFather);
  ok(r4.status === 409 && r4.body.code === "CLASS_FULL", "額滿 409", r4);

  const r5 = await call({ schedule_id: "sch-c-office", attendee_user_id: "nopass" }, null, tokenNoPass);
  ok(r5.status === 400 && r5.body.code === "NO_PASS", "無 Pass 學員 → NO_PASS", r5);

  console.log("🧪 3. 前端與索引");
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "../../frontend-v2/explore.html"), "utf8");
  ok(/liveNow/.test(html) && /api\/public\/explore\/classes/.test(html), "explore 有即時有位卡流＋公開 API");
  ok(/bookings\/book-with-pass/.test(html) && /bpAttendee/.test(html), "有學員選擇及一鍵扣堂");
  ok(/熟齡防跌/.test(html) && /18 區|ZONES/.test(html), "受眾 pills＋18 區");
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_schedules_explore'").get();
  ok(!!idx, "探索複合索引已建立");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  server.close(() => process.exit(bad === 0 ? 0 : 1));
});
