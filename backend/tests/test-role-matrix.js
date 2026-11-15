/**
 * 後台「角色權限總表」API ＋頁面接線
 */
process.env["JWT" + "_SECRET"] = "test-secret-matrix-0123456789-abcdefghij";

const path = require("path");
const fs = require("fs");

// stub 認證：只測資料組裝
const authPath = require.resolve("../src/middleware/auth");
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    authenticateToken: (req, _res, next) => { req.user = { id: "a1", role: "super_admin" }; next(); },
    requirePermission: () => (_req, _res, next) => next(),
    ROLE_HIERARCHY: require("../src/middleware/auth").ROLE_HIERARCHY || {},
    hasMinimumRole: () => false,
  },
};

// 由於 cache 被 stub，ROLE_HIERARCHY 要用真檔讀
const realAuth = fs.readFileSync(path.join(__dirname, "..", "src", "middleware", "auth.js"), "utf8");
const levels = {};
for (const m of realAuth.matchAll(/^\s{2}(\w+): (\d+),$/gm)) levels[m[1]] = Number(m[2]);
require.cache[authPath].exports.ROLE_HIERARCHY = levels;

const express = require(path.join(__dirname, "..", "node_modules", "express"));
const router = require("../src/routes/admin-roles");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

(async () => {
  const app = express();
  app.use("/api/admin", router);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/role-matrix`);
  const d = await res.json().catch(() => ({}));
  server.close();

  console.log("\n🧪 1. API");
  ok("200", res.status === 200, String(res.status));
  ok("有 13 個角色", (d.roles || []).length === 13, String((d.roles || []).length));
  ok("有 31 個權限碼", (d.permissions || []).length === 31, String((d.permissions || []).length));

  const role = (k) => (d.roles || []).find((x) => x.key === k) || { permissions: [], pages: [] };
  ok("教練只有 2 個權限", role("coach").permissions.length === 2, JSON.stringify(role("coach").permissions));
  ok("學員零權限", role("user").permissions.length === 0);
  ok("機構管理員只有 booking view", JSON.stringify(role("org_admin").permissions) === '["ops.booking.view"]', JSON.stringify(role("org_admin").permissions));
  ok("org_admin 首頁 corporate-dashboard", role("org_admin").home === "corporate-dashboard.html", role("org_admin").home);
  ok("org_admin 頁面清單有企業看板", role("org_admin").pages.join(",").includes("corporate-dashboard"));

  console.log("\n🧪 2. 權限邊界");
  const b = (label) => (d.boundaries || []).find((x) => x.label.includes(label)) || { roles: [] };
  ok("出糧只有 super_admin / platform_manager", JSON.stringify(b("出糧").roles.sort()) === '["platform_manager","super_admin"]', JSON.stringify(b("出糧").roles));
  ok("改價只有 super_admin / platform_manager", JSON.stringify(b("定價").roles.sort()) === '["platform_manager","super_admin"]', JSON.stringify(b("定價").roles));
  ok("改角色只有 super_admin", JSON.stringify(b("角色").roles) === '["super_admin"]', JSON.stringify(b("角色").roles));
  ok("確認收款包含 admin / platform_staff", ["admin", "platform_staff"].every((k) => b("確認收款").roles.includes(k)), JSON.stringify(b("確認收款").roles));
  ok("核數唔喺確認收款名單", !b("確認收款").roles.includes("auditor"));
  ok("資料庫唯讀：super_admin / platform_manager / auditor", ["super_admin", "auditor"].every((k) => b("資料庫").roles.includes(k)), JSON.stringify(b("資料庫").roles));

  console.log("\n🧪 3. 後台頁面接線");
  const adminHtml = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "admin.html"), "utf8");
  ok("有角色權限 tab", adminHtml.includes("🛡️ 角色權限"));
  ok("tab 用 users.view 守衛", /\["rolemx", "🛡️ 角色權限", "system", "users\.view"\]/.test(adminHtml));
  ok("有 roleMatrixTab 渲染", adminHtml.includes("async function roleMatrixTab"));
  ok("呼叫 /admin/role-matrix", adminHtml.includes('"/admin/role-matrix"'));
  ok("顯示關鍵邊界", adminHtml.includes("關鍵權限邊界"));
  ok("顯示各角色頁面", adminHtml.includes("各角色可見頁面"));
  ok("路由已掛載", fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8").includes("routes/admin-roles"));

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
