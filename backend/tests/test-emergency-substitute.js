#!/usr/bin/env node
/** test-emergency-substitute.js — 緊急代堂、PLI 雙軌、權限交接、託管拆帳 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-sub-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")(); require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const emg = require("../src/routes/admin-emergency");
const risk = require("../src/services/risk-control");
emg.ensureSchema(db);
risk.ensureSchema(db);
try { db.exec("ALTER TABLE users ADD COLUMN service_districts TEXT"); } catch (e) {}
db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
  id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT, license_expiry TEXT,
  insurance_policy_url TEXT, insurance_expiry_date TEXT, status TEXT, qualified_sports TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// users
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status) VALUES ('adm','a@t.hk','管理員','90000001','super_admin',0,1,'active')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status,service_districts) VALUES ('orig','o@t.hk','蔡教練','98765432','coach',1,0,'frozen_stolen','[\"葵青\"]')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status,service_districts,rating) VALUES ('c2','c2@t.hk','黃教練','91234567','coach',1,1,'active','[\"葵青\",\"青衣\"]',4.8)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status,service_districts,rating) VALUES ('c3','c3@t.hk','李教練','92345678','coach',1,1,'active','[\"葵青\"]',4.6)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status) VALUES ('c4','c4@t.hk','陳教練','93456789','coach',1,1,'active')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,is_active,payout_status) VALUES ('stu','s@t.hk','學員甲','61112222','user',0,1,'active')").run();

db.prepare("INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,insurance_expiry_date,status,qualified_sports) VALUES ('cr2','c2','樂齡體適能導師','L2','2027-12-31','2027-06-30','verified','[\"molkky\",\"stretch\"]')").run();
db.prepare("INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,insurance_expiry_date,status,qualified_sports) VALUES ('cr3','c3','樂齡體適能導師','L3','2027-12-31','2025-01-01','verified','[\"stretch\"]')").run();
db.prepare("INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,insurance_expiry_date,status,qualified_sports) VALUES ('cr4','c4','體適能導師','L4','2027-12-31','2027-12-31','verified','[\"stretch\"]')").run();

// class + schedules (2026-11-11 10:30 HKT = 02:30Z)
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,district,venue_name,status) VALUES ('cl1','orig','樂齡深層伸展班','stretch',90,20,140,14,'葵青','青衣楓樹窩體育館','active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,status,enrolled_count,max_participants) VALUES ('s1','cl1','2026-11-11 02:30:00','2026-11-11 04:00:00','available',3,20)").run();
// c4 衝堂
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,district,venue_name,status) VALUES ('cl4','c4','其他班','stretch',90,20,140,14,'葵青','同一場館','active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,status) VALUES ('sx','cl4','2026-11-11 03:00:00','2026-11-11 04:30:00','available')").run();
// 第二班（李教練用平台底網）
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,status,enrolled_count,max_participants) VALUES ('s2','cl1','2026-11-11 06:00:00','2026-11-11 07:30:00','available',2,20)").run();

// 付費學員 + 出席 + 自有學生歸屬（供託管測試）
db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,payment_method,created_at) VALUES ('b1','ZP1','stu','s1','cl1','attended','paid',140,'online',datetime('now'))").run();
db.exec(`CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY, booking_id TEXT, schedule_id TEXT, user_id TEXT, status TEXT, checked_in_at TEXT
)`);
db.prepare("INSERT INTO attendances (id,booking_id,schedule_id,user_id,status,checked_in_at) VALUES ('a1','b1','s1','stu','present',datetime('now'))").run();
db.prepare("INSERT INTO student_coach_affiliations (student_user_id,origin_coach_id,status) VALUES ('stu','orig','active')").run();

(async () => {
  console.log("🧪 1. 受影響班次");
  const aff = emg.affectedSessions(db, "2026-11-11");
  ok(aff.sessions.length === 2, "兩個班次待處理", aff.sessions.length);
  ok(aff.sessions.every((s) => s.payout_status === "frozen_stolen"), "只列出被熔斷教練");

  console.log("🧪 2. 候選過濾（同區／衝堂／PLI）");
  const c = emg.candidates(db, "s1");
  ok(!c.error && c.candidates.length >= 3, "有候選清單");
  const byId = Object.fromEntries(c.candidates.map((x) => [x.id, x]));
  ok(byId.c2.eligible && byId.c2.pli_source === "personal" && byId.c2.district_match, "黃教練：個人 PLI＋同區");
  ok(byId.c3.eligible && byId.c3.pli_source === "umbrella", "李教練：個人過期 → 平台底網");
  ok(!byId.c4.eligible && byId.c4.blockers.includes("同時段已有班（衝堂）"), "陳教練：衝堂被阻");
  ok(c.umbrella.policy_no && c.umbrella.coverage_hkd === 10000000, "平台保單資料");

  console.log("🧪 3. 指派（原子＋保險憑證）");
  const noPli = emg.assign(db, { scheduleId: "s2", targetCoachId: "c3", useUmbrella: false, adminId: "adm", reason: "緊急代堂測試" });
  ok(!noPli.ok && noPli.code === "PLI_REQUIRED", "未開底網 → PLI_REQUIRED");
  ok(db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s2'").get().coach_override_id === null, "失敗唔會改班次");

  const a1 = emg.assign(db, { scheduleId: "s1", targetCoachId: "c2", useUmbrella: false, adminId: "adm", reason: "原教練被入侵，黃教練即時接手" });
  ok(a1.ok && a1.pli_source === "personal", "指派黃教練成功", a1);
  ok(db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s1'").get().coach_override_id === "c2", "coach_override_id 已更新");
  const log1 = db.prepare("SELECT * FROM schedule_insurance_logs WHERE schedule_id='s1'").get();
  ok(log1 && log1.policy_type === "coach_personal_pli", "寫入個人保單憑證");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='coach.emergency_substitute_assigned'").get(), "有代堂審計");
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE user_id='c2'").get(), "代堂教練收到通知");
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE user_id='stu'").get(), "學員收到通知");
  const dup = emg.assign(db, { scheduleId: "s1", targetCoachId: "c3", useUmbrella: true, adminId: "adm", reason: "重複測試" });
  ok(!dup.ok && dup.code === "ALREADY_ASSIGNED", "不可重複指派");

  const a2 = emg.assign(db, { scheduleId: "s2", targetCoachId: "c3", useUmbrella: true, adminId: "adm", reason: "李教練個人保單續期中，用平台底網" });
  ok(a2.ok && a2.pli_source === "umbrella" && a2.coverage_hkd === 10000000, "平台底網指派成功", a2);
  const log2 = db.prepare("SELECT * FROM schedule_insurance_logs WHERE schedule_id='s2'").get();
  ok(log2 && log2.policy_no === "ZP-PLI-2026-EMERGENCY" && log2.coverage_hkd === 10000000, "底網憑證保單號／保額");

  console.log("🧪 4. 拆帳：代堂 80%／原教練補足託管");
  const { buildMonthlyBreakdown } = require("../src/routes/coach-earnings");
  const bd = buildMonthlyBreakdown(db, "orig", "2026-11");
  ok(Number(bd.held_uplift_cents) === 2800, "原教練自有學生 20% 託管 HK$28", bd.held_uplift_cents);
  ok(Number(bd.net_payout_cents) === 0, "託管款不計入淨發放", bd.net_payout_cents);
  const bs = buildMonthlyBreakdown(db, "c2", "2026-11");
  ok(Number(bs.total_payout_cents) >= 11200, "代堂教練收 80%（HK$112）", bs.total_payout_cents);

  console.log("🧪 5. 復原後補足可發放");
  db.prepare("UPDATE users SET payout_status='active', is_active=1 WHERE id='orig'").run();
  const bd2 = buildMonthlyBreakdown(db, "orig", "2026-11");
  ok(Number(bd2.held_uplift_cents) === 0 && Number(bd2.own_student_uplift_cents) === 2800, "非凍結狀態 → 補足計入應得", {
    held: bd2.held_uplift_cents, uplift: bd2.own_student_uplift_cents,
  });

  console.log("🧪 6. 前端接線");
  const fs = require("fs");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-schedules.html"), "utf8");
  ok(/緊急代堂/.test(page) && /emergency-candidates/.test(page) && /emergency-assign/.test(page), "頁面有候選＋指派");
  ok(/PLI 審核通過/.test(page) && /平台保險單生效/.test(page), "顯示 PLI 雙軌結果");
  ok(/代堂中/.test(page) && /待安排代堂/.test(page), "顯示覆蓋狀態");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/admin-emergency/.test(idx), "路由已掛載");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
