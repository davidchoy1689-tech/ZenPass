#!/usr/bin/env node
/**
 * test-passes.js — 4 堂通行證（Multi-Pass）
 * 驗證：簽發、扣堂原子性、防超扣、防越權、過期、取消回滾
 */
const path = require("path");
const os = require("os");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-passes-" + Date.now() + ".db");

const Database = require("better-sqlite3");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

let passed = 0, failed = 0;
const ok = (c, m, x) => { c ? (passed++, console.log("  ✅", m)) : (failed++, console.log("  ❌", m, x == null ? "" : x)); };

console.log("🧪 4 堂通行證（Multi-Pass）");
initDatabase();
updateDatabase();

const TMP = process.env.DB_PATH;
const db = new Database(TMP);
db.pragma("foreign_keys = ON");
const future = new Date(Date.now() + 7 * 86400000);
const iso = future.toISOString().slice(0, 19).replace("T", " ");
const later = new Date(Date.now() + 7 * 86400000 + 7200000).toISOString().slice(0, 19).replace("T", " ");

db.prepare("INSERT INTO users (id,email,name,phone,credits,role,email_verified) VALUES ('u1','a@t.hk','陳小明','98765432',0,'user',1)").run();
db.prepare("INSERT INTO users (id,email,name,phone,credits,role,email_verified) VALUES ('u2','b@t.hk','李小姐','91234567',0,'user',1)").run();
db.prepare("INSERT INTO users (id,email,name,phone,credits,role,email_verified) VALUES ('coach','c@t.hk','教練','90001111',0,'coach',1)").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES ('c1','coach','樂齡防跌關節班','伸展',60,2,140,14,'active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,2,0,'available')").run(iso, later);
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',?,?,1,1,'available')").run(iso, later);
db.close();

const passes = require("../src/services/passes");
const { createBooking } = require("../src/services/booking-service");

function getPass(id) { const d = new Database(TMP); const r = d.prepare("SELECT * FROM user_passes WHERE id=?").get(id); d.close(); return r; }
function enrolled(sid) { const d = new Database(TMP); const r = d.prepare("SELECT enrolled_count FROM class_schedules WHERE id=?").get(sid).enrolled_count; d.close(); return r; }
function bookings(passId) { const d = new Database(TMP); const n = d.prepare("SELECT COUNT(*) n FROM bookings WHERE pass_id=?").get(passId).n; d.close(); return n; }

console.log("\n📋 1. 簽發");
const d0 = new Database(TMP);
passes.ensureSchema(d0);
const issued = passes.issuePass(d0, { phone: "9876 5432", studentName: "陳伯伯", totalCredits: 4, pricePaid: 480, validDays: 60, createdBy: "admin" });
ok(issued.ok, "簽發成功");
ok(/^PASS-\d{4}-[A-Z2-9]{4}$/.test(issued.pass.id), "編號格式 PASS-YYMM-XXXX", issued.pass.id);
ok(issued.pass.remaining_credits === 4 && issued.pass.total_credits === 4, "4 堂");
ok(issued.pass.price_paid === 480, "實付 $480");
const autoUser = d0.prepare("SELECT user_id FROM user_passes WHERE id=?").get(issued.pass.id).user_id;
ok(autoUser === "u1", "自動綁定同電話帳戶", autoUser);
const p1 = issued.pass.id;

const list = passes.listActiveForUser(d0, { id: "u1", phone: "98765432" });
ok(list.length === 1 && list[0].remaining_credits === 4, "本人可見 1 張有效卡");
ok(passes.listActiveForUser(d0, { id: "u2", phone: "91234567" }).length === 0, "其他人見唔到");
d0.close();

console.log("\n📋 2. 扣堂預約（$0 即時確認）");
const r1 = createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "pass", pass_id: p1, penalty_consent: true }, user: { id: "u1" }, headers: {}, ip: "127.0.0.1" });
ok(r1.status === 201, "扣堂預約成功 201", r1.status + " " + JSON.stringify(r1.body).slice(0, 120));
ok(r1.body.amount === 0 && r1.body.payment_status === "paid", "金額 $0 / 已付款");
ok(r1.body.requires_payment === false, "唔需要再付款");
ok(r1.body.pass && r1.body.pass.remaining_credits === 3, "回傳剩餘 3 堂", r1.body.pass && r1.body.pass.remaining_credits);
ok(enrolled("s1") === 1, "名額 +1");
ok(bookings(p1) === 1, "booking 已記 pass_id");

