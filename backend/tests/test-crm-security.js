/** ZenPass — CRM 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-crmsec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    membership_expires_at TEXT, avatar_url TEXT, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('u1','普通','u@x.com','user')").run();
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('c1','教練','c@x.com','coach')").run();
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','a@x.com','admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const router = require("../src/routes/crm");
  const layer = router.stack.find((l) => l.route && l.route.path === "/students" && l.route.methods.get);
  const guard = layer.route.stack[1].handle;

  const call = (userId) => {
    let status = 200;
    let next = false;
    guard(
      { user: { id: userId, role: "user" }, cookies: {}, headers: {} },
      { status(c) { status = c; return this; }, json() { return this; } },
      () => { next = true; },
    );
    return { status, next };
  };

  console.log("🧪 CRM 權限 tests");
  const normal = call("u1");
  ok(!normal.next && normal.status === 403, "普通用戶睇學生名單 → 403");
  ok(call("c1").next, "教練可以睇學生名單");
  ok(call("admin1").next, "admin 都可以用 CRM（之前被 requireCoach 錯誤排除）");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/crm.js"), "utf8");
  ok((src.match(/authenticateToken, requireCoach/g) || []).length === 6, "5 個 CRM route + import 都 requireCoach（含 import 行）");
  ok(/router\.post\("\/waiver", authenticateToken, \(/.test(src), "健康申報保持開放俾普通用戶");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
