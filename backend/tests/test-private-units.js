#!/usr/bin/env node
/**
 * 一對一私人時段扣堂規則（David 2026-11-12 拍板）
 *   1 對 1 → 每節扣 3 堂；1 對 2 → 每位扣 2 堂；其餘一律 1 堂
 * 驗：① 公式 ② 建 slot 時伺服器覆寫前端數字 ③ 真 booking 扣 3 堂 ④ 取消全數退還 ⑤ 接線
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-privateunits-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};
const fs = require("fs");

const { unitsForPrivate, resolvePrivateUnits } = require("../src/utils/private-units");
const { getDb } = require("../src/services/database");
const passes = require("../src/services/passes");
const bookingService = require("../src/services/booking-service");
const db = getDb();
passes.ensureSchema(db);

console.log("🧪 1. 扣堂公式");
ok(unitsForPrivate(1) === 3, "一對一 = 3 堂");
ok(unitsForPrivate(2) === 2, "一對二 = 2 堂／位");
ok(unitsForPrivate(undefined) === 3, "未知人數 → 保守當 3 堂");
ok(resolvePrivateUnits(1, 2) === 3, "舊 slot 設 2 堂 → 升級為 3 堂（唔會少收）");
ok(resolvePrivateUnits(1, 4) === 4, "教練設更高（4 堂）→ 保留 4，唔會擅自減");
ok(resolvePrivateUnits(2, 0) === 2, "一對二 → 2 堂");
ok(Number.isInteger(unitsForPrivate(1)), "回傳整數");

console.log("\n🧪 2. 建 slot：伺服器覆寫前端數字");
const slotSrc = fs.readFileSync(path.join(__dirname, "../src/routes/private-slots.js"), "utf8");
ok(/const units = resolvePrivateUnits\(maxAttendees, b\.pass_units_required\)/.test(slotSrc), "建立時用規則計，唔信前端");
ok(/const need = resolvePrivateUnits\(slot\.max_attendees, slot\.pass_units_required\)/.test(slotSrc), "預約時再核一次（防舊 slot / 改 DB）");

console.log("\n🧪 3. 真 booking：一對一扣 3 堂");
// 測試 DB 補 is_private（生產由 private-slots.js 的 idempotent migration 加）
const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
if (!ccols.includes("is_private")) db.exec("ALTER TABLE classes ADD COLUMN is_private INTEGER DEFAULT 0");
const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
if (!bcols.includes("units_consumed")) db.exec("ALTER TABLE bookings ADD COLUMN units_consumed INTEGER DEFAULT 1");
if (!bcols.includes("slot_id")) db.exec("ALTER TABLE bookings ADD COLUMN slot_id TEXT");
db.prepare("INSERT INTO users (id,email,name,phone,role,token_version) VALUES ('stu1','s1@t.hk','陳大文','60003001','user',0)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('coach1','c1@t.hk','蔡教練','60003002','coach',1,1,0.8,0)").run();
// 私人 1 對 1 班（is_private=1）
db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,booking_open,venue_name,is_private)
   VALUES ('priv1','coach1','一對一專屬指導','private',60,1,280,28,'active',1,'葵芳體育館',1)`,
).run();
const start = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const end = new Date(Date.now() + 49 * 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(
  `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,coach_override_id)
   VALUES ('sch_priv1','priv1',?,?,1,0,'available','coach1')`,
).run(start, end);
// 8 堂 pass
const p = passes.issuePass(db, { userId: "stu1", studentName: "陳大文", phone: "60003001", totalCredits: 8, pricePaid: 960, validDays: 90 });
const passId = p && p.ok ? p.pass.id : null;
ok(!!passId, "已發 8 堂 pass", p);
const before = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;

const res = bookingService.createBooking({ user: { id: "stu1" }, body: { schedule_id: "sch_priv1", class_id: "priv1", payment_type: "pass", pass_id: passId, penalty_consent: true }, ip: "127.0.0.1", headers: {} });
const status = res && res.body ? res.status : 201;
ok(status === 201 || status === 200, "私人班 pass 預約成功（" + status + "）", res && res.body);
const after = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
ok(before - after === 3, `扣堂 = ${before - after} 堂（應為 3）`);
const bk = db.prepare("SELECT id,units_consumed FROM bookings WHERE schedule_id='sch_priv1' ORDER BY created_at DESC LIMIT 1").get();
ok(bk && Number(bk.units_consumed) === 3, `bookings.units_consumed = ${bk && bk.units_consumed}`);
const red = db.prepare("SELECT credits FROM pass_redemptions WHERE booking_id=?").get(bk && bk.id);
ok(red && Number(red.credits) === 3, `pass_redemptions.credits = ${red && red.credits}`);

console.log("\n🧪 4. 取消 → 全數退還 3 堂");
passes.restoreInTx(db, { passId, bookingId: bk.id });
const rest = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
ok(rest === before, `退還後 = ${rest} 堂（原本 ${before}）`);

console.log("\n🧪 5. 一般團體班不受影響");
db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,booking_open,venue_name,is_private)
   VALUES ('grp1','coach1','樂齡防跌班','fitness',60,8,140,14,'active',1,'葵芳體育館',0)`,
).run();
db.prepare(
  `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,coach_override_id)
   VALUES ('sch_grp1','grp1',?,?,8,0,'available','coach1')`,
).run(start, end);
const before2 = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
const res2 = bookingService.createBooking({ user: { id: "stu1" }, body: { schedule_id: "sch_grp1", class_id: "grp1", payment_type: "pass", pass_id: passId, penalty_consent: true }, ip: "127.0.0.1", headers: {} });
const st2 = res2 && res2.body ? res2.status : 201;
ok(st2 === 201 || st2 === 200, "團體班 pass 預約成功", res2 && res2.error);
const after2 = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
ok(before2 - after2 === 1, `團體班扣 ${before2 - after2} 堂（應為 1）`);

console.log("\n🧪 6. 修補：私人班 credits 成本唔可以低過價錢");
const cc = require("../src/utils/credits-cost");
ok(cc.creditsForPrice(280) === 28, "HK$280 → 28 credits");
ok(cc.creditsForPrice(260) === 26, "HK$260 → 26 credits");
ok(cc.atLeastPriceCredits(3, 280) === 28, "舊資料 3 credits（HK$30）→ 升到 28");
ok(cc.atLeastPriceCredits(28, 280) === 28, "已正確 → 唔會變");
ok(cc.atLeastPriceCredits(30, 280) === 30, "教練設更高 → 保留");

// 舊資料情境：credits_cost 仍然係 3，實際用 credits 付款要收 28
db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,booking_open,venue_name,is_private)
   VALUES ('priv_legacy','coach1','一對一舊班','private',60,1,280,3,'active',1,'葵芳體育館',1)`,
).run();
const st3 = new Date(Date.now() + 72 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const en3 = new Date(Date.now() + 73 * 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(
  `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,coach_override_id)
   VALUES ('sch_legacy','priv_legacy',?,?,1,0,'available','coach1')`,
).run(st3, en3);
// 用第二個學員，俾 40 credits
db.prepare("INSERT INTO users (id,email,name,phone,role,token_version,credits) VALUES ('stu2','s2@t.hk','李小明','60003003','user',0,40)").run();
const cBefore = Number(db.prepare("SELECT credits FROM users WHERE id='stu2'").get().credits) || 0;
const resC = bookingService.createBooking({ user: { id: "stu2" }, body: { schedule_id: "sch_legacy", class_id: "priv_legacy", payment_type: "credits", penalty_consent: true }, ip: "127.0.0.1", headers: {} });
const stC = resC && resC.body ? resC.status : 201;
ok(stC === 201 || stC === 200, "私人班用 credits 預約成功（" + stC + "）", resC && resC.body);
const cAfter = Number(db.prepare("SELECT credits FROM users WHERE id='stu2'").get().credits) || 0;
ok(cBefore - cAfter === 28, `扣 ${cBefore - cAfter} credits（應為 28，舊資料 3 都會升）`);

// 建 slot 時寫入正確 credits_cost
ok(/priceCheck\.credits/.test(slotSrc), "開私人 slot 時 credits_cost 用定價帶算出（價錢 ÷ 10）");

console.log("\n🧪 7. 定價帶：50–60 credits（HK$500–600），教練自己決定");
const pp = require("../src/utils/private-pricing");
const band = pp.priceBand(db);
ok(band.minCredits === 50 && band.maxCredits === 60, `預設帶 = ${band.minCredits}–${band.maxCredits} credits`);
ok(pp.validatePrivatePrice(db, 50000).ok, "HK$500（50 credits）→ 接受");
ok(pp.validatePrivatePrice(db, 55000).ok, "HK$550（55 credits）→ 接受");
ok(pp.validatePrivatePrice(db, 60000).ok, "HK$600（60 credits）→ 接受");
ok(!pp.validatePrivatePrice(db, 49000).ok, "HK$490（49 credits）→ 拒絕");
ok(!pp.validatePrivatePrice(db, 61000).ok, "HK$610（61 credits）→ 拒絕");
ok(!pp.validatePrivatePrice(db, 28000).ok, "舊價 HK$280 → 拒絕");
const okPrice = pp.validatePrivatePrice(db, 53000);
ok(okPrice.ok && okPrice.credits === 53 && okPrice.price_cents === 53000, "教練自定 HK$530 → 53 credits");
ok(/定價必須 HK\$500–600/.test(pp.validatePrivatePrice(db, 28000).error || ""), "錯誤訊息講明帶範圍");
// 帶可由 platform_settings 調整
db.exec("CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT)");
db.prepare("INSERT OR REPLACE INTO platform_settings (key,value) VALUES ('pricing.private_credits_min','55')").run();
db.prepare("INSERT OR REPLACE INTO platform_settings (key,value) VALUES ('pricing.private_credits_max','70')").run();
ok(pp.priceBand(db).minCredits === 55 && pp.priceBand(db).maxCredits === 70, "settings 可調帶（55–70）");
ok(pp.validatePrivatePrice(db, 28000).ok === false, "調帶後 HK$280 仍拒絕");
ok(pp.validatePrivatePrice(db, 65000).ok, "調帶後 HK$650（65 credits）→ 接受");

console.log("\n🧪 8. 前端文案一致");
const ex = fs.readFileSync(path.join(__dirname, "../../frontend-v2/explore.html"), "utf8");
const cs = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-schedule.html"), "utf8");
ok(/一對一專屬（扣 3 堂）/.test(ex), "explore 切換鈕寫「扣 3 堂」");
ok(!/扣 2 堂/.test(ex), "explore 已清除「扣 2 堂」");
ok(/id="pvUnits"[^>]*value="3"/.test(cs), "教練開 slot 預設 3 堂");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
