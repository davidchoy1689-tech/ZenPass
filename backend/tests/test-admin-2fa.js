/**
 * ZenPass — 管理員 TOTP 2FA tests
 * node backend/tests/test-admin-2fa.js 2>/dev/null
 */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");
const bcrypt = require("../node_modules/bcryptjs");

process.env.JWT_SECRET = "zenpass-2fa-test-secret-0123456789abcdef";
const tmp = path.join(os.tmpdir(), "zenpass-2fa-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
      role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
      loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
      is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0, auth_provider TEXT DEFAULT 'email',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active');
  `);
  const hash = bcrypt.hashSync("AdminPass123!", 10);
  pre.prepare("INSERT INTO users (id,name,email,password_hash,role,auth_provider) VALUES ('adm1','Admin','admin@zenpass.hk',?,'super_admin','email')").run(hash);
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const totp = require("../src/services/totp");

  const authRouter = require("../src/routes/auth");
  const tfRouter = require("../src/routes/two-factor");
  const pick = (router, p, m) => {
    const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[m]);
    return l.route.stack[l.route.stack.length - 1].handle;
  };
  const call = (fn, req) => {
    const res = { statusCode: 200, cookies: [] };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    res.cookie = (n, v) => { res.cookies.push([n, v]); return res; };
    res.clearCookie = () => res;
    return Promise.resolve(fn({ query: {}, params: {}, body: {}, headers: {}, ip: "9.9.9.9", ...req }, res)).then(() => res);
  };

  console.log("\n🧪 管理員 TOTP 2FA\n");

  console.log("📋 1. TOTP 核心（RFC 6238）");
  const secret = totp.generateSecret();
  ok(/^[A-Z2-7]{32}$/.test(secret), "secret 係 32 字元 Base32");
  const code = totp.totp(secret);
  ok(/^\d{6}$/.test(code), "產生 6 位碼");
  ok(totp.verifyTotp(secret, code), "即時驗證通過");
  ok(!totp.verifyTotp(secret, "000000") || code === "000000", "錯誤碼不通過");
  ok(totp.verifyTotp(secret, totp.totp(secret, Date.now() - 31000)), "容許 -30 秒時鐘偏差");
  ok(!totp.verifyTotp(secret, totp.totp(secret, Date.now() - 5 * 60000)), "5 分鐘前嘅碼失效");
  ok(totp.otpauthUri(secret, "admin@zenpass.hk").startsWith("otpauth://totp/"), "otpauth URI 格式正確");
  const enc = totp.encryptSecret(secret);
  ok(enc.startsWith("v1:") && totp.decryptSecret(enc) === secret, "secret AES-GCM 加密／解密");
  ok(totp.decryptSecret("v1:bad") === null, "竄改格式 → 解密失敗");

  console.log("📋 2. 未啟用 2FA 時正常登入");
  const loginFn = pick(authRouter, "/login", "post");
  let r = await call(loginFn, { body: { email: "admin@zenpass.hk", password: "AdminPass123!" } });
  ok(r.statusCode === 200 && !!r.body.token && !r.body.require_2fa, "帳密登入直接取得 token");

  console.log("📋 3. 產生／啟用 2FA");
  const genFn = pick(tfRouter, "/admin/2fa/generate", "post");
  const enableFn = pick(tfRouter, "/admin/2fa/enable", "post");
  const statusFn = pick(tfRouter, "/admin/2fa/status", "get");
  const disableFn = pick(tfRouter, "/admin/2fa/disable", "post");
  const verifyFn = pick(tfRouter, "/auth/verify-2fa", "post");
  const asAdmin = { user: { id: "adm1", role: "super_admin" } };

  r = await call(statusFn, asAdmin);
  ok(r.body.enabled === false, "初始狀態未啟用");

  r = await call(genFn, asAdmin);
  ok(r.statusCode === 200 && r.body.secret && r.body.qr_data_url.startsWith("data:image/png;base64,"), "產生 secret + QR PNG");
  ok(/^otpauth:\/\/totp\//.test(r.body.otpauth_uri || ""), "回傳 otpauth URI");
  const newSecret = r.body.secret;
  const stored = db.prepare("SELECT totp_secret, totp_enabled FROM users WHERE id='adm1'").get();
  ok(!String(stored.totp_secret).includes(newSecret) && totp.decryptSecret(stored.totp_secret) === newSecret, "DB 只存加密 secret");

  r = await call(enableFn, { ...asAdmin, body: { code: "123456" } });
  ok(r.statusCode === 401 && r.body.code === "TOTP_INVALID", "錯誤碼唔可以啟用");

  r = await call(enableFn, { ...asAdmin, body: { code: totp.totp(newSecret) } });
  ok(r.statusCode === 200 && r.body.enabled === true, "正確碼 → 啟用成功");
  ok(Array.isArray(r.body.backup_codes) && r.body.backup_codes.length === 8, "回傳 8 組備援碼");
  const backupCodes = r.body.backup_codes.slice();

  r = await call(statusFn, asAdmin);
  ok(r.body.enabled === true && r.body.backup_codes_left === 8, "狀態：已啟用、備援碼 8 組");
  const storedCodes = JSON.parse(db.prepare("SELECT totp_backup_codes FROM users WHERE id='adm1'").get().totp_backup_codes);
  ok(!storedCodes.some((h) => backupCodes.includes(h)), "備援碼只存雜湊（非明文）");

  console.log("📋 4. 啟用後登入需要第二段");
  r = await call(loginFn, { body: { email: "admin@zenpass.hk", password: "AdminPass123!" } });
  ok(r.statusCode === 200 && r.body.require_2fa === true && !!r.body.temp_token, "回傳 require_2fa + temp_token");
  ok(!r.body.token, "未完成 2FA 唔會發正式 token");
  const tempToken = r.body.temp_token;

  // temp token 唔可以當正常憑證用
  const { authenticateToken } = require("../src/middleware/auth");
  const guardRes = { statusCode: 200 };
  guardRes.status = (c) => { guardRes.statusCode = c; return guardRes; };
  guardRes.json = (x) => { guardRes.body = x; return guardRes; };
  let guardNexted = false;
  authenticateToken({ headers: { authorization: "Bearer " + tempToken }, cookies: {}, ip: "9.9.9.9" }, guardRes, () => { guardNexted = true; });
  ok(!guardNexted && guardRes.statusCode === 401 && guardRes.body.code === "TOTP_REQUIRED", "temp_token 被拒（TOTP_REQUIRED）");

  r = await call(verifyFn, { body: { temp_token: tempToken, code: "111111" } });
  ok(r.statusCode === 401 && r.body.code === "TOTP_INVALID", "錯誤碼 → 401");

  const good1 = totp.totp(newSecret, Date.now() + 31000); // 下一格（避免與啟用時同一組碼）
  r = await call(verifyFn, { body: { temp_token: tempToken, code: good1 } });
  ok(r.statusCode === 200 && !!r.body.token && r.body.user && !r.body.user.password_hash, "正確碼 → 發正式 token");
  ok(r.cookies.some(([n]) => /token/i.test(n)), "同時設定 HTTP-only cookie");

  // 同一組碼重放
  r = await call(verifyFn, { body: { temp_token: tempToken, code: good1 } });
  ok(r.statusCode === 409 && r.body.code === "TOTP_REPLAY", "同一組碼重放被阻（TOTP_REPLAY）");

  console.log("📋 5. 備援碼（一次性）");
  const bk = backupCodes[0];
  r = await call(verifyFn, { body: { temp_token: tempToken, code: bk } });
  ok(r.statusCode === 200 && r.body.used_backup_code === true, "備援碼登入成功");
  r = await call(verifyFn, { body: { temp_token: tempToken, code: bk } });
  ok(r.statusCode === 401, "同一備援碼再用 → 失敗（已作廢）");
  const left = JSON.parse(db.prepare("SELECT totp_backup_codes FROM users WHERE id='adm1'").get().totp_backup_codes).length;
  ok(left === 7, "剩餘備援碼 7 組");

  console.log("📋 6. 停用（逃生）");
  r = await call(disableFn, { ...asAdmin, body: { code: "999999" } });
  ok(r.statusCode === 401, "錯碼唔可以停用");
  r = await call(disableFn, { ...asAdmin, body: { code: totp.totp(newSecret, Date.now() + 31000) } });
  ok(r.statusCode === 200 && r.body.enabled === false, "正確碼可停用（換機逃生）");
  const after = db.prepare("SELECT totp_secret, totp_enabled FROM users WHERE id='adm1'").get();
  ok(Number(after.totp_enabled) === 0 && !after.totp_secret, "停用後清除 secret");

  console.log("📋 7. 審計與前端");
  const audits = db.prepare("SELECT action_type FROM audit_log WHERE action_type LIKE 'security.totp%'").all().map((x) => x.action_type);
  ok(audits.includes("security.totp_enabled"), "啟用有審計");
  ok(audits.includes("security.totp_login"), "2FA 登入有審計");
  ok(audits.includes("security.totp_disabled"), "停用有審計");
  const loginHtml = fs.readFileSync(path.join(__dirname, "../../frontend-v2/login.html"), "utf8");
  ok(/verify-2fa|require_2fa/.test(loginHtml), "登入頁支援第二段驗證");
  const opsHtml = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/2fa\/generate/.test(opsHtml) && /2fa\/enable/.test(opsHtml), "後台有 2FA 綁定介面");

  console.log(`\n${fail === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} 通過 / ${fail} 失敗\n`);
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
