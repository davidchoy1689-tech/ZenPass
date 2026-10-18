/** ZenPass — Crawler SSRF / 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-crawlsec-" + Date.now() + ".db");
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

  const router = require("../src/routes/crawler");
  const layer = router.stack.find((l) => l.route && l.route.path === "/crawl");
  ok(layer.route.stack.length >= 3, "crawl route 有 auth + admin middleware");

  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = async (url) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    await handler({ body: { url, useAI: false }, user: { id: "u1", role: "admin" } }, res);
    return res;
  };

  console.log("🧪 Crawler SSRF tests");
  const local = await call("http://127.0.0.1:3001/api/admin/db");
  ok(local.statusCode === 403, "127.0.0.1 → 403");
  const meta = await call("http://169.254.169.254/latest/meta-data/");
  ok(meta.statusCode === 403, "雲端 metadata → 403");
  const internal = await call("http://192.168.1.10/");
  ok(internal.statusCode === 403, "內網 IP → 403");
  const proto = await call("file:///etc/passwd");
  ok(proto.statusCode === 400, "非 http(s) → 400");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/crawler.js"), "utf8");
  ok(/router\.post\("\/crawl", authenticateToken, requireAdmin/.test(src), "crawl 只限 admin");
  ok(/169\\\.254/.test(src) && /192\\\.168/.test(src), "有內網封鎖清單");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
