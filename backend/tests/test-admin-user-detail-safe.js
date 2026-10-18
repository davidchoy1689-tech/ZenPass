/** ZenPass — Admin user detail 唔應回傳密碼 hash */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-udetail-" + Date.now() + ".db");
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
    verification_token TEXT, reset_token TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,password_hash,verification_token,reset_token) VALUES ('u1','甲','a@x.com','HASH_SECRET','VT','RT')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getUserDetail } = require("../src/services/admin-service");
  const r = getUserDetail("u1");

  console.log("🧪 Admin user detail 安全 tests");
  ok(r.status === 200, "回傳 200");
  ok(r.body.user.email === "a@x.com", "正常資料仍然存在");
  ok(!("password_hash" in r.body.user), "唔回傳 password_hash");
  ok(!("verification_token" in r.body.user), "唔回傳 verification_token");
  ok(!("reset_token" in r.body.user), "唔回傳 reset_token");

  const src = fs.readFileSync(path.join(__dirname, "../src/services/admin-service.js"), "utf8");
  ok(/唔好將密碼 hash/.test(src), "有註解說明");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
