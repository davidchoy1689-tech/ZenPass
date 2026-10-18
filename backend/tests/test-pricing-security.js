/** ZenPass — 定價 API 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-pricingsec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  console.log("🧪 定價 API 權限 tests");

  const router = require("../src/routes/pricing");
  const layer = router.stack.find(
    (l) => l.route && l.route.path === "/admin/pricing" && l.route.methods.put,
  );
  ok(!!layer, "PUT /admin/pricing 存在");
  ok(layer.route.stack.length >= 3, "已加 middleware（原本冇 auth）");

  const authGuard = layer.route.stack[0].handle;
  let status = null;
  let body = null;
  authGuard(
    { headers: {}, cookies: {}, get: () => "", ip: "203.0.113.9" },
    {
      status(c) { status = c; return this; },
      json(x) { body = x; return this; },
    },
    () => { status = 200; },
  );
  ok(status === 401, "未登入 PUT → 401");
  ok(!!body && body.error, "有錯誤訊息");

  const getLayer = router.stack.find(
    (l) => l.route && l.route.path === "/admin/pricing" && l.route.methods.get,
  );
  ok(!!getLayer && getLayer.route.stack.length >= 3, "GET /admin/pricing 亦有 middleware");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/pricing.js"), "utf8");
  ok(/router\.put\("\/admin\/pricing", authenticateToken, requireAdmin/.test(src), "PUT 已加 authenticateToken + requireAdmin");
  ok(/router\.get\("\/admin\/pricing", authenticateToken, requireAdmin/.test(src), "GET 已加 authenticateToken + requireAdmin");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
