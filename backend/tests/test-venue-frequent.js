/**
 * Test: GET /api/venue-rentals/frequent（常用場地記憶）route handler
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : "test_secret_key_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-freq-test-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT);
CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, category TEXT, address TEXT, status TEXT);
CREATE TABLE venue_rentals (id TEXT PRIMARY KEY, venue_id TEXT, coach_id TEXT, start_time TEXT, end_time TEXT, price_hkd REAL, status TEXT, created_at TEXT);
`);
db.prepare("INSERT INTO users VALUES (?,?,?,?)").run("co1", "陳教練", "c@x.com", "coach");
db.prepare("INSERT INTO partner_venues VALUES (?,?,?,?,?,?)").run("v1", "康樂中心", "沙田", "綜合", "1 號街", "active");
db.prepare("INSERT INTO partner_venues VALUES (?,?,?,?,?,?)").run("v2", "體育館", "九龍", "球場", "2 號街", "active");
const ins = db.prepare("INSERT INTO venue_rentals VALUES (?,?,?,?,?,?,?,?)");
ins.run("r1", "v1", "co1", "2026-10-01T02:00:00Z", "2026-10-01T03:00:00Z", 200, "confirmed", "now");
ins.run("r2", "v1", "co1", "2026-10-08T02:00:00Z", "2026-10-08T03:00:00Z", 240, "confirmed", "now"); // v1 最近
ins.run("r3", "v2", "co1", "2026-10-05T02:00:00Z", "2026-10-05T03:00:00Z", 150, "confirmed", "now");
ins.run("r4", "v1", "co1", "2026-10-20T02:00:00Z", "2026-10-20T03:00:00Z", 999, "cancelled", "now"); // 取消唔計
db.close();

const router = require("/Users/user/.openclaw/workspace/zenpass-platform/backend/src/routes/venue-rentals.js");
const layer = router.stack.find((l) => l.route && l.route.path === "/frequent" && l.route.methods.get);
if (!layer) { console.error("❌ /frequent route not found"); process.exit(1); }
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

let body = null;
const res = { json: (b) => { body = b; }, status: () => res };
handler({ user: { id: "co1", role: "coach" }, query: {} }, res);

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };
if (!body || !body.success) { console.error("❌ no body", body); process.exit(1); }
const data = body.data || [];
eq(data.length, 2, "2 frequent venues");
eq(data[0].venue_id, "v1", "most-used venue first (2 times)");
eq(data[0].times, 2, "v1 times=2");
eq(data[0].last_price, 240, "v1 last price = most recent (240)");
eq(data[0].last_start, "2026-10-08T02:00:00Z", "v1 last_start most recent");

fs.unlinkSync(tmp);
if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ venue /frequent route tests passed");
