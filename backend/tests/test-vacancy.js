/**
 * Test: 空置時段服務（suggestDiscount / listVacantSchedules / config / publishVacancyPromo）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-vacancy-test-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, partner_id TEXT);
CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, user_id TEXT, email TEXT, status TEXT);
CREATE TABLE partner_members (id TEXT PRIMARY KEY, user_id TEXT, partner_id TEXT, role TEXT, status TEXT);
CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, category TEXT, credits_cost INTEGER, price_hkd REAL,
  coach_id TEXT, partner_id TEXT, partner_venue_id TEXT, venue_name TEXT, max_participants INTEGER, status TEXT);
CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT,
  enrolled_count INTEGER, max_participants INTEGER, status TEXT, created_at TEXT);
CREATE TABLE promo_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE, type TEXT, value REAL, class_id TEXT,
  max_uses INTEGER, used_count INTEGER, per_user_limit INTEGER, valid_from TEXT, valid_to TEXT,
  active INTEGER, description TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
`);
db.prepare("INSERT INTO users VALUES (?,?,?,?)").run("co1", "陳教練", "co1@x.com", "v1");
db.prepare("INSERT INTO partner_venues VALUES (?,?,?,?,?,?)").run("v1", "康樂中心", "co1", "co1", "v@x.com", "active");
db.prepare("INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("c1", "芬蘭木柱班", "新興運動", 12, 120, "co1", "v1", "v1", "康樂中心", 10, "active");
db.prepare("INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("c2", "瑜伽班", "身心伸展", 12, 120, "co1", "v1", "v1", "康樂中心", 10, "active");
db.prepare("INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("c3", "滿座班", "球類", 12, 120, "co1", "v1", "v1", "康樂中心", 10, "active");
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const ins = db.prepare("INSERT INTO class_schedules VALUES (?,?,?,?,?,?,?,?)");
// c1: 1/10 位 → 空置（3 日後）
ins.run("s1", "c1", iso(3 * 86400000), iso(3 * 86400000 + 3600000), 1, 10, "available", "now");
// c2: 4/10 位 → 空置（5 日後）
ins.run("s2", "c2", iso(5 * 86400000), iso(5 * 86400000 + 3600000), 4, 10, "available", "now");
// c3: 9/10 位 → 唔算空置
ins.run("s3", "c3", iso(2 * 86400000), iso(2 * 86400000 + 3600000), 9, 10, "available", "now");
// 過去時段 → 唔計
ins.run("s4", "c1", iso(-86400000), iso(-86400000 + 3600000), 0, 10, "available", "now");
// 超出窗口（20 日後） → 唔計（within_days 7）
ins.run("s5", "c1", iso(20 * 86400000), iso(20 * 86400000 + 3600000), 0, 10, "available", "now");
db.close();

const vac = require("/Users/user/.openclaw/workspace/zenpass-platform/backend/src/services/vacancy.js");
const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

// suggestDiscount
eq(vac.suggestDiscount(0, 3 * 24, { min_discount: 0.1, max_discount: 0.3 }), 0.3, "empty far → max 0.3");
eq(vac.suggestDiscount(0.9, 3 * 24, { min_discount: 0.1, max_discount: 0.3 }), 0.12, "near-full → 0.12 (min + scaled)");
const near = vac.suggestDiscount(0, 2, { min_discount: 0.1, max_discount: 0.3 });
eq(near, 0.3, "near cap at max");

// listVacantSchedules
const res = vac.listVacantSchedules({ venueId: "v1", venueName: "康樂中心", withinDays: 7, fillBelow: 0.5 });
eq(res.slots.length, 2, "2 vacant slots in window");
eq(res.slots[0].class_id, "c1", "earliest first");
eq(res.slots[0].seats_left, 9, "seats_left 9");
eq(res.slots[0].discount_pct, 28, "discount 28% (fill 10%, far)");
eq(res.slots[0].discounted_credits, 9, "discounted credits 12→9");

// config round-trip
vac.setVacancyConfig("v1", { enabled: true, fill_below: 0.4, within_days: 10 });
const cfg = vac.getVacancyConfig("v1");
eq(cfg.enabled, true, "config enabled");
eq(cfg.within_days, 10, "config within_days");
const enabled = vac.listEnabledVenues();
eq(enabled.length, 1, "1 enabled venue");
eq(enabled[0].venue.id, "v1", "enabled venue id");

// publishVacancyPromo
vac.setVacancyConfig("v1", { enabled: true, fill_below: 0.5, within_days: 7, max_discount: 0.3 });
const pub = vac.publishVacancyPromo("v1", { class_id: "c1", venue_name: "康樂中心" });
eq(pub.ok, true, "publish ok");
if (!pub.promo || !/^V/.test(pub.promo.code)) fails.push("promo code format: " + JSON.stringify(pub));
eq(pub.promo.value, 28, "promo percent value 28");

const db2 = new Database(tmp);
const row = db2.prepare("SELECT * FROM promo_codes WHERE code = ?").get(pub.promo.code);
if (!row) fails.push("promo row not inserted");
else { eq(row.type, "percent", "promo type"); eq(row.class_id, "c1", "promo class"); eq(row.active, 1, "promo active"); }
db2.close();

// 非本人課程
const bad = vac.publishVacancyPromo("v1", { class_id: "nope" });
eq(bad.ok, false, "unknown class rejected");

fs.unlinkSync(tmp);
if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ vacancy tests passed");
