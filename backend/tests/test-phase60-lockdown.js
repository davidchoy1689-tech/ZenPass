#!/usr/bin/env node
/**
 * Phase 6.0 — 驗收後安全封網 ＋ 每日自動財務平帳
 *
 * AC-LOCK-1：ENFORCE=1 時未驗證電話 → 403 PHONE_VERIFICATION_REQUIRED
 * AC-LOCK-2：驗收帳目軟隔離（is_acceptance_test=1），永不 DELETE，正式報表唔計
 * AC-RECON-1：present 但漏寫 coach_earnings → MISSING_COACH_EARNING + discrepancy_detected
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const DB_FILE = path.join(os.tmpdir(), "zenpass-phase60-" + Date.now() + ".db");
process.env.DB_PATH = DB_FILE;
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const { getDb } = require("../src/services/database");
const mig60 = require("../src/config/migrate-phase60");
const db = getDb();
const gate = require("../src/services/phone-gate");
gate.ensureSchema(db);
// 精簡測試 DB 未必有 prod 後加欄位 → 補返（僅測試 DB）
const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
if (!bcols.includes("attendance_status")) db.exec("ALTER TABLE bookings ADD COLUMN attendance_status TEXT");
if (!bcols.includes("parent_phone")) db.exec("ALTER TABLE bookings ADD COLUMN parent_phone TEXT");
if (!bcols.includes("pass_id")) db.exec("ALTER TABLE bookings ADD COLUMN pass_id TEXT");

// ---------- 種子資料 ----------
function seed() {
  db.prepare(
    "INSERT OR IGNORE INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version,phone_verified_at) VALUES ('coachA','ca@t.hk','蔡教練','60004001','coach',1,1,0.8,0,datetime('now'))",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id,email,name,phone,role,token_version,phone_verified_at) VALUES ('seed-sandbox-stu-a','a@t.hk','陳大文','98765432','user',0,datetime('now'))",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id,email,name,phone,role,token_version) VALUES ('seed-sandbox-stu-b','b@t.hk','陳小姐','91234567','user',0)",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id,email,name,phone,role,token_version) VALUES ('realstu','r@t.hk','黃小強','60004002','user',0)",
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,booking_open,venue_name)
     VALUES ('c60','coachA','樂齡防跌班','fitness',60,8,140,14,'active',1,'葵芳體育館')`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,coach_override_id)
     VALUES ('s60','c60',datetime('now'),datetime('now','+1 hour'),8,1,'available','coachA')`,
  ).run();
}

db.prepare(
  "INSERT OR IGNORE INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at) VALUES ('p60b','seed-sandbox-stu-b','91234567','陳小姐',4,3,520,'active',datetime('now','+30 day'))",
).run();

const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

console.log("🧪 1. Migration（idempotent，只加不減）");
const tablesBefore = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
const r1 = mig60.run(db);
ok(r1.addedColumns.includes("user_passes.is_acceptance_test"), "user_passes 加 is_acceptance_test");
ok(r1.addedColumns.includes("bookings.is_acceptance_test"), "bookings 加 is_acceptance_test");
ok(r1.addedColumns.includes("coach_earnings.is_acceptance_test"), "coach_earnings 加 is_acceptance_test");
ok(!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_reconciliation_logs'").get(), "建 daily_reconciliation_logs");
const r2 = mig60.run(db);
ok(r2.addedColumns.length === 0, "重跑唔會再 ALTER（idempotent）");
ok(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c >= tablesBefore, "重跑冇刪任何表");

console.log("\n🧪 2. AC-RECON-1：present 但漏寫 coach_earnings");
seed();
db.prepare(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,attendance_status,amount,amount_cents,created_at)
   VALUES ('bk60','ZP-6001','realstu','s60','c60','single','paid','attended','present',140,14000,?)`,
).run(TODAY);
db.prepare(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,attendance_status,amount,amount_cents,created_at)
   VALUES ('bk60b','ZP-6002','seed-sandbox-stu-a','s60','c60','pass','paid','attended','present',0,0,?)`,
).run(TODAY);
const recon = require("../src/services/reconciliation-worker");
const r = recon.runDailyReconciliation(TODAY, { db });
const types = (r.discrepancies || []).map((d) => d.type);
ok(types.includes("MISSING_COACH_EARNING"), "捕獲 MISSING_COACH_EARNING", types);
ok(r.status === "discrepancy_detected", `狀態 = ${r.status}`);
const logRow = db.prepare("SELECT * FROM daily_reconciliation_logs WHERE audit_date=?").get(TODAY);
ok(!!logRow, "已寫入稽核表");
ok(Number(logRow.discrepancy_count) === r.discrepancies.length, `discrepancy_count = ${logRow && logRow.discrepancy_count}`);
ok(String(logRow.discrepancy_details).includes("MISSING_COACH_EARNING"), "明細有 JSON 記錄");

console.log("\n🧪 3. 補寫 coach_earnings 後轉 balanced");
db.prepare(
  `INSERT INTO coach_earnings (id,coach_id,schedule_id,class_id,class_title,date,enrolled_count,unit_price,gross_amount,commission_rate,net_amount,status,unit_price_cents,gross_amount_cents,net_amount_cents,created_at)
   VALUES ('ce60','coachA','s60','c60','樂齡防跌班',?,1,140,140,0.8,112,'pending',14000,14000,11200,?)`,
).run(TODAY, TODAY);
const r2b = recon.runDailyReconciliation(TODAY, { db });
ok(r2b.status === "balanced", `狀態 = ${r2b.status}`, r2b.discrepancies);
ok(Number(r2b.summary.coachEarningsCents) === 11200, `教練分帳合計 = ${r2b.summary.coachEarningsCents}c`);

console.log("\n🧪 4. 其他紅線：負數 Pass／掉單扣堂");
db.prepare(
  "INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at) VALUES ('p60','realstu','60004002','黃小強',4,-1,520,'active',datetime('now','+30 day'))",
).run();
db.prepare(
  "INSERT INTO pass_redemptions (id,pass_id,booking_id,user_id,credits,status,created_at) VALUES ('pr60','p60','NO_SUCH_BOOKING','realstu',1,'used',?)",
).run(TODAY);
const r3 = recon.runDailyReconciliation(TODAY, { db });
const t3 = r3.discrepancies.map((d) => d.type);
ok(t3.includes("NEGATIVE_PASS_CREDITS"), "捕獲 NEGATIVE_PASS_CREDITS", t3);
ok(t3.includes("ORPHAN_PASS_REDEMPTION"), "捕獲 ORPHAN_PASS_REDEMPTION", t3);

console.log("\n🧪 5. 驗收測試帳目唔計入正式平帳");
db.prepare("UPDATE bookings SET is_acceptance_test = 1").run();
db.prepare("UPDATE coach_earnings SET is_acceptance_test = 1").run();
db.prepare("UPDATE user_passes SET is_acceptance_test = 1").run();
db.prepare("UPDATE pass_redemptions SET status='refunded'").run();
const r4 = recon.runDailyReconciliation(TODAY, { db });
ok(r4.status === "balanced", `隔離後 = ${r4.status}`, r4.discrepancies);
ok(Number(r4.summary.presents) === 0, `present 計數 = ${r4.summary.presents}（測試帳目排除）`);

console.log("\n🧪 6. AC-LOCK-1：ENFORCE=1 攔截未驗證電話");
const oldEnv = process.env.NODE_ENV;
const oldEnf = process.env.PHONE_VERIFY_ENFORCE;
process.env.NODE_ENV = "production";
process.env.PHONE_VERIFY_ENFORCE = "1";
const chk = gate.check("seed-sandbox-stu-b");
ok(chk.ok === false && chk.code === "PHONE_VERIFICATION_REQUIRED", `未驗證 → ${chk.code}`);
let gateStatus = null;
let gateBody = null;
gate.requirePhoneGate(
  { user: { id: "seed-sandbox-stu-b" } },
  {
    status(s) { gateStatus = s; return this; },
    json(b) { gateBody = b; return this; },
  },
  () => { gateStatus = 200; },
);
ok(gateStatus === 403 && gateBody && gateBody.code === "PHONE_VERIFICATION_REQUIRED", `requirePhoneGate → ${gateStatus} ${gateBody && gateBody.code}`);
const chkOk = gate.check("seed-sandbox-stu-a");
ok(chkOk.ok === true, "已驗證電話 → 放行");
process.env.NODE_ENV = oldEnv;
if (oldEnf === undefined) delete process.env.PHONE_VERIFY_ENFORCE;
else process.env.PHONE_VERIFY_ENFORCE = oldEnf;

console.log("\n🧪 7. 封網腳本：dry-run 唯讀 / --confirm 隔離 / 不 DELETE");
const ENV_FILE = path.join(os.tmpdir(), "zenpass-phase60-" + Date.now() + ".env");
fs.writeFileSync(ENV_FILE, "PORT=3001\nPHONE_VERIFY_ENFORCE=0\nJWT_SECRET=abc\n", "utf8");
const script = path.resolve(__dirname, "../scripts/post-acceptance-lockdown.js");
const runScript = (args) => {
  try {
    return execFileSync("node", [script, ...args], {
      env: { ...process.env, DB_PATH: DB_FILE, ZP_ENV_FILE: ENV_FILE, JWT_SECRET: "x".repeat(64), NODE_ENV: "" },
      encoding: "utf8",
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
};

// 先歸零，模擬「驗收前」
db.prepare("UPDATE user_passes SET is_acceptance_test=0").run();
db.prepare("UPDATE bookings SET is_acceptance_test=0").run();
db.prepare("UPDATE coach_earnings SET is_acceptance_test=0").run();
const countsBefore = {
  p: db.prepare("SELECT COUNT(*) c FROM user_passes").get().c,
  b: db.prepare("SELECT COUNT(*) c FROM bookings").get().c,
  e: db.prepare("SELECT COUNT(*) c FROM coach_earnings").get().c,
};

const dry = runScript([]);
ok(/預覽模式/.test(dry), "冇 --confirm → 預覽模式");
ok(fs.readFileSync(ENV_FILE, "utf8").includes("PHONE_VERIFY_ENFORCE=0"), "dry-run 冇改 .env");
ok(Number(db.prepare("SELECT is_acceptance_test FROM bookings WHERE id='bk60'").get().is_acceptance_test) === 0, "dry-run 冇改 DB 旗標");

const conf = runScript(["--confirm"]);
ok(/已更新：Passes\([1-9]/.test(conf), "隔離 Passes ≥1 筆", conf.split("\n").find((l) => l.includes("已更新")));
ok(Number(db.prepare("SELECT is_acceptance_test FROM bookings WHERE id='bk60b'").get().is_acceptance_test) === 1, "陳氏家庭 booking 標記為測試");
ok(Number(db.prepare("SELECT is_acceptance_test FROM bookings WHERE id='bk60'").get().is_acceptance_test) === 0, "非沙盒 booking 唔會被誤標");
ok(Number(db.prepare("SELECT is_acceptance_test FROM coach_earnings WHERE id='ce60'").get().is_acceptance_test) === 1, "coach_earnings 標記為測試");
ok(fs.readFileSync(ENV_FILE, "utf8").includes("PHONE_VERIFY_ENFORCE=1"), ".env 已改回 ENFORCE=1");
ok(fs.readdirSync(os.tmpdir()).some((f) => f.startsWith(path.basename(ENV_FILE) + ".lockdown-bak-")), "改 .env 前有備份");
ok(
  db.prepare("SELECT COUNT(*) c FROM user_passes").get().c === countsBefore.p &&
    db.prepare("SELECT COUNT(*) c FROM bookings").get().c === countsBefore.b &&
    db.prepare("SELECT COUNT(*) c FROM coach_earnings").get().c === countsBefore.e,
  "冇任何 DELETE（行數不變）",
);
const conf2 = runScript(["--confirm"]);
ok(/已經是 1/.test(conf2), "重跑 .env 已合規 → 唔會再備份／改寫");
const undo = runScript(["--undo", "--confirm"]);
ok(/已更新：Passes\([1-9]/.test(undo), "--undo 可以還原旗標");
ok(Number(db.prepare("SELECT is_acceptance_test FROM bookings WHERE id='bk60b'").get().is_acceptance_test) === 0, "undo 後沙盒 bookings 回 0");
ok(fs.readFileSync(ENV_FILE, "utf8").includes("PHONE_VERIFY_ENFORCE=1"), "--undo 冇改 .env");

console.log("\n🧪 8. 出糧／報表接線");
const ceSrc = fs.readFileSync(path.join(__dirname, "../src/routes/coach-earnings.js"), "utf8");
ok(/notTestClause\(db\)/.test(ceSrc) && (ceSrc.match(/notTestClause\(db\)/g) || []).length >= 6, "教練收入／出糧查詢已過濾測試帳目");
const asSrc = fs.readFileSync(path.join(__dirname, "../src/scripts/auto-settlement.js"), "utf8");
ok(/notTestClause\(db, 'ce'\)/.test(asSrc), "自動出糧已過濾");
const repSrc = fs.readFileSync(path.join(__dirname, "../src/routes/reporting.js"), "utf8");
ok(/notTestClause\(db, "ce"\)/.test(repSrc), "業績報表已過濾");
const idxSrc = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
ok(/reconciliation-worker/.test(idxSrc) && /startHourlyCheck/.test(idxSrc), "每日 03:00 排程已掛載");

console.log("\n🧪 9. 安全紀律：腳本冇 DELETE");
const lockSrc = fs.readFileSync(script, "utf8");
ok(!/\bDELETE\s+FROM\b/i.test(lockSrc), "封網腳本冇 DELETE FROM");
ok(/--confirm/.test(lockSrc), "必須 --confirm 才執行");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
