#!/usr/bin/env node
/**
 * 現場現金 walk-in 唔計平台出糧（David 2026-11-15 決定）
 *  - coach_earnings 只計非現金 walk-in 嘅席位
 *  - 跨界／私域分佣亦跳過現金 walk-in
 *  - 月結明細仍然列出該筆，但 coach_cents = 0、pending = 0
 */
const path = require("path"), os = require("os");
process.env.JWT_SECRET = "test-walkin-payout-0123456789-abcdefghij";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-wp-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase();
updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

try { db.exec("ALTER TABLE bookings ADD COLUMN is_walkin INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN collected_by TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN payment_method TEXT"); } catch (e) {}
db.exec(`CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status, checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`);

db.prepare("INSERT INTO users (id,email,name,role,is_coach,commission_rate) VALUES ('coach','c@t.hk','教練','coach',1,0.8)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u1','u1@t.hk','學員一','91110001','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u2','u2@t.hk','學員二','91110002','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u3','u3@t.hk','現金客','91110003','user')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,max_participants) VALUES ('cl1','coach','伸展班','樂齡',90,140,'active',8)").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1','2026-11-18T02:00:00.000Z','2026-11-18T03:30:00.000Z',8,3,'available')").run();

const ins = db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,payment_method,amount,is_walkin,collected_by,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`);
ins.run("b1", "ZP-1", "u1", "s1", "cl1", "confirmed", "paid", "single", "online", 140, 0, "platform");
ins.run("b2", "ZP-2", "u2", "s1", "cl1", "confirmed", "paid", "single", "online", 140, 0, "platform");
ins.run("b3", "WI-3", "u3", "s1", "cl1", "confirmed", "paid", "single", "walkin_cash", 140, 1, "coach");

const insAtt = db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status,created_at,updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))");
insAtt.run("a1","s1","b1","學員一","present");
insAtt.run("a2","s1","b2","學員二","present");
insAtt.run("a3","s1","b3","現金客","present");

// 現金客綁定教練（測試跨界/私域分佣都會跳過）
try {
  require("../src/services/coach-affiliate").bindStudent(db, "u3", "coach");
} catch (e) { console.log("bind:", e.message); }

const ce = require("../src/routes/coach-earnings");
const settle = require("../src/services/coach-settlement");

console.log("\n🧪 1. coach_earnings 唔計現金 walk-in");
ce.syncCoachEarningsForSchedule("s1");
const row = db.prepare("SELECT * FROM coach_earnings WHERE schedule_id='s1'").get();
const expect = settle.calculateCoachEarning(140, { enrolled: 2, rate: 0.8 });
ok(!!row, "有出糧紀錄", JSON.stringify(row));
ok(Math.round(Number(row && row.net_amount) * 100) === expect.coachNetCents, "淨額 = 2 位（唔計現金客）", `${row && row.net_amount} vs ${expect.coachNetCents / 100}`);
ok(Math.round(Number(row && row.gross_amount) * 100) === expect.totalCents, "毛利 = 2 位", `${row && row.gross_amount}`);

console.log("\n🧪 2. 分佣唔計現金 walk-in");
require("../src/services/coach-affiliate").settleSchedule("s1");
const affine = db.prepare("SELECT COUNT(*) n FROM coach_affiliate_payouts WHERE booking_id='b3'").get().n;
const uplift = db.prepare("SELECT COUNT(*) n FROM coach_own_student_uplifts WHERE booking_id='b3'").get().n;
ok(affine === 0, "冇 5% 跨界回佣", String(affine));
ok(uplift === 0, "冇 100% 私域補足", String(uplift));

console.log("\n🧪 3. 月結明細仍可追溯但零出糧");
const bd = ce.buildMonthlyBreakdown(db, "coach", "2026-11");
const s1 = (bd.sessions_breakdown || []).find((x) => x.session_id === "s1");
ok(!!s1, "session 存在");
const cashRow = (bd.payment_breakdown || []).find((r) => r.session_id === "s1" && r.booking_type === "現場Walk-in");
ok(!!cashRow, "現金筆有列出", JSON.stringify((bd.payment_breakdown || []).map((r) => r.booking_type)));
ok(cashRow && cashRow.coach_cents === 0, "coach_cents = 0", cashRow && String(cashRow.coach_cents));
ok(cashRow && cashRow.pending_cents === 0, "pending = 0", cashRow && String(cashRow.pending_cents));
ok(cashRow && cashRow.collected_cents === 14000, "collected 有記錄", cashRow && String(cashRow.collected_cents));
ok(s1 && s1.attended_count === 2, "月結堂數只計 2 位", s1 && String(s1.attended_count));

console.log("\n🧪 4. 私人帳本照記（唔影響平台）");
const privacy = require("../src/services/coach-students");
const r = privacy.recordWalkinCash(db, {
  coachId: "coach", studentUserId: "u3", name: "現金客", phone: "91110003",
  amount: 140, bookingId: "b3", className: "伸展班", date: "2026-11-18",
});
ok(!!r.entry_id, "私人帳本有入帳", JSON.stringify(r));
ok(Math.round((privacy.listLedger(db, "coach", r.student_id)[0] || {}).amount * 100) === 14000, "金額 $140");

console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
