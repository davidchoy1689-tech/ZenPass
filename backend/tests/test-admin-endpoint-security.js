/** ZenPass — Admin 敏感 endpoint 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-adminsec-" + Date.now() + ".db");
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

  console.log("🧪 Admin 敏感 endpoint 權限 tests");

  const root = path.join(__dirname, "../src/routes");

  const opts = { headers: {}, cookies: {}, get: () => "", ip: "203.0.113.9" };
  const fakeRes = () => {
    const o = { statusCode: 200, body: null };
    o.status = (c) => { o.statusCode = c; return o; };
    o.json = (x) => { o.body = x; return o; };
    return o;
  };

  // 未登入 call 第一個 guard
  const check401 = (routerPath, method, routePath) => {
    const mod = require(routerPath);
    const router = mod.router || mod;
    const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
    if (!layer) return { missing: true };
    const guard = layer.route.stack[0].handle;
    let nextCalled = false;
    const res = fakeRes();
    guard({ ...opts }, res, () => { nextCalled = true; });
    return { nextCalled, status: res.statusCode };
  };

  const dbDump = check401(path.join(root, "admin"), "get", "/db");
  ok(!dbDump.missing && !dbDump.nextCalled && dbDump.status === 401, "GET /admin/db 未登入 → 401");

  const writeFile = check401(path.join(root, "deploy"), "post", "/write-file");
  ok(!writeFile.missing && !writeFile.nextCalled && writeFile.status === 401, "POST /admin/write-file 未登入 → 401");

  const deploy = check401(path.join(root, "deploy"), "post", "/deploy");
  ok(!deploy.missing && !deploy.nextCalled && deploy.status === 401, "POST /admin/deploy 未登入 → 401");

  const audit = check401(path.join(root, "audit").replace(/\.js$/, ""), "get", "/booking/:id");
  ok(!audit.missing && !audit.nextCalled && audit.status === 401, "GET /audit/booking/:id 未登入 → 401");

  console.log("── 靜態檢查 ──");
  const adminSrc = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  const deploySrc = fs.readFileSync(path.join(root, "deploy.js"), "utf8");
  const auditSrc = fs.readFileSync(path.join(root, "audit.js"), "utf8");
  ok(/router\.get\("\/db", authenticateToken, requireAdmin/.test(adminSrc) && /router\.get\("\/db\/:table", authenticateToken, requireAdmin/.test(adminSrc), "DB dump 兩個 route 都有 admin 權限");
  ok(!/router\.post\("\/write-file", authenticateToken, \(/.test(deploySrc) && /router\.post\("\/write-file", authenticateToken, requireAdmin/.test(deploySrc), "write-file 有 requireAdmin");
  ok(/router\.post\("\/deploy", authenticateToken, requireAdmin/.test(deploySrc), "deploy 有 requireAdmin");
  ok(/startsWith\(FRONTEND_DIR \+ path\.sep\)/.test(deploySrc), "write-file 路徑用 path.sep 邊界檢查");
  ok((auditSrc.match(/authenticateToken, requireAdmin/g) || []).length >= 5, "audit 全部 route 要 admin");
  const ceSrc = fs.readFileSync(path.join(root, "coach-earnings.js"), "utf8");
  ok(/router\.get\("\/admin\/all-earnings", authenticateToken, requireAdmin/.test(ceSrc), "all-earnings 用 role 而唔係硬編 email");
  const notifSrc2 = fs.readFileSync(path.join(root, "notifications.js"), "utf8");
  ok(/router\.get\("\/config", authenticateToken, requireAdmin/.test(notifSrc2), "通知 config 只限 admin");
  ok(/router\.post\("\/test", authenticateToken, requireAdmin/.test(notifSrc2), "通知測試只限 admin");
  ok(/router\.(get|post)\("\/telegram\/[^"]+", authenticateToken, requireAdmin/g.test(notifSrc2) || (/telegram\/auto-detect", authenticateToken, requireAdmin/.test(notifSrc2) && /telegram\/test", authenticateToken, requireAdmin/.test(notifSrc2)), "Telegram 設定只限 admin");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
