/**
 * ZenPass — 上線開關（暫停公開註冊）tests — 2026-10-24
 */
const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "a".repeat(64);
const tmp = path.join(os.tmpdir(), "zenpass-launch-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

function handlerOf(router, method, p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) return null;
  const st = layer.route.stack;
  return st[st.length - 1].handle;
}
function call(handler, { body = {}, user = null, params = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      cookie() { return this; },
    };
    handler({ query: {}, body, params, user, headers: {}, ip: "127.0.0.1" }, res, () =>
      resolve({ status: 0, body: "next" }),
    );
  });
}

(async () => {
  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.exec(
    "CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active')",
  );
  db.prepare(
    "INSERT INTO users (id,name,email,role,created_at,updated_at) VALUES ('root','主要','root@zenpass.hk','super_admin',datetime('now'),datetime('now'))",
  ).run();
  db.prepare(
    "INSERT INTO users (id,name,email,role,created_at,updated_at) VALUES ('cs','客服','cs@zenpass.hk','admin',datetime('now'),datetime('now'))",
  ).run();

  const launch = require("../src/services/launch-mode");
  const auth = require("../src/routes/auth");
  const register = handlerOf(auth, "post", "/register");
  const admin = require("../src/routes/admin");
  const getMode = handlerOf(admin, "get", "/launch-mode");
  const postMode = handlerOf(admin, "post", "/launch-mode");

  console.log("🧪 上線開關 tests");
  console.log("── 預設暫停公開註冊 ──");
  const s0 = launch.getLaunchSettings();
  ok(s0.registration_open === false, "預設 registration_open = false");
  ok(/^ZP-/.test(s0.invite_code), "自動產生邀請碼");
  ok(s0.allow_domains.includes("zenpass.hk"), "白名單預設含 zenpass.hk");

  const r1 = await call(register, {
    body: { name: "路人", email: "stranger@gmail.com", password: "Abc12345" },
  });
  ok(r1.status === 403 && r1.body.code === "REGISTRATION_CLOSED", "陌生人註冊 → 403（已暫停）");

  const r2 = await call(register, {
    body: { name: "同事", email: "staff2@zenpass.hk", password: "Abc12345" },
  });
  ok(r2.status === 201, "白名單網域 → 可註冊");

  const r3 = await call(register, {
    body: { name: "朋友", email: "friend@gmail.com", password: "Abc12345", invite_code: s0.invite_code },
  });
  ok(r3.status === 201, "持邀請碼 → 可註冊");

  const r4 = await call(register, {
    body: { name: "亂碼", email: "bad@gmail.com", password: "Abc12345", invite_code: "ZP-WRONG" },
  });
  ok(r4.status === 403, "錯誤邀請碼 → 403");

  console.log("── 全面開放 ──");
  launch.set("launch.registration_open", "1");
  const r5 = await call(register, {
    body: { name: "學員", email: "student@gmail.com", password: "Abc12345" },
  });
  ok(r5.status === 201, "開放後任何電郵可註冊");

  console.log("── 後台開關權限 ──");
  // handler 本身唔做權限檢查（由 middleware 做）→ 驗證路由已掛權限
  const route = admin.stack.find(
    (l) => l.route && l.route.path === "/launch-mode" && l.route.methods.get,
  );
  ok(
    !!route && route.route.stack.length >= 3,
    "GET /launch-mode 已掛 authenticateToken + requirePermission",
  );
  // handler 本身唔做權限檢查（middleware 做），所以用 requirePermission 直接測
  const { requirePermission } = require("../src/middleware/auth");
  const mw = requirePermission("system.settings.write");
  let code = 0;
  mw(
    { user: { id: "cs", role: "admin" }, ip: "127.0.0.1", originalUrl: "/api/admin/launch-mode" },
    { status(c) { code = c; return this; }, json() { return this; } },
    () => { code = 0; },
  );
  ok(code === 403, "admin 改上線設定 → 403（要 super_admin）");
  code = 0;
  mw(
    { user: { id: "root", role: "super_admin" }, ip: "127.0.0.1", originalUrl: "/x" },
    { status(c) { code = c; return this; }, json() { return this; } },
    () => { code = 0; },
  );
  ok(code === 0, "super_admin 可改上線設定");

  const p1 = await call(postMode, {
    body: { registration_open: false, allow_domains: ["zenpass.hk", "@zenpass.test"], rotate_invite: true },
    user: { id: "root", role: "super_admin" },
  });
  ok(p1.status === 200 && p1.body.registration_open === false, "關閉註冊成功");
  ok(p1.body.allow_domains.includes("zenpass.test"), "@ 前綴會自動清理");
  ok(p1.body.invite_code !== s0.invite_code, "換碼後邀請碼已更新");

  if (fail) {
    console.error(`❌ ${fail} 項失敗`);
    process.exit(1);
  }
  console.log("✅ 上線開關 tests passed");
})();
