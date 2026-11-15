#!/usr/bin/env node
/**
 * No-show 專用拆帳（David 2026-11-15）
 *  私域（有 origin）→ 教練 80% / 平台 20%
 *  公域（冇 origin）→ 教練 20% / 平台 80%
 *  介紹人 → 0%
 *  正常出席維持原政策（自己 100%、其他 80%）
 */
const path = require("path"), os = require("os");
process.env.JWT_SECRET = "test-secret-noshow-0123456789-abcdefgh";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ns-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

db.exec(`CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status, checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`);
try { db.exec("ALTER TABLE bookings ADD COLUMN is_walkin INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN payment_method TEXT"); } catch (e) {}

const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,commission_rate) VALUES ('coach','c@t.hk','教練','90000001','coach',1,0.8)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('other','o@t.hk','其他教練','90000002','coach')").run();
for (const [id, nm, ph] of [["u1", "公域甲", "91110001"], ["u2", "私域乙", "91110002"], ["u3", "自己丙", "91110003"], ["u4", "出席丁", "91110004"]]) {
  db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES (?,?,?,?, 'user')").run(id, id + "@t.hk", nm, ph);
}
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,max_participants) VALUES ('cl','coach','伸展班','樂齡',60,140,14,'active',8)").run();

const mkSched = (id) => db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES (?,'cl',?,?,8,1,'available')").run(id, iso(-3), iso(-1.5));
for (const s of ["s1", "s2", "s3", "s4"]) mkSched(s);

const ins = db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount,created_at)
  VALUES (?,?,?,?,'cl',?, 'paid',140,datetime('now'))`);
ins.run("b1", "Z1", "u1", "s1", "no_show");     // 公域 no-show
ins.run("b2", "Z2", "u2", "s2", "no_show");     // 私域（其他教練）no-show
ins.run("b3", "Z3", "u3", "s3", "no_show");     // 自己學生 no-show
ins.run("b4", "Z4", "u4", "s4", "attended");    // 正常出席（公域）

require("../src/services/coach-affiliate").bindStudent(db, "u2", "other");
require("../src/services/coach-affiliate").bindStudent(db, "u3", "coach");

const ce = require("../src/routes/coach-earnings");

const netOf = (sid) => {
  ce.syncCoachEarningsForSchedule(sid);
  const r = db.prepare("SELECT gross_amount, net_amount FROM coach_earnings WHERE schedule_id=?").get(sid);
  return r ? { gross: Math.round(Number(r.gross_amount) * 100), net: Math.round(Number(r.net_amount) * 100) } : null;
};

console.log("\n🧪 No-show 拆帳");
const s1 = netOf("s1");
ok(s1 && s1.net === 2800, "公域 no-show → 教練 20% = $28", s1 && s1.net);
ok(s1 && s1.gross === 14000, "應收總額 $140", s1 && s1.gross);

const s2 = netOf("s2");
ok(s2 && s2.net === 11200, "其他私域 no-show → 教練 80% = $112", s2 && s2.net);

const s3 = netOf("s3");
ok(s3 && s3.net === 11200, "自己學生 no-show → 80% = $112（唔係 100%）", s3 && s3.net);

const s4 = netOf("s4");
ok(s4 && s4.net === 11200, "正常出席（公域）維持 80% = $112", s4 && s4.net);

console.log("\n🧪 介紹人 0%（no-show 不產生回佣）");
require("../src/services/coach-affiliate").settleSchedule("s1");
require("../src/services/coach-affiliate").settleSchedule("s2");
ok(db.prepare("SELECT COUNT(*) n FROM coach_affiliate_payouts").get().n === 0, "冇跨界回佣紀錄");
ok(db.prepare("SELECT COUNT(*) n FROM coach_own_student_uplifts").get().n === 0, "冇私域補足（no-show 唔補）");

console.log("\n🧪 月結明細同步");
const bd = ce.buildMonthlyBreakdown(db, "coach", new Date().toISOString().slice(0, 7));
const row1 = (bd.sessions_breakdown || []).find((x) => x.session_id === "s1");
ok(row1 && Math.round(row1.session_payout * 100) === 2800, "s1 月結 payout = $28", row1 && row1.session_payout);

console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
