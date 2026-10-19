/** ZenPass — 認證安全 tests（2026-10-19）
 *  1. /api/auth/social 未開啟時必須拒絕（原本可冒認任何 email 登入）
 *  2. 密碼重設 token 用加密隨機、生產環境唔會回傳 dev_token
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_jwt_secret_0123456789abcdefghij";
process.env.NODE_ENV = "production";
delete process.env.ALLOW_DEV_RESET_TOKEN;
delete process.env.ENABLE_SOCIAL_LOGIN;

const tmp = path.join(os.tmpdir(), "zenpass-authsec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    reset_token TEXT, reset_token_expires TEXT, auth_provider TEXT, auth_provider_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','admin@zenpass.hk','super_admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();

  const auth = require("../src/routes/auth");
  const pick = (p, method = "post") => {
    const layer = auth.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (handler, body) => {
    const res = { statusCode: 200, headers: {}, cookies: [] };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    res.cookie = (n, v, o) => { res.cookies.push([n, v]); };
    res.clearCookie = () => {};
    res.setHeader = () => {};
    await handler({ body, headers: {}, ip: "1.2.3.4", socket: { remoteAddress: "1.2.3.4" }, protocol: "https", get: () => "zenpass.hk" }, res);
    return res;
  };

  console.log("🧪 認證安全 tests");

  // 1. social login 封鎖
  const social = pick("/social");
  const s1 = await call(social, { provider: "google", providerId: "hacker", email: "admin@zenpass.hk" });
  ok(s1.statusCode === 403 && s1.body.code === "SOCIAL_LOGIN_DISABLED", `冒認 admin email → 403（got ${s1.statusCode}）`);
  ok(!s1.body.token, "冇 token 回傳");
  ok(!s1.body.user, "冇用戶資料泄漏");

  const s2 = await call(social, { provider: "apple", providerId: "x", email: "admin@zenpass.hk" });
  ok(s2.statusCode === 403, "Apple 偽造 token 路徑亦封");

  // 2. 密碼重設
  const resetReq = pick("/password-reset-request");
  const r1 = await call(resetReq, { email: "admin@zenpass.hk" });
  ok(r1.statusCode === 200, "重設請求正常回應");
  ok(!r1.body.dev_token, "生產環境唔會回傳 dev_token");
  const row = db.prepare("SELECT reset_token FROM users WHERE id='admin1'").get();
  ok(/^[a-f0-9]{64}$/.test(row.reset_token || ""), `token 係 64 位 hex（got ${(row.reset_token || "").length} 字）`);

  // 回應唔應該泄漏帳戶存在與否
  const r2 = await call(resetReq, { email: "nobody@zenpass.hk" });
  ok(r2.body.message === r1.body.message, "存在／不存在帳戶回應一致");

  // 3. 原始碼唔再用 Math.random 產生 token
  const src = fs.readFileSync(path.join(__dirname, "../src/routes/auth.js"), "utf8");
  ok(!/verificationToken = Math\.random/.test(src) && !/const token = Math\.random/.test(src), "verification／reset token 冇用 Math.random");
  ok(src.includes("ALLOW_DEV_RESET_TOKEN"), "dev token 需要明確開關");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
