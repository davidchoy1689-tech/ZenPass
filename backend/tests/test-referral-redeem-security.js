/** ZenPass — 推薦碼兌換防假帳戶 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-refsec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 0, credits INTEGER DEFAULT 0,
    referral_credits_earned INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  const add = (id, verified) => pre.prepare("INSERT INTO users (id,name,email,email_verified) VALUES (?,?,?,?)")
    .run(id, id, id + "@x.com", verified);
  add("ref", 1); add("new", 0); add("newok", 1);
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("INSERT INTO referral_codes (id,user_id,code) VALUES ('rc1','ref','REF123')").run();

  const router = require("../src/routes/referral");
  const layer = router.stack.find((l) => l.route && l.route.path === "/redeem");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const call = (uid) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    handler({ user: { id: uid }, body: { code: "REF123" } }, res);
    return res;
  };

  console.log("🧪 推薦碼防假帳戶 tests");

  const denied = call("new");
  ok(denied.statusCode === 403 && denied.body.code === "EMAIL_NOT_VERIFIED", "未驗證電郵 → 403");
  ok(db.prepare("SELECT credits FROM users WHERE id='new'").get().credits === 0, "未驗證唔會加 credits");

  const okRes = call("newok");
  ok(okRes.statusCode === 200, "已驗證可兌換");
  ok(db.prepare("SELECT credits FROM users WHERE id='newok'").get().credits === 10, "新人 +10 credits");
  ok(db.prepare("SELECT credits FROM users WHERE id='ref'").get().credits === 10, "推薦人 +10 credits");

  const again = call("newok");
  ok(again.statusCode === 400, "同一用戶不可重複兌換");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/referral.js"), "utf8");
  ok(/EMAIL_NOT_VERIFIED/.test(src), "有防護碼");
  const my = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "my.html"), "utf8");
  ok(/verifyBanner/.test(my) && /resend-verification/.test(my), "我的頁有未驗證提示 + 重發按鈕");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
