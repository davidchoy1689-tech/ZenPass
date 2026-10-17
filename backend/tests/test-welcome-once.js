/**
 * Test: 迎新優惠每帳戶只限一次（WELCOME50）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-welcome-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE promo_codes (id TEXT PRIMARY KEY, code TEXT UNIQUE, type TEXT, value REAL, class_id TEXT,
  max_uses INTEGER, used_count INTEGER DEFAULT 0, per_user_limit INTEGER, valid_from TEXT, valid_to TEXT,
  active INTEGER DEFAULT 1, description TEXT, created_at TEXT);
CREATE TABLE promo_redemptions (id TEXT PRIMARY KEY, code_id TEXT, user_id TEXT, booking_id TEXT, amount REAL, created_at TEXT);
`);
db.prepare("INSERT INTO promo_codes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
  "p1", "WELCOME50", "percent", 50, null, 1000, 0, 1, null, null, 1, "新用戶首堂半價（迎新優惠）", "now",
);
// 另一個迎新碼（測試「即使唔同碼都只限一次」）
db.prepare("INSERT INTO promo_codes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
  "p2", "HELLOZEN", "percent", 30, null, 1000, 0, 1, null, null, 1, "迎新優惠第二彈", "now",
);
db.close();

const promo = require("/Users/user/.openclaw/workspace/zenpass-platform/backend/src/services/promo.js");
const getDb = () => new Database(tmp);

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

eq(promo.isWelcomePromo({ code: "WELCOME50", description: "" }), true, "WELCOME50 is welcome");
eq(promo.isWelcomePromo({ code: "SUMMER", description: "迎新優惠" }), true, "description 迎新 is welcome");
eq(promo.isWelcomePromo({ code: "SUMMER", description: "夏日" }), false, "normal promo not welcome");

// 新用戶可以用
{
  const d = getDb();
  const r = promo.validatePromo(d, { code: "WELCOME50", basePrice: 150, userId: "u1" });
  eq(r.ok, true, "first-time user can use WELCOME50");
  eq(r.final_price, 75, "50% off 150 → 75");
  d.close();
}

// 已用過 WELCOME50 → 再用另一迎新碼都要拒
{
  const d = getDb();
  promo.redeemPromo(d, "p1", "u1", "b1", 75);
  d.close();
}
{
  const d = getDb();
  const again = promo.validatePromo(d, { code: "WELCOME50", basePrice: 150, userId: "u1" });
  eq(again.ok, false, "same code second time rejected");
  if (!/只可使用一次|已用過/.test(again.error || "")) fails.push("error msg: " + again.error);

  const other = promo.validatePromo(d, { code: "HELLOZEN", basePrice: 150, userId: "u1" });
  eq(other.ok, false, "different welcome code also rejected");

  const u2 = promo.validatePromo(d, { code: "HELLOZEN", basePrice: 150, userId: "u2" });
  eq(u2.ok, true, "another account can still use welcome");
  d.close();
}

// per_user_limit 強制 1（init-db backfill 邏輯）
{
  const d = new Database(tmp);
  d.prepare("UPDATE promo_codes SET per_user_limit = NULL WHERE id='p1'").run();
  d.prepare("UPDATE promo_codes SET per_user_limit = 1 WHERE UPPER(code) LIKE 'WELCOME%' AND (per_user_limit IS NULL OR per_user_limit > 1)").run();
  eq(d.prepare("SELECT per_user_limit FROM promo_codes WHERE id='p1'").get().per_user_limit, 1, "backfill per_user_limit=1");
  d.close();
}

// 前端 / 路由
const root = path.join(__dirname, "../../frontend-v2");
const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
const route = fs.readFileSync(path.join(__dirname, "../src/routes/promo.js"), "utf8");
const initdb = fs.readFileSync(path.join(__dirname, "../src/config/init-db.js"), "utf8");
if (!idx.includes("welcome-status")) fails.push("index should check welcome-status");
if (!idx.includes("迎新優惠已使用")) fails.push("index should show used state");
if (!route.includes('"/welcome-status"')) fails.push("promo route welcome-status missing");
if (!initdb.includes("per_user_limit = 1")) fails.push("init-db should enforce per_user_limit");

fs.unlinkSync(tmp);
if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ 迎新優惠（每帳戶一次）tests passed");
