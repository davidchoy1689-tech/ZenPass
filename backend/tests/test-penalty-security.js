/** ZenPass — 罰則 API 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-penalt-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','a@x.com')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  console.log("🧪 罰則 API 權限 tests");

  const router = require("../src/routes/penalty");
  const layer = router.stack.find((l) => l.route && l.route.path === "/process-no-shows");
  const guard = layer.route.stack[0].handle;

  const callGuard = (ip) => {
    let nextCalled = false;
    let out = null;
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(x) { out = x; return this; },
    };
    guard({ ip, headers: {}, cookies: {}, user: null }, res, () => { nextCalled = true; });
    return { nextCalled, status: res.statusCode, body: out };
  };

  const local = callGuard("127.0.0.1");
  ok(local.nextCalled, "本機 scheduler 可直接觸發");
  const mapped = callGuard("::ffff:127.0.0.1");
  ok(mapped.nextCalled, "IPv4-mapped loopback 亦可");
  const remote = callGuard("203.0.113.9");
  ok(!remote.nextCalled && remote.status === 401, "外部未登入 → 401");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/penalty.js"), "utf8");
  ok(/router\.post\("\/process-no-shows", adminOrLocal/.test(src), "route 已套用 adminOrLocal");
  ok((src.match(/\[\"admin\", \"super_admin\"\]\.includes\(user\.role\)/g) || []).length >= 3, "settings/stats/process 都接受 super_admin");
  ok(/booking\.coach_id !== req\.user\.id/.test(src), "教練只可處理自己班學生");
  ok(/requireAdmin/.test(src), "有 requireAdmin 保護");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
