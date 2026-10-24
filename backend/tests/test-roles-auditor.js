/**
 * ZenPass — auditor（核數／會計）唯讀角色 tests — 2026-10-24
 * 要求：可以睇帳目／對帳／匯出，但零金錢操作、零權限管理。
 */
process.env.JWT_SECRET = "***".repeat(64);
const tmp = require("path").join(require("os").tmpdir(), "zenpass-auditor-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else { console.log("  ❌ " + m); fail++; }
};

(async () => {
  await require("../src/config/init-db")();
  const { ROLE_PERMISSIONS, PERMISSIONS } = require("../src/config/permissions");
  const { ROLE_HIERARCHY, hasMinimumRole, requirePermission } = require("../src/middleware/auth");

  console.log("🧪 auditor 角色 tests");

  const perms = ROLE_PERMISSIONS.auditor || [];
  ok(perms.length >= 8, `auditor 有 ${perms.length} 個唯讀權限`);
  ok(perms.includes("finance.payout.view"), "可以睇出糧紀錄");
  ok(perms.includes("finance.refund.view"), "可以睇退款");
  ok(perms.includes("system.audit.view"), "可以睇審計");
  ok(perms.includes("system.db.view"), "可以用資料庫唯讀頁");

  const writePerms = perms.filter((p) => /\.(write|process|confirm|reject|complete|merge)$/.test(p));
  ok(writePerms.length === 0, `冇任何寫入權限（發現：${writePerms.join(",") || "無"}）`);
  ok(!perms.includes("users.role.write"), "唔可以改角色");
  ok(!perms.includes("finance.pricing.write"), "唔可以改價");
  ok(!perms.includes("finance.penalty.write"), "唔可以改罰則");

  ok(ROLE_HIERARCHY.auditor > ROLE_HIERARCHY.admin, "層級低過 admin（唔會當成 admin）");
  ok(hasMinimumRole("auditor", "admin") === false, "hasMinimumRole(auditor, admin) = false");
  ok(hasMinimumRole("auditor", "partner_owner") === false, "亦唔會當成商戶負責人");

  // middleware 實測
  const run = (perm) =>
    new Promise((resolve) => {
      const mw = requirePermission(perm);
      let code = 0;
      mw(
        { user: { id: "a1", role: "auditor" }, ip: "127.0.0.1", originalUrl: "/x" },
        { status(c) { code = c; return this; }, json() { return this; } },
        () => { code = 0; },
      );
      resolve(code);
    });

  ok((await run("finance.payout.view")) === 0, "讀出糧 → 通過");
  ok((await run("system.db.view")) === 0, "讀資料庫 → 通過");
  ok((await run("finance.payout.process")) === 403, "出糧 → 403");
  ok((await run("finance.pricing.write")) === 403, "改價 → 403");
  ok((await run("users.role.write")) === 403, "改角色 → 403");
  ok((await run("ops.booking.write")) === 403, "改預約 → 403");

  // 每個角色權限都必須存在於 PERMISSIONS 定義
  let bad = [];
  for (const [role, list] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of list) if (!PERMISSIONS[p]) bad.push(role + ":" + p);
  }
  ok(bad.length === 0, `所有角色權限都有定義（問題：${bad.join(",") || "無"}）`);

  if (fail) { console.error(`❌ ${fail} 項失敗`); process.exit(1); }
  console.log("✅ auditor 角色 tests passed");
})();