console.log("\n📋 3. 防重複／防超扣");
const r2 = createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "pass", pass_id: p1, penalty_consent: true }, user: { id: "u1" }, headers: {} });
ok(r2.status === 409, "同一班重複預約 → 409", r2.status);
ok(getPass(p1).remaining_credits === 3, "重複失敗冇扣多一堂");

const r3 = createBooking({ body: { schedule_id: "s2", class_id: "c1", payment_type: "pass", pass_id: p1, penalty_consent: true }, user: { id: "u1" }, headers: {} });
ok(r3.status === 409, "滿額班 → 409");
ok(getPass(p1).remaining_credits === 3, "滿額失敗冇扣堂（transaction 回滾）", getPass(p1).remaining_credits);
ok(enrolled("s2") === 1, "滿額班名額冇變");

console.log("\n📋 4. 越權／過期／用完");
const r4 = createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "pass", pass_id: p1, penalty_consent: true }, user: { id: "u2" }, headers: {} });
ok(r4.status === 403 && r4.body.code === "PASS_FORBIDDEN", "別人用我張卡 → 403", r4.status);
const r5 = createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "pass", pass_id: "PASS-0000-XXXX", penalty_consent: true }, user: { id: "u1" }, headers: {} });
ok(r5.status === 400 && r5.body.code === "PASS_NOT_FOUND", "不存在 → 400");

const d1 = new Database(TMP);
const expired = passes.issuePass(d1, { phone: "98765432", studentName: "陳伯伯", totalCredits: 4, pricePaid: 480, validDays: 1 });
d1.prepare("UPDATE user_passes SET expires_at = datetime('now','-1 day') WHERE id=?").run(expired.pass.id);
d1.close();
const r6 = createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "pass", pass_id: expired.pass.id, penalty_consent: true }, user: { id: "u1" }, headers: {} });
ok(r6.status === 400 && r6.body.code === "PASS_EXPIRED", "過期卡 → 400", r6.body.code);

const d2 = new Database(TMP);
const small = passes.issuePass(d2, { phone: "98765432", studentName: "陳伯伯", totalCredits: 1, pricePaid: 120, validDays: 60 });
d2.prepare("UPDATE user_passes SET remaining_credits = 0, status='exhausted' WHERE id=?").run(small.pass.id);
d2.close();
const r7 = createBooking({ body: { schedule_id: "s1", class_id: "c1", payment_type: "pass", pass_id: small.pass.id, penalty_consent: true }, user: { id: "u1" }, headers: {} });
ok(r7.status === 400 && (r7.body.code === "PASS_EXHAUSTED" || r7.body.code === "PASS_INACTIVE"), "用完 → 400", r7.body.code);

console.log("\n📋 5. 取消回滾");
const d3 = new Database(TMP);
const before = d3.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(p1).remaining_credits;
const restored = passes.restoreInTx(d3, { passId: p1, bookingId: r1.body.booking_id });
d3.close();
ok(restored === true, "取消回滾 1 堂成功");
ok(getPass(p1).remaining_credits === before + 1, "剩餘堂數 +1", before + " → " + getPass(p1).remaining_credits);
const d4 = new Database(TMP);
ok(passes.restoreInTx(d4, { passId: p1, bookingId: r1.body.booking_id }) === false, "同一 booking 唔會回滾兩次");
d4.close();
ok(getPass(p1).remaining_credits === before + 1, "重複回滾冇加到堂");


