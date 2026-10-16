/**
 * Test: 場地月結單 buildStatement + renderStatementHtml
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-stmt-test-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, district TEXT, category TEXT, commission_rate REAL, commission_plan TEXT, email TEXT, status TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, role TEXT);
CREATE TABLE venue_rentals (id TEXT PRIMARY KEY, venue_id TEXT, coach_id TEXT, start_time TEXT, end_time TEXT, price_hkd REAL, status TEXT, created_at TEXT, commission_rate REAL, commission_amount REAL, venue_earned REAL);
CREATE TABLE platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT);
`);
db.prepare("INSERT INTO partner_venues VALUES (?,?,?,?,?,?,?,?,?)").run("v1", "康樂中心", "1 號街", "沙田", "運動場", 0.15, "basic", "venue@example.com", "active");
db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("c1", "陳教練", "c1@example.com", "111", "coach");
db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("c2", "李教練", "c2@example.com", "222", "coach");

// 3 rentals in Oct 2026 (HKT). Stored as UTC Z.
// 2026-10-05 10:00 HKT = 02:00Z
db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("r1", "v1", "c1", "2026-10-05T02:00:00.000Z", "2026-10-05T04:00:00.000Z", 400, "confirmed", "2026-10-05T01:00:00Z", 0.15, 0, 0);
db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("r2", "v1", "c1", "2026-10-12T02:00:00.000Z", "2026-10-12T03:00:00.000Z", 200, "completed", "2026-10-12T01:00:00Z", 0.15, 0, 0);
db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("r3", "v1", "c2", "2026-10-19T02:00:00.000Z", "2026-10-19T05:00:00.000Z", 600, "confirmed", "2026-10-19T01:00:00Z", 0.15, 0, 0);
// pending — should NOT count
db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("r4", "v1", "c2", "2026-10-20T02:00:00.000Z", "2026-10-20T03:00:00.000Z", 200, "pending", "2026-10-20T01:00:00Z", 0.15, 0, 0);
// Sept — out of month
db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("r5", "v1", "c1", "2026-09-30T02:00:00.000Z", "2026-09-30T03:00:00.000Z", 300, "confirmed", "2026-09-30T01:00:00Z", 0.15, 0, 0);
db.close();

const { buildStatement, renderStatementHtml, prevMonthKey } = require("/Users/user/.openclaw/workspace/zenpass-platform/backend/src/services/venue-statement.js");

const stmt = buildStatement("v1", "2026-10");
const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

eq(stmt.month, "2026-10", "month");
eq(stmt.rentals.length, 3, "confirmed+completed count in month");
eq(stmt.totals.gross, 1200, "gross");
eq(stmt.totals.commission, 180, "commission 15%");
eq(stmt.totals.net, 1020, "net");
eq(stmt.totals.hours, 6, "hours");
eq(stmt.pending_count, 1, "pending count");
eq(stmt.byCoach.length, 2, "byCoach count");
eq(stmt.byCoach[0].coach_name, "陳教練", "top coach by gross");
eq(stmt.byCoach[0].gross, 600, "coach1 gross");
eq(stmt.rentals[0].date_hkt, "2026-10-05", "date_hkt");

const html = renderStatementHtml(stmt);
if (!html.includes("康樂中心")) fails.push("html missing venue");
if (!html.includes("HK$1,200.00")) fails.push("html missing gross formatted");
if (!html.toLowerCase().includes("<!doctype html>")) fails.push("html doctype");

// prev month
const pm = prevMonthKey("2026-01");
eq(pm, "2025-12", "prevMonthKey rollover");

fs.unlinkSync(tmp);
if (fails.length) {
  console.error("❌ FAILED:\n" + fails.join("\n"));
  process.exit(1);
}
console.log("✅ venue-statement tests passed");
console.log("   gross=$" + stmt.totals.gross + " commission=$" + stmt.totals.commission + " net=$" + stmt.totals.net);
