/** ZenPass — Auto Top-up 免費加點防護 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-autotopup-" + Date.now() + ".db");
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
  pre.prepare("INSERT INTO users (id,name,email,credits,role) VALUES ('u1','甲','a@x.com',0,'user')").run();
  pre.prepare("INSERT INTO users (id,name,email,credits,role) VALUES ('admin1','Admin','ad@x.com',0,'admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const router = require("../src/routes/topup");
  const layer = router.stack.find((l) => l.route && l.route.path === "/config" && l.route.methods.put);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const call = (user, body) => {
    let out = null;
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(x) { out = x; return this; },
    };
    handler({ user, body, params: {} }, res);
    return { status: res.statusCode, body: out };
  };

  console.log("🧪 Auto Top-up 防護 tests");

  const userAttempt = call({ id: "u1", role: "user" }, { enabled: true, threshold: 10, bundle: "premium" });
  ok(userAttempt.status === 403, "普通用戶啟用自動增值 → 403");
  ok(userAttempt.body && userAttempt.body.code === "AUTO_TOPUP_DISABLED", "回傳 AUTO_TOPUP_DISABLED");

  const db = require("../src/services/database").getDb();
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 0, "冇免費加 credits");

  const adminAttempt = call({ id: "admin1", role: "admin" }, { enabled: true, threshold: 10, bundle: "premium" });
  ok(adminAttempt.status === 200, "admin 可以儲存設定");
  ok(!adminAttempt.body.auto_executed, "儲存設定時唔會即時加點");
  ok(db.prepare("SELECT credits FROM users WHERE id='admin1'").get().credits === 0, "admin 亦冇即時加 credits");

  console.log("── 接線 ──");
  const src = fs.readFileSync(path.join(__dirname, "../src/routes/topup.js"), "utf8");
  const web = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "topup-auto.html"), "utf8");
  ok(/AUTO_TOPUP_DISABLED/.test(src), "後端有封鎖碼");
  ok(!/if \(finalEnabled\) \{\s*autoExecuted = executeAutoTopup/.test(src), "已移除即時執行");
// 2026-10-24：/execute 完全停用（admin 亦唔可以無付款加點）
ok(
  /router\.post\("\/execute"[\s\S]{0,700}code: "DISABLED"/.test(src),
  "/execute 完全停用（admin 都唔可以無付款加點）",
);
  ok(/暫停用/.test(web), "前端顯示暫停用提示");
  ok(/id="en"[^>]*disabled/.test(web), "前端開關已停用");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
