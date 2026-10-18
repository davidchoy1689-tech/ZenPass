/** ZenPass — /memberships/my 過期會籍顯示 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-mmy-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    membership_expires_at TEXT, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,membership_type,membership_expires_at,credits) VALUES ('old','舊','o@x.com','standard','2026-06-25T17:59:58.680Z',5)").run();
  pre.prepare("INSERT INTO users (id,name,email,membership_type,membership_expires_at,credits) VALUES ('act','現','a@x.com','gold','2099-12-31',10)").run();
  pre.close();
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const router = require("../src/routes/memberships");
  const layer = router.stack.find((l) => l.route && l.route.path === "/my");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const call = (id) => {
    const res = {};
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    handler({ user: { id }, query: {} }, res);
    return res.body;
  };

  console.log("🧪 /memberships/my 過期顯示 tests");
  const old = call("old");
  ok(old.current.type === "none" && old.current.expires_at === null, "過期會籍顯示 none + null");
  ok(old.current.credits === 5, "credits 保持不變");
  const act = call("act");
  ok(act.current.type === "gold" && act.current.expires_at === "2099-12-31", "有效會籍照常顯示");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/memberships.js"), "utf8");
  ok(/已過期但未清理/.test(src), "有過期顯示保護");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
