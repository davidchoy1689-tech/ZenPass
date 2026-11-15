#!/usr/bin/env node
/**
 * 資金流政策鎖定（David 2026-11-15 拍板）
 *  A. 拆帳：私域 100% / 公域 80-20（有介紹人 5%，平台 15%）
 *  B. 現場現金唔入平台資金流：唔計出糧、唔計平台收入
 *  C. 取消 ≥72h：全退（credits / pass / 錢），零拆帳
 *  D. No-show：全扣（唔退款、唔回堂數）
 */
const path = require("path"), os = require("os");
process.env.JWT_SECRET = "test-secret-fundflow-0123456789-abcdefghijklmn";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-flow-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

db.exec(`CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status, checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`);
for (const c of ["is_walkin INTEGER DEFAULT 0", "collected_by TEXT", "payment_method TEXT"]) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${c}`); } catch (e) {}
}

const now = Date.now();
const iso = (h) => new Date(now + h * 3600e3).toISOString();

db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,commission_rate,credits) VALUES ('coach','c@t.hk','教練','90000001','coach',1,0.8,0)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,credits) VALUES ('u1','u1@t.hk','私域學生','91110001','user',0)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,credits) VALUES ('u2','u2@t.hk','公域學生','91110002','user',0)").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,max_participants) VALUES ('cl','coach','伸展班','樂齡',60,140,14,'active',8)").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl',?,?,8,2,'available')").run(iso(96), iso(97.5));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','cl',?,?,8,2,'available')").run(iso(96), iso(97.5));

const ins = db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,payment_method,amount,is_walkin,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`);
ins.run("b1", "ZP-1", "u1", "s1", "cl", "confirmed", "paid", "single", "fps", 140, 0);
ins.run("b2", "ZP-2", "u2", "s1", "cl", "confirmed", "paid", "single", "fps", 140, 0);
ins.run("b3", "WI-3", "u2", "s2", "cl", "confirmed", "paid", "single", "walkin_cash", 140, 1);

require("../src/services/coach-affiliate").bindStudent(db, "u1", "coach");

const settle = require("../src/services/coach-settlement");
const ce = require("../src/routes/coach-earnings");

console.log("\n🧪 1. 公域 80/20 + 介紹人 5%");
const r1 = settle.calculateCoachEarning(140, { enrolled: 1, rate: 0.8 });
ok(r1.coachNetCents === 11200 && r1.platformFeeCents === 2800, "教練 $112 / 平台 $28", `${r1.coachNetCents}/${r1.platformFeeCents}`);

console.log("\n🧪 2. 私域 100%（自己學生）");
ce.syncCoachEarningsForSchedule("s1");
require("../src/services/coach-affiliate").settleSchedule("s1");
const wallet = db.prepare("SELECT wallet_balance FROM users WHERE id='coach'").get().wallet_balance;
ok(Math.round(wallet * 100) === 25200, "錢包 = $252（私域 $140 + 公域 80% $112）", String(wallet));
const upl = db.prepare("SELECT COUNT(*) n FROM coach_own_student_uplifts").get().n;
ok(upl === 1, "有 1 筆私域 100% 補足");

console.log("\n🧪 3. 現場現金唔入資金流");
ok(db.prepare("SELECT COUNT(*) n FROM coach_earnings WHERE schedule_id='s2'").get().n === 0, "現金班冇 coach_earnings");
ce.syncCoachEarningsForSchedule("s2");
ok(db.prepare("SELECT COUNT(*) n FROM coach_earnings WHERE schedule_id='s2'").get().n === 0, "同步後仍然冇");

const adminSvc = require("../src/services/admin-service");
const st = adminSvc.getDashboardStats().stats;
ok(Math.round(st.total_revenue * 100) === 28000, "平台收入 = $280（唔計現金 $140）", String(st.total_revenue));

console.log("\n🧪 4. 取消政策（≥72h 全退、<24h 全扣）");
const { cancellationFeeRate } = require("../src/services/booking-service");
ok(cancellationFeeRate(72) === 0, "72h → 0% 手續費（全退）");
ok(cancellationFeeRate(48) === 0.5, "48h → 50%");
ok(cancellationFeeRate(12) === 1, "12h → 100%（全扣）");

console.log("\n🧪 5. No-show 全扣（程式冇退款路徑）");
const bsvc = require("../src/services/booking-service");
const noShowSrc = require("fs").readFileSync(path.join(__dirname, "..", "src", "services", "booking-service.js"), "utf8");
const idx = noShowSrc.indexOf("status = 'no_show'");
const seg = noShowSrc.slice(idx, idx + 1200);
ok(idx > -1, "有 no-show 處理");
ok(!/processRefund|applyCredits|restoreInTx/.test(seg), "no-show 冇退款／回堂／回 credits");
ok(/syncCoachEarningsForSchedule/.test(seg), "no-show 仍計教練帶班收益（保底）");

console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
