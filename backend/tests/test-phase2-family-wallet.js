#!/usr/bin/env node
/** test-phase2-family-wallet.js — 受眾正規化＋家庭共享扣堂 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p2-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")(); require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const passes = require("../src/services/passes");
const fw = require("../src/services/family-wallet");
passes.ensureSchema(db); fw.ensureSchema(db);

const U = (id, name, phone) =>
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES (?,?,?,?,'user')").run(id, id + "@t.hk", name, phone);
U("daughter", "陳小姐", "60001001");
U("father", "陳大文", "60001002");
U("other", "其他學員", "60001003");
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach) VALUES ('c1','c1@t.hk','教練','60001009','coach',1)").run();

db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,target_audience) VALUES ('cl1','c1','長者防跌班','stretch',90,12,140,14,'長者')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,target_audience) VALUES ('cl2','c1','辦公室肩頸班','stretch',60,12,160,16,'在職人士・初學者・任何年齡')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,target_audience) VALUES ('cl3','c1','產後核心班','stretch',60,10,180,18,'產後媽媽')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,status) VALUES ('s1','cl1','2026-11-20 02:00:00','2026-11-20 03:30:00','available')").run();
fw.ensureSchema(db);

console.log("🧪 AC-1 受眾正規化");
const c1 = db.prepare("SELECT * FROM classes WHERE id='cl1'").get();
const c2 = db.prepare("SELECT * FROM classes WHERE id='cl2'").get();
const c3 = db.prepare("SELECT * FROM classes WHERE id='cl3'").get();
ok(c1.target_audience_enum === "elderly" && c1.target_audience_label === "長者", "長者 → elderly，原文保留");
ok(c2.target_audience_enum === "office_worker", "在職人士 → office_worker");
ok(c3.target_audience_enum === "postnatal", "產後媽媽 → postnatal");
ok(fw.badgesForAudience("office_worker").label.includes("辦公室"), "Badge 文案正確");

console.log("🧪 AC-2 audience 篩選");
const countAud = (a) => db.prepare("SELECT COUNT(*) c FROM classes WHERE COALESCE(target_audience_enum,'general_fitness')=?").get(a).c;
ok(countAud("elderly") === 1 && countAud("office_worker") === 1 && countAud("postnatal") === 1, "三個受眾各 1 班");

console.log("🧪 AC-3 家庭共享扣堂");
db.prepare("INSERT INTO family_groups (id,owner_user_id,group_name) VALUES ('fg1','daughter','陳氏家庭健康通票')").run();
db.prepare("INSERT INTO family_members (id,family_group_id,member_user_id,relation_title,can_consume_pass) VALUES ('fm1','fg1','father','father',1)").run();
const passId = "pass-fam-1";
db.prepare("INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,status,expires_at,owner_user_id,family_group_id) VALUES (?,?,?,?,4,4,'active',datetime('now','+90 days'),?,?)").run(passId, "daughter", "60001001", "陳小姐", "daughter", "fg1");

const a1 = fw.findApplicablePass(db, "father");
ok(a1 && a1.source === "family" && a1.pass.id === passId, "父親無個人 Pass → 用家庭 Pass", a1 && a1.source);
ok(a1.payerName === "陳小姐", "付款人姓名 = 陳小姐");
const before = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,payment_type) VALUES ('b1','ZP1','father','s1','cl1','confirmed','paid',0,'pass')").run();
db.transaction(() => passes.redeemInTx(db, { passId, userId: "father", bookingId: "b1" }))();
const after = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
ok(before === 4 && after === 3, "點名扣家庭 Pass：4 → 3", { before, after });
const badge = fw.describePass(db, "father", passId);
ok(badge.pass_type === "family" && badge.display_badge.includes("陳小姐") && badge.remaining_units === 3, "Roster badge：使用 [陳小姐] 家庭Pass · 餘 3", badge);

console.log("🧪 AC-4 個人 Pass 優先");
const p2 = "pass-self-1";
db.prepare("INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,status,expires_at,owner_user_id) VALUES (?,?,?,?,1,1,'active',datetime('now','+30 days'),?)").run(p2, "father", "60001002", "陳大文", "father");
const a2 = fw.findApplicablePass(db, "father");
ok(a2.source === "personal" && a2.pass.id === p2, "有個人 Pass → 優先扣個人", a2.source);
const famBefore = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits;
db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,payment_type) VALUES ('b2','ZP2','father','s1','cl1','confirmed','paid',0,'pass')").run();
db.transaction(() => passes.redeemInTx(db, { passId: p2, userId: "father", bookingId: "b2" }))();
ok(db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(passId).remaining_credits === famBefore, "家庭 Pass 餘額不變");

console.log("🧪 AC-3b 簽發家庭 Pass");
const issued = passes.issuePass(db, {
  userId: "daughter",
  phone: "60001001",
  studentName: "陳小姐",
  totalCredits: 4,
  pricePaid: 560,
  validDays: 90,
  familyGroupId: "fg1",
  ownerUserId: "daughter",
});
ok(issued.ok && issued.pass.family_group_id === "fg1", "簽發 Pass 直接綁定家庭群組", issued);
ok(issued.pass.owner_user_id === "daughter", "家庭 Pass 記錄付款人", issued.pass);

console.log("🧪 AC-5 對帳隔離與路由");
const fs = require("fs");
const cls = fs.readFileSync(path.join(__dirname, "../src/routes/classes.js"), "utf8");
ok(/audience/.test(cls) && /target_audience_enum/.test(cls) && /audience_badge/.test(cls), "課程列表有 audience filter／badge");
const roster = fs.readFileSync(path.join(__dirname, "../src/routes/coach-roster.js"), "utf8");
ok(/pass_status/.test(roster) && /describePass/.test(roster), "點名冊有 pass_status");
const walk = fs.readFileSync(path.join(__dirname, "../src/routes/coach-walkin.js"), "utf8");
ok(/findApplicablePass/.test(walk), "Walk-in 用兩層 Pass 分配");
const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
ok(/api\/family/.test(idx), "family API 已掛載");
const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/explore.html"), "utf8");
ok(/audienceBar/.test(page) && /產後修復/.test(page) && /matchAudience/.test(page), "Explore 有受眾 pills");
const rosterPage = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-roster.html"), "utf8");
ok(/家庭Pass/.test(rosterPage), "Roster 顯示家庭 Pass badge");
const familyPage = fs.readFileSync(path.join(__dirname, "../../frontend-v2/family.html"), "utf8");
ok(/建立家庭群組/.test(familyPage) && /attachPass/.test(familyPage), "家庭錢包頁可建組／加入 Pass");
const myPage = fs.readFileSync(path.join(__dirname, "../../frontend-v2/my.html"), "utf8");
ok(/family\.html/.test(myPage), "我的頁有家庭錢包入口");
const familyRoute = fs.readFileSync(path.join(__dirname, "../src/routes/family.js"), "utf8");
ok(/groups\/:id\/passes\/:passId/.test(familyRoute), "有 Pass 加入家庭群組 API");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
