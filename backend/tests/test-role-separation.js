/**
 * 角色分流：教練／場地／職員／學員／遊客
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FE = path.join(__dirname, "..", "..", "frontend-v2");
const read = (f) => fs.readFileSync(path.join(FE, f), "utf8");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. roles.js 角色地圖");
const src = read("assets/roles.js");
ok("角色分流檔存在", src.includes("ZPRoles"));
for (const [role, home] of [
  ["super_admin", "admin.html"],
  ["platform_manager", "admin.html"],
  ["admin", "admin.html"],
  ["auditor", "admin.html"],
  ["partner_owner", "venue-dashboard.html"],
  ["partner_staff", "venue-reception.html"],
  ["org_admin", "corporate-dashboard.html"],
  ["org_member", "my.html"],
  ["coach", "coach-hub.html"],
  ["user", "my.html"],
  ["guest", "index.html"],
]) {
  ok(`${role} → ${home}`, new RegExp(`${role}:\\s*"${home.replace("/", "\\/")}"`).test(src), "");
}

function loadWith(user) {
  const ctx = {
    window: {},
    console,
    localStorage: { getItem: () => (user ? JSON.stringify(user) : null) },
    sessionStorage: { clear() {} },
    location: { pathname: "/coach-hub.html", search: "", replace() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.ZPRoles;
}

console.log("\n🧪 2. 身份判斷");
ok("教練 → isCoach", loadWith({ id: "c1", role: "coach" }).isCoach() === true);
ok("學員 → 唔係教練", loadWith({ id: "u1", role: "user" }).isCoach() === false);
ok("場地負責人 → isVenue", loadWith({ id: "v1", role: "partner_owner" }).isVenue() === true);
ok("學員 → 唔係場地", loadWith({ id: "u1", role: "user" }).isVenue() === false);
ok("super_admin → isStaff", loadWith({ id: "a1", role: "super_admin" }).isStaff() === true);
ok("org_admin → isOrg", loadWith({ id: "o1", role: "org_admin" }).isOrg() === true);
ok("org_member → isOrg", loadWith({ id: "o2", role: "org_member" }).isOrg() === true);
ok("學員 → 唔係機構", loadWith({ id: "u1", role: "user" }).isOrg() === false);
ok("未登入 → guest", loadWith(null).role() === "guest");
ok("未登入 → 唔係 logged in", loadWith(null).isLoggedIn() === false);

console.log("\n🧪 3. 頁面守衛");
const coachPages = ["coach-hub", "coach-students", "coach-dashboard", "coach-console", "coach-earnings", "coach-schedule", "coach-attendance"];
for (const f of coachPages) ok(`${f} 有角色守衛`, /guardPage\("coach"\)/.test(read(f + ".html")), f);
const venuePages = ["venue-dashboard", "venue-reception"];
for (const f of venuePages) ok(`${f} 有場地守衛`, /guardPage\("venue"\)/.test(read(f + ".html")), f);
for (const f of ["admin", "admin-ops"]) ok(`${f} 有職員守衛`, /guardPage\("staff"\)/.test(read(f + ".html")), f);
ok("partner.html 公開（加盟頁唔守衛）", !read("partner.html").includes("roles.js"));
ok("corporate-dashboard 有機構守衛", /guardPage\("org"\)/.test(read("corporate-dashboard.html")));
ok("機構中心入口只在 org 角色出現", read("my.html").includes('id="orgLink"') && read("my.html").includes("ZPRoles.isOrg()"));

console.log("\n🧪 4. 登入／登出／示範");
ok("登入後按角色去首頁", read("login.html").includes("ZPRoles.homeFor"));
ok("登出清走教練示範身分", read("assets/api.js").includes('removeItem("zenpass_coach_id")'));
ok("coach-hub 唔再自動塞 demo 教練", !read("coach-hub.html").includes('"demo-coach"'));
ok("教練示範模式只限 ?demo=1", read("coach-dashboard.html").includes('get("demo")!=="1"'));
ok("我的頁用角色控制入口", read("my.html").includes("ZPRoles.isStaff()"));

console.log("\n🧪 5. 後端角色定義");
const authJs = fs.readFileSync(path.join(__dirname, "..", "src", "middleware", "auth.js"), "utf8");
const permJs = fs.readFileSync(path.join(__dirname, "..", "src", "config", "permissions.js"), "utf8");
ok("角色層級有 org_admin", /org_admin:\s*6/.test(authJs));
ok("角色層級有 org_member", /org_member:\s*9/.test(authJs));
ok("權限表有 org_admin", /org_admin:\s*\[/.test(permJs));
ok("org_admin 冇後台財務權限", /org_admin:\s*\["ops\.booking\.view"\]/.test(permJs));
ok("後台可指派機構角色", read("admin.html").includes('"org_admin"'));
ok("企業建立可指定 owner", fs.readFileSync(path.join(__dirname, "..", "src", "routes", "corporate.js"), "utf8").includes("owner_email"));

console.log("\n🧪 6. 快取版本");
ok("api.js 已升版（角色改動生效）", !fs.readdirSync(FE).filter((f) => f.endsWith(".html")).some((f) => read(f).includes("api.js?v=16")));

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
