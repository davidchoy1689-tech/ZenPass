/**
 * Test: 場地結算（平台代收 → 月結 → 下月 15 號過數）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-vsettle-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, district TEXT, category TEXT, commission_rate REAL, commission_plan TEXT, email TEXT, status TEXT, bank_name TEXT, bank_account TEXT);
CREATE TABLE venue_rentals (id TEXT PRIMARY KEY, venue_id TEXT, coach_id TEXT, start_time TEXT, end_time TEXT, price_hkd REAL, status TEXT, created_at TEXT, commission_rate REAL, commission_amount REAL, venue_earned REAL, payment_status TEXT, paid_at TEXT, payment_method TEXT);
CREATE TABLE venue_penalties (id TEXT PRIMARY KEY, rental_id TEXT, venue_id TEXT, coach_id TEXT, type TEXT, amount_hkd REAL, status TEXT, note TEXT, created_at TEXT);
`);
db.prepare("INSERT INTO partner_venues VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("v1", "康樂中心", "1 號街", "沙田", "運動場", 0.15, "basic", "v@x.com", "active", "HSBC", "123-456");
const ins = db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
// 2 completed+paid in Oct
ins.run("r1", "v1", "c1", "2026-10-05T02:00:00Z", "2026-10-05T04:00:00Z", 400, "completed", "x", 0.15, 0, 0, "paid", "x", "wallet");
ins.run("r2", "v1", "c1", "2026-10-12T02:00:00Z", "2026-10-12T03:00:00Z", 200, "completed", "x", 0.15, 0, 0, "paid", "x", "wallet");
// unpaid → 不計
ins.run("r3", "v1", "c1", "2026-10-19T02:00:00Z", "2026-10-19T03:00:00Z", 300, "completed", "x", 0.15, 0, 0, "unpaid", null, null);
// 未完成 → 不計
ins.run("r4", "v1", "c1", "2026-10-25T02:00:00Z", "2026-10-25T03:00:00Z", 300, "confirmed", "x", 0.15, 0, 0, "paid", "x", "wallet");
// 上月 → 不計
ins.run("r5", "v1", "c1", "2026-09-28T02:00:00Z", "2026-09-28T03:00:00Z", 999, "completed", "x", 0.15, 0, 0, "paid", "x", "wallet");
db.prepare("INSERT INTO venue_penalties VALUES (?,?,?,?,?,?,?,?,?)").run("p1", "r1", "v1", "c1", "venue_failure_200pct", 100, "pending_charge", "罰款", "2026-10-10 03:00:00");
db.close();

const vs = require("/Users/user/.openclaw/workspace/zenpass-platform/backend/src/services/venue-settlement.js");
const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

const s = vs.computeSettlement("v1", "2026-10");
eq(s.rental_count, 2, "2 completed+paid rentals");
eq(s.gross_hkd, 600, "gross 600");
eq(s.commission_hkd, 90, "commission 15% = 90");
eq(s.penalties_hkd, 100, "penalties 100");
eq(s.net_hkd, 410, "net 600-90-100 = 410");
eq(s.payout_date, "2026-11-15", "payout 15 Nov");
eq(s.status, "pending", "status pending");

const run = vs.runMonth("2026-10");
eq(run.created, 1, "runMonth created 1");
const run2 = vs.runMonth("2026-10");
eq(run2.created, 0, "idempotent: no duplicate");

const db2 = new Database(tmp);
const row = db2.prepare("SELECT * FROM venue_settlements WHERE venue_id='v1' AND month='2026-10'").get();
if (!row) fails.push("settlement row missing");
else eq(row.net_hkd, 410, "stored net 410");
db2.close();

const paid = vs.markPaid(row.id, "HSBC transfer");
eq(paid.ok, true, "markPaid ok");
const s2 = vs.computeSettlement("v1", "2026-10");
eq(s2.status, "paid", "status paid after mark");

const db3 = new Database(tmp);
eq(db3.prepare("SELECT status FROM venue_penalties WHERE id='p1'").get().status, "deducted", "penalty marked deducted");
db3.close();

fs.unlinkSync(tmp);
if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ venue settlement tests passed");
