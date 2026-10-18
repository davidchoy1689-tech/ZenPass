/** ZenPass — 6 位電郵驗證碼 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-emailcode-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 0, verification_token TEXT,
    verification_token_expires TEXT, verification_code TEXT, verification_code_expires TEXT,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,verification_code,verification_code_expires) VALUES ('ok_u','甲','a@x.com','123456',datetime('now','+10 minutes'))").run();
  pre.prepare("INSERT INTO users (id,name,email,verification_code,verification_code_expires) VALUES ('exp_u','乙','b@x.com','654321',datetime('now','-1 minute'))").run();
  pre.prepare("INSERT INTO users (id,name,email,verification_code,verification_code_expires) VALUES ('bad_u','丙','c@x.com','111111',datetime('now','+10 minutes'))").run();
  pre.close();
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const router = require("../src/routes/auth");
  const layer = router.stack.find((l) => l.route && l.route.path === "/verify-code");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const call = (uid, code) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    handler({ user: { id: uid }, body: { code } }, res);
    return res;
  };

  console.log("🧪 電郵驗證碼 tests");
  ok(call("bad_u", "999999").statusCode === 400, "錯誤驗證碼 → 400");
  ok(call("exp_u", "654321").statusCode === 400, "過期驗證碼 → 400");
  const good = call("ok_u", "123456");
  ok(good.statusCode === 200 && good.body.success, "正確驗證碼 → 成功");
  ok(db.prepare("SELECT email_verified FROM users WHERE id='ok_u'").get().email_verified === 1, "email_verified=1");
  ok(db.prepare("SELECT verification_code FROM users WHERE id='ok_u'").get().verification_code === null, "驗證碼已清除");
  ok(call("ok_u", "123456").statusCode === 200, "已驗證再驗 → 仍成功（idempotent）");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/auth.js"), "utf8");
  const my = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "my.html"), "utf8");
  ok(/genVerifyCode/.test(src) && /verification_code/.test(src), "註冊／重發有產生驗證碼");
  ok(/auth\/verify-code/.test(my) && /verifyCode/.test(my), "我的頁有輸入驗證碼 UI");
  ok(/verifyCodeLimiter/.test(src) && /max: 10/.test(src), "驗證碼嘗試限流 10 次/15 分鐘");
  ok(/resendVerifyLimiter/.test(src) && /max: 3/.test(src), "重發限流 3 次/小時");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