console.log("\n📋 6. 通行證自助改期");
{
  const d = new Database(TMP);
  const mkSch = (id, hours, cap, enr) => {
    const a = new Date(Date.now() + hours * 3600000);
    const b = new Date(a.getTime() + 7200000);
    const f = (x) => x.toISOString().slice(0, 19).replace("T", " ");
    d.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES (?,?,?,?,?,?,'available')").run(id, "c1", f(a), f(b), cap, enr);
  };
  mkSch("sorig", 48, 8, 0);     // 原班：48h
  mkSch("sorig2", 48, 8, 0);    // 第二個原班
  mkSch("sfar", 72, 8, 1);      // 目標：有位
  mkSch("ssoon", 23.9, 8, 0);   // 原班 <24h
  mkSch("sfull", 72, 2, 2);     // 目標：已滿
  mkSch("slast", 96, 3, 2);     // 目標：剩 1 席（併發）
  mkSch("sother", 120, 8, 0);

  const pA = passes.issuePass(d, { phone: "98765432", studentName: "陳伯伯", totalCredits: 4, pricePaid: 480, validDays: 60 }).pass.id;
  const pB = passes.issuePass(d, { phone: "91234567", studentName: "李婆婆", totalCredits: 4, pricePaid: 480, validDays: 60 }).pass.id;
  d.close();

  const { rescheduleBooking } = require("../src/services/booking-service");
  const mkBooking = (sid, uid, pid) => createBooking({ body: { schedule_id: sid, class_id: "c1", payment_type: "pass", pass_id: pid, penalty_consent: true }, user: { id: uid }, headers: {} });
  const enr = (sid) => { const x = new Database(TMP); const n = x.prepare("SELECT enrolled_count FROM class_schedules WHERE id=?").get(sid).enrolled_count; x.close(); return n; };
  const passLeft = (pid) => { const x = new Database(TMP); const n = x.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(pid).remaining_credits; x.close(); return n; };

  // 測試1：成功改期
  const b1 = mkBooking("sorig", "u1", pA);
  ok(b1.status === 201, "建立改期用預約", b1.status);
  const leftBefore = passLeft(pA);
  const r1 = rescheduleBooking({ bookingId: b1.body.booking_id, userId: "u1", targetScheduleId: "sfar" });
  ok(r1.status === 200 && r1.body.success, "48 小時前改期成功", JSON.stringify(r1.body).slice(0, 120));
  ok(enr("sorig") === 0 && enr("sfar") === 2, "舊班 -1、新班 +1", `sorig=${enr("sorig")} sfar=${enr("sfar")}`);
  ok(passLeft(pA) === leftBefore, "堂數完全不變（不退回重扣）", `${leftBefore} → ${passLeft(pA)}`);
  { const x = new Database(TMP); const sid = x.prepare("SELECT schedule_id FROM bookings WHERE id=?").get(b1.body.booking_id).schedule_id; x.close();
    ok(sid === "sfar", "booking.schedule_id 已更新", sid); }

  // 測試2：<24h 拒絕
  const b2 = mkBooking("ssoon", "u1", pA);
  const before = { old: enr("ssoon"), tgt: enr("sother") };
  const r2 = rescheduleBooking({ bookingId: b2.body.booking_id, userId: "u1", targetScheduleId: "sother" });
  ok(r2.status === 400 && r2.body.code === "RESCHEDULE_WINDOW_CLOSED", "23.9 小時前 → 400", r2.body.code);
  ok(enr("ssoon") === before.old && enr("sother") === before.tgt, "拒絕時兩班席位無變");

  // 測試3：滿額 409 + 回滾
  const r3 = rescheduleBooking({ bookingId: b1.body.booking_id, userId: "u1", targetScheduleId: "sfull" });
  ok(r3.status === 409 && r3.body.code === "TARGET_FULL", "目標滿額 → 409", r3.body.code);
  ok(enr("sfar") === 2, "滿額失敗後原班席位保持", String(enr("sfar")));

  // 測試4：IDOR
  const r4 = rescheduleBooking({ bookingId: b1.body.booking_id, userId: "u2", targetScheduleId: "sother" });
  ok(r4.status === 403, "非本人改期 → 403", r4.status);

  // 測試5：剩 1 席，兩人搶 → 只有 1 人成功
  const bC = mkBooking("sorig2", "u2", pB);
  ok(bC.status === 201, "建立第二個改期預約", bC.status);
  const r5a = rescheduleBooking({ bookingId: b1.body.booking_id, userId: "u1", targetScheduleId: "slast" });
  const r5b = rescheduleBooking({ bookingId: bC.body.booking_id, userId: "u2", targetScheduleId: "slast" });
  ok((r5a.status === 200) !== (r5b.status === 200), "兩人搶 1 席只有 1 人成功", `${r5a.status}/${r5b.status}`);
  ok(enr("slast") >= 3, "目標班次唔會超賣（<= cap）", String(enr("slast")));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
