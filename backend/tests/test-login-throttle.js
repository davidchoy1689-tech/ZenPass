/** ZenPass — 登入失敗節流 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-loginlimit-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', auth_provider TEXT DEFAULT 'email', email_verified INTEGER DEFAULT 1,
    credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,password_hash) VALUES ('u1','甲','victim@x.com',?)").run(bcrypt.hashSync("correct123", 4));
  pre.prepare("INSERT INTO users (id,name,email,password_hash) VALUES ('u2','乙','other@x.com',?)").run(bcrypt.hashSync("correct123", 4));
  pre.close();
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const router = require("../src/routes/auth");
  const layer = router.stack.find((l) => l.route && l.route.path === "/login");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const attempt = (email, password) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    res.cookie = () => res;
    handler({ body: { email, password }, headers: {}, ip: "1.2.3.4", connection: {} }, res);
    return res;
  };

  console.log("🧪 登入失敗節流 tests");
  let last;
  for (let i = 0; i < 10; i++) last = attempt("victim@x.com", "wrong");
  ok(last.statusCode === 401, "前 10 次錯誤 → 401");

  const blocked = attempt("victim@x.com", "wrong");
  ok(blocked.statusCode === 429, "第 11 次 → 429");
  const evenCorrect = attempt("victim@x.com", "correct123");
  ok(evenCorrect.statusCode === 429, "封鎖期間正確密碼都拒（15 分鐘）");

  const other = attempt("other@x.com", "wrong");
  ok(other.statusCode === 401, "其他帳戶不受影響");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/auth.js"), "utf8");
  ok(/LOGIN_MAX_FAILS = 10/.test(src) && /loginBlocked/.test(src), "有節流邏輯");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
