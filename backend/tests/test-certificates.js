/**
 * ZenPass — 完課證書 / 期制結業 / 發證資格閘門 測試
 * 使用獨立臨時 DB，唔會碰生產或開發資料。
 * node tests/test-certificates.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const TMP = path.join(os.tmpdir(), "zenpass-cert-" + Date.now() + ".db");
process.env.DB_PATH = TMP;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { console.log("  ✅ " + label); pass++; }
  else { console.log("  ❌ " + label); fail++; }
}

function buildDb() {
  const db = new Database(TMP);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT);
    CREATE TABLE classes (
      id TEXT PRIMARY KEY, title TEXT, category TEXT, sport_slug TEXT, duration INTEGER,
      coach_id TEXT, status TEXT DEFAULT 'active',
      course_type TEXT DEFAULT 'single', total_sessions INTEGER DEFAULT 1,
      min_attendance_rate REAL DEFAULT 0.8
    );
    CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT);
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY, user_id TEXT, class_id TEXT, schedule_id TEXT, status TEXT,
      attendee_type TEXT DEFAULT 'self', child_name TEXT, group_size INTEGER DEFAULT 1
    );
    CREATE TABLE coach_credentials (
      id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT,
      license_expiry TEXT, first_aid_type TEXT, first_aid_expiry TEXT,
      insurance_expiry_date TEXT, is_starred INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',
      reviewed_at TEXT, created_at TEXT, qualified_sports TEXT
    );
  `);
  db.prepare("INSERT INTO users VALUES ('u1','陳大文','a@x.hk','91234567')").run();
  db.prepare("INSERT INTO users VALUES ('coach1','Sam Lee','c@x.hk',NULL)").run();
  db.prepare("INSERT INTO users VALUES ('coach2','No Cred','n@x.hk',NULL)").run();

  // 期制班：12 堂，每堂 120 分鐘，出席率門檻 80%
  db.prepare(
    `INSERT INTO classes (id,title,category,sport_slug,duration,coach_id,status,course_type,total_sessions,min_attendance_rate)
     VALUES ('cls-term','芬蘭木柱青訓班','新興運動','molkky',120,'coach1','active','term',12,0.8)`,
  ).run();
  // 單堂班
  db.prepare(
    `INSERT INTO classes (id,title,category,sport_slug,duration,coach_id,status,course_type,total_sessions)
     VALUES ('cls-one','芬蘭木柱體驗班','新興運動','molkky',120,'coach1','active','single',1)`,
  ).run();
  // 冰壺班（教練未授權此項目）
  db.prepare(
    `INSERT INTO classes (id,title,category,sport_slug,duration,coach_id,status,course_type,total_sessions)
     VALUES ('cls-curl','地板冰壺歡樂班','新興運動','floor-curling',120,'coach1','active','single',1)`,
  ).run();

  for (let i = 1; i <= 12; i++) {
    db.prepare("INSERT INTO class_schedules VALUES (?,?,?)").run("sch" + i, "cls-term", "2026-11-" + String(i).padStart(2, "0") + "T04:00:00.000Z");
    db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status) VALUES (?,?,?,?,?)").run(
      "bk" + i, "u1", "cls-term", "sch" + i, i <= 9 ? "attended" : "confirmed",
    );
  }
  db.prepare("INSERT INTO class_schedules VALUES ('sch-one','cls-one','2026-11-01T04:00:00.000Z')").run();
  db.prepare("INSERT INTO bookings (id,user_id,class_id,schedule_id,status) VALUES ('bk-one','u1','cls-one','sch-one','attended')").run();

  // 已核實教練，保單有效，授權 molkky
  db.prepare(
    `INSERT INTO coach_credentials (id,user_id,license_type,license_no,license_expiry,insurance_expiry_date,status,created_at,qualified_sports,is_starred)
     VALUES ('cc1','coach1','芬蘭木柱一級教練','MOL-8821','2027-12-31','2027-06-30','verified','2026-10-01',?,1)`,
  ).run(JSON.stringify(["molkky"]));
  return db;
}

(async () => {
  const db = buildDb();
  console.log("\n🧪 ZenPass 證書 / 期制結業 / 發證資格 測試\n");

  // 讓 service 用同一個 DB 檔
  const svc = require("../src/services/certificate-service");

  console.log("📋 1. 單堂班：簽到即發 session 證書");
  const single = svc.issueForBooking("bk-one");
  ok(!!single && single.cert_type === "session", "單堂證書已發出（cert_type=session）");
  ok(/^ZP-\d{4}-MOLKKY-[A-Z0-9]{6}$/.test(single.code), "證書編號格式正確：" + single.code);
  ok(single.hours === 2, "時數 = 2.0（120 分鐘）");
  ok(!!svc.issueForBooking("bk-one") && svc.listForUser("u1").filter((c) => c.booking_id === "bk-one").length === 1, "重複呼叫唔會重複發證");

  console.log("\n📋 2. 期制班：9/12 堂未達 80% → 未發結業證");
  const s9 = svc.issueForBooking("bk9");
  const gradBefore = svc.listForUser("u1").filter((c) => c.cert_type === "graduation");
  ok(!!s9, "第 9 堂 session 證書已發");
  ok(gradBefore.length === 0, "未達門檻 → 冇結業證書");

  console.log("\n📋 2b. 未達門檻 → 自動發「出席證書」（Attendance Statement）");
  const att9 = svc.listForUser("u1").find((c) => c.cert_type === "attendance");
  ok(!!att9, "已發出席證書");
  ok(att9 && att9.hours === 18, "出席時數 = 18（實際出席 9 堂 × 2 小時）");
  ok(att9 && /已出席 9\/12 堂/.test(att9.level_label || ""), "標示出席堂數：" + (att9 && att9.level_label));
  ok(att9 && /^ZP-\d{4}-MOLKKY-A[A-Z0-9]{4}$/.test(att9.code), "出席證書編號格式：" + (att9 && att9.code));
  ok(att9 && att9.booking_id === "attend:cls-term:u1", "出席證書獨立 key（唔會撞 booking 證書）");
  svc.issueForBooking("bk9");
  ok(svc.listForUser("u1").filter((c) => c.cert_type === "attendance").length === 1, "重複簽到唔會重複發出席證書");

  console.log("\n📋 3. 期制班：第 10 堂達 80% → 自動發結業證");
  // 模擬教練為第 10 堂簽到
  db.prepare("UPDATE bookings SET status='attended' WHERE id='bk10'").run();
  svc.issueForBooking("bk10");
  const grads = svc.listForUser("u1").filter((c) => c.cert_type === "graduation");
  ok(grads.length === 1, "已自動發 1 張結業證書");
  const g = grads[0];
  ok(g && g.hours === 24, "結業認證時數 = 24 小時（按全期 12 堂 × 2）");
  ok(g && /全期 12 堂結業/.test(g.level_label || ""), "證書標示全期 12 堂結業：" + (g && g.level_label));
  ok(g && g.level === 2, "等級晉升 Level 2");
  ok(!!svc.issueForBooking("bk10") && svc.listForUser("u1").filter((c) => c.cert_type === "graduation").length === 1, "結業證 idempotent（每班每學員一張）");
  const attAfter = svc.listForUser("u1").find((c) => c.cert_type === "attendance");
  ok(!attAfter, "達標後出席證書自動作廢（列表不再顯示，紀錄保留）");
  const attRaw = db.prepare("SELECT * FROM certificates WHERE booking_id='attend:cls-term:u1'").get();
  ok(attRaw && attRaw.revoked === 1 && /結業/.test(attRaw.revoked_reason || ""), "作廢原因已記錄：" + (attRaw && attRaw.revoked_reason));

  console.log("\n📋 4. 進度與匯總");
  const prog = svc.termProgressForUser("u1").find((x) => x.class_id === "cls-term");
  ok(prog && prog.total_sessions === 12, "期制總堂數 = 12");
  ok(prog && prog.attended === 10, "已出席 10 堂");
  ok(prog && prog.completed === true, "已達結業門檻標記 completed");
  const sum = svc.summaryForUser("u1");
  ok(sum.certs === 4, "證書總數正確（4 張：單堂 1 + 期制 session 2 + 結業 1）");
  ok(sum.hours === 26, "累計時數 = 26（結業按全期 24 + 單堂 2，唔重複計算）");

  console.log("\n📋 4b. 🔐 防偽存證雜湊（SHA-256）");
  const sealedRow = db.prepare("SELECT * FROM certificates WHERE booking_id='bk-one'").get();
  ok(/^[a-f0-9]{64}$/.test(String(sealedRow.verify_hash || "")), "單堂證書已封存 SHA-256 雜湊");
  ok(svc.certHash(sealedRow) === sealedRow.verify_hash, "重算雜湊 = 資料庫存證（可驗證）");
  db.prepare("UPDATE certificates SET student_name='陳大文（改）' WHERE id=?").run(sealedRow.id);
  const tampered = db.prepare("SELECT * FROM certificates WHERE id=?").get(sealedRow.id);
  ok(svc.certHash(tampered) !== tampered.verify_hash, "改動學員姓名 → 雜湊對唔上（竄改可偵測）");
  db.prepare("UPDATE certificates SET student_name='陳大文' WHERE id=?").run(sealedRow.id);

  console.log("\n📋 5. 發證資格閘門");
  const okMolkky = svc.issuerEligibility("coach1", "molkky", "芬蘭木柱體驗班");
  ok(okMolkky.ok === true, "已核實＋授權 molkky → 准予發證");
  const badSport = svc.issuerEligibility("coach1", "floor-curling", "地板冰壺歡樂班");
  ok(badSport.ok === false && /未獲此項目/.test(badSport.reason || ""), "未授權冰壺 → 拒絕：" + (badSport.reason || ""));
  const noCred = svc.issuerEligibility("coach2", "molkky", "芬蘭木柱體驗班");
  ok(noCred.ok === false && /未提交資質/.test(noCred.reason || ""), "冇資質 → 拒絕：" + (noCred.reason || ""));
  db.prepare("UPDATE coach_credentials SET insurance_expiry_date='2020-01-01' WHERE user_id='coach1'").run();
  const expired = svc.issuerEligibility("coach1", "molkky", "芬蘭木柱體驗班");
  ok(expired.ok === false && /保險已過期/.test(expired.reason || ""), "保單過期 → 拒絕：" + (expired.reason || ""));
  db.prepare("UPDATE coach_credentials SET insurance_expiry_date='2027-06-30', status='pending' WHERE user_id='coach1'").run();
  const pending = svc.issuerEligibility("coach1", "molkky", "芬蘭木柱體驗班");
  ok(pending.ok === false && /審核中/.test(pending.reason || ""), "資質待審 → 拒絕：" + (pending.reason || ""));

  console.log("\n📋 6. 🎖️ Level 3 專項技能評定");
  // 還原教練狀態（第 5 節測試過「待審」情境）
  db.prepare("UPDATE coach_credentials SET status='verified', insurance_expiry_date='2027-06-30', license_expiry='2027-12-31' WHERE user_id='coach1'").run();
  ok(svc.maskLicense("MOL-8821") === "HK-***8821", "牌照脫敏格式：" + svc.maskLicense("MOL-8821"));
  const cands = svc.assessmentCandidatesForCoach("coach1");
  const c1 = cands.find((x) => x.user_id === "u1" && x.sport === "molkky");
  ok(!!c1, "教練名下搵到學員 u1（molkky）");
  ok(c1 && c1.hours === 22, "累計出席時數 = 22（期制 10 堂 + 單堂 1 堂，每堂 2 小時）");
  ok(c1 && c1.graduated === true && c1.eligible === true, "已結業 → 可評核（即使未滿 30 小時）");
  const asBad = svc.issueSkillAssessment({ coachId: "coach1", userId: "u1", studentName: "陳大文", sport: "molkky",
    scores: { technical_score: 6, tactical_score: 4, teamwork_score: 4, sportsmanship_score: 4 } });
  ok(asBad.ok === false && /1–5/.test(asBad.error || ""), "分數超出 1–5 → 拒絕");
  const as1 = svc.issueSkillAssessment({ coachId: "coach1", userId: "u1", studentName: "陳大文", sport: "molkky",
    scores: { technical_score: 5, tactical_score: 4, teamwork_score: 5, sportsmanship_score: 4 },
    comment: "動作標準，戰術理解快", tags: ["學習敏銳度高", "恆毅力強"] });
  ok(as1.ok === true, "評定證書簽發成功" + (as1.ok ? "" : "：" + as1.error));
  const ac = as1.certificate || {};
  ok(ac.cert_type === "skill_assessment", "cert_type = skill_assessment");
  ok(ac.overall_grade === "Distinction", "平均 4.5 → Distinction（got " + ac.overall_grade + "）");
  ok(ac.level === 3 && /Level 3/.test(ac.level_label || ""), "等級 = Level 3：" + ac.level_label);
  ok(/^[a-f0-9]{64}$/.test(String(ac.verify_hash || "")), "已封存 SHA-256 存證");
  ok(/^[a-f0-9]{32}$/.test(String(ac.student_ref_hash || "")), "學員識別雜湊 = 32 位（唔含 HKID）");
  ok(String(ac.coach_license_masked || "") === "HK-***8821", "證書帶脫敏牌照：" + ac.coach_license_masked);
  ok(JSON.parse(ac.assessment_tags || "[]").length === 2, "快捷評語標籤已儲存");
  const as2 = svc.issueSkillAssessment({ coachId: "coach1", userId: "u1", studentName: "陳大文", sport: "molkky",
    scores: { technical_score: 5, tactical_score: 5, teamwork_score: 5, sportsmanship_score: 5 } });
  ok(as2.ok === true && as2.duplicate === true, "重複評核 → 回傳既有證書（唔重複發）");
  const as3 = svc.issueSkillAssessment({ coachId: "coach1", userId: "u1", studentName: "李小明", sport: "molkky",
    scores: { technical_score: 4, tactical_score: 4, teamwork_score: 4, sportsmanship_score: 4 } });
  ok(as3.ok === false && as3.status === 403, "未教過此學員 → 拒絕評核");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(TMP); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
