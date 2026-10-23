/**
 * ZenPass — 後台帳號管理 tests（2026-10-24）
 * 主要管理員可以建立／重設密碼／停用／刪除帳號，並可「預覽身份」試用所有功能。
 * 安全要求：
 *  - 只有 users.role.write 可操作
 *  - 唔可以刪／停用自己或更高權限帳號
 *  - 有金錢／審計紀錄 → 只可停用，唔可以硬刪
 *  - 預覽身份 token 唔可以做財務／權限操作
 */
const os = require("os");
const path = require("path");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test_staff_admin_secret_key_1234567890_abcdef";
const tmp = path.join(os.tmpdir(), "zenpass-staff-" + Date.now() + ".db");
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
function call(handler, { query = {}, body = {}, user = null, params = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
    };
    handler({ query, body, params, user, headers: {}, ip: "127.0.0.1" }, res, () =>
      resolve({ status: 0, body: "next" }),
    );
  });
}

(async () => {
  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  // users.partner_id 有 FK 指向 partner_venues（舊測試 DB 需自行建立）
  db.exec(
    "CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active')",
  );
  db.prepare(
    "INSERT INTO users (id,name,email,role,is_active,created_at,updated_at) VALUES ('root','主要管理員','root@zenpass.hk','super_admin',1,datetime('now'),datetime('now'))",
  ).run();
  db.prepare(
    "INSERT INTO users (id,name,email,role,is_active,created_at,updated_at) VALUES ('cs','客服','cs@zenpass.hk','admin',1,datetime('now'),datetime('now'))",
  ).run();
  db.prepare(
    "INSERT INTO users (id,name,email,role,created_at,updated_at) VALUES ('stu','學生','stu@x.com','user',datetime('now'),datetime('now'))",
  ).run();

  const router = require("../src/routes/admin");
  const create = handlerOf(router, "post", "/staff");
  const list = handlerOf(router, "get", "/staff");
  const pwd = handlerOf(router, "post", "/staff/:id/password");
  const status = handlerOf(router, "post", "/staff/:id/status");
  const del = handlerOf(router, "delete", "/staff/:id");
  const imp = handlerOf(router, "post", "/impersonate/:userId");

  console.log("🧪 後台帳號管理 tests");
  console.log("── 建立 ──");
  ok(!!create && !!list && !!pwd && !!status && !!del && !!imp, "handlers 齊全");

  const c1 = await call(create, {
    body: { name: "新客服", email: "new-cs@zenpass.hk", role: "platform_staff" },
    user: { id: "root", role: "super_admin" },
  });
  ok(c1.status === 201 && !!c1.body.temp_password, "建立帳號 → 201 + 臨時密碼");
  ok(
    (db.prepare("SELECT password_hash FROM users WHERE email='new-cs@zenpass.hk'").get().password_hash || "").startsWith("$2"),
    "密碼以 bcrypt 儲存（非明文）",
  );

  const c2 = await call(create, {
    body: { name: "重複", email: "new-cs@zenpass.hk", role: "platform_staff" },
    user: { id: "root", role: "super_admin" },
  });
  ok(c2.status === 409, "重複電郵 → 409");

  const c3 = await call(create, {
    body: { name: "普通", email: "plain@x.com", role: "user" },
    user: { id: "root", role: "super_admin" },
  });
  ok(c3.status === 400, "唔可以建立 user／guest 角色 → 400");

  const c4 = await call(create, {
    body: { name: "主管", email: "mgr-x@zenpass.hk", role: "platform_manager" },
    user: { id: "cs", role: "admin" },
  });
  ok(c4.status === 403, "客服 admin 建立主管 → 403（權限/層級）");

  console.log("── 停用 / 啟用 ──");
  const newId = c1.body.staff.id;
  const before = db.prepare("SELECT token_version FROM users WHERE id=?").get(newId).token_version || 0;
  const s1 = await call(status, {
    body: { active: false },
    params: { id: newId },
    user: { id: "root", role: "super_admin" },
  });
  ok(s1.status === 200, "停用成功");
  const after = db.prepare("SELECT is_active, token_version FROM users WHERE id=?").get(newId);
  ok(Number(after.is_active) === 0, "is_active = 0");
  ok(Number(after.token_version) === Number(before) + 1, "token_version +1（即刻踢走 session）");

  const s2 = await call(status, {
    body: { active: false },
    params: { id: "root" },
    user: { id: "root", role: "super_admin" },
  });
  ok(s2.status === 400, "唔可以停用自己");

  console.log("── 重設密碼 ──");
  const p1 = await call(pwd, { params: { id: newId }, user: { id: "root", role: "super_admin" } });
  ok(p1.status === 200 && !!p1.body.temp_password, "重設密碼 → 回傳新臨時密碼");
  ok(p1.body.temp_password.length >= 12, "臨時密碼長度 ≥ 12");

  console.log("── 刪除（審計保護）──");
  db.prepare(
    "INSERT INTO audit_log (action_type, entity_type, entity_id, user_id, description) VALUES ('TEST','user','cs','cs','測試紀錄')",
  ).run();
  const d1 = await call(del, { params: { id: "cs" }, user: { id: "root", role: "super_admin" } });
  ok(d1.status === 409 && d1.body.code === "HAS_RECORDS", "有預約紀錄 → 拒絕刪除（保留審計鏈）");

  const d2 = await call(del, { params: { id: "stu" }, user: { id: "root", role: "super_admin" } });
  ok(d2.status === 200, "無紀錄帳號 → 可刪除");
  ok(!db.prepare("SELECT id FROM users WHERE id='stu'").get(), "DB 已移除");

  console.log("── 預覽身份 ──");
  db.prepare(
    "INSERT INTO users (id,name,email,role,created_at,updated_at) VALUES ('stu2','試用學生','stu2@x.com','user',datetime('now'),datetime('now'))",
  ).run();
  const i1 = await call(imp, { params: { userId: "stu2" }, user: { id: "root", role: "super_admin" } });
  ok(i1.status === 200 && !!i1.body.token, "簽發預覽 token");
  const decoded = jwt.verify(i1.body.token, process.env.JWT_SECRET);
  ok(decoded.imp === "root" && decoded.id === "stu2", "token 帶 imp=管理員、id=目標用戶");
  ok(i1.body.expires_in === 1800, "有效期 30 分鐘");

  const i2 = await call(imp, { params: { userId: "cs" }, user: { id: "root", role: "super_admin" } });
  ok(i2.status === 403, "唔可以預覽管理員身份 → 403");

  console.log("── 預覽模式唯讀 ──");
  const { requirePermission } = require("../src/middleware/auth");
  const mw = requirePermission("finance.payout.process");
  let code = 0;
  mw(
    { user: { id: "stu2", role: "user", imp: "root" }, ip: "127.0.0.1", originalUrl: "/x" },
    { status(c) { code = c; return this; }, json() { return this; } },
    () => { code = 0; },
  );
  ok(code === 403, "預覽模式下出糧 → 403（IMPERSONATION_READONLY）");

  if (fail) {
    console.error(`❌ ${fail} 項失敗`);
    process.exit(1);
  }
  console.log("✅ 後台帳號管理 tests passed");
})();
