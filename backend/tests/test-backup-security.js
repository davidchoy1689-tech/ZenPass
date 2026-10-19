/** ZenPass — 備份 API 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-baksec-" + Date.now() + ".db");
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

  const router = require("../src/routes/backup");
  const layer = router.stack.find((l) => l.route && l.route.path === "/restore/:id");
  ok(!!layer, "restore route 存在");

  let status = null;
  let nextCalled = false;
  const guard = layer.route.stack[0].handle;
  guard(
    { headers: {}, cookies: {}, get: () => "", ip: "203.0.113.9", params: { id: "x" } },
    { status(c) { status = c; return this; }, json() { return this; } },
    () => { nextCalled = true; },
  );

  console.log("🧪 備份 API 權限 tests");
  ok(!nextCalled && status === 401, "未登入 restore → 401");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/backup.js"), "utf8");
  const authRoutes = src.match(/router\.(get|post|delete)\([^,]+, authenticateToken, requireAdmin/g) || [];
  ok(authRoutes.length >= 5, `${authRoutes.length} 個 auth route 全部 requireAdmin`);
  ok(/requireAdmin/.test(src) && !/authenticateToken, async/.test(src), "冇漏 requireAdmin 嘅 auth route");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
