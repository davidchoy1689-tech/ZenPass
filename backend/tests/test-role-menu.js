/**
 * 帳戶選單 × 角色權限一致性（2026-11-16）
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FE = path.join(__dirname, "..", "..", "frontend-v2");
const src = fs.readFileSync(path.join(FE, "assets", "roles.js"), "utf8");

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

function load(user) {
  const ctx = {
    window: {}, console,
    localStorage: { getItem: () => (user ? JSON.stringify(user) : null), setItem() {}, removeItem() {} },
    location: { pathname: "/my.html", search: "", replace() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {}, querySelector: () => null },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    URLSearchParams, Object, Promise, JSON, String, Number, Date, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.ZPRoles;
}

const R = load({ id: "u", role: "user" });

console.log("\n🧪 1. 每個角色都有選單定義");
for (const r of ["user", "coach", "org_admin", "org_member", "partner_owner", "partner_staff", "admin", "super_admin", "platform_manager", "auditor"]) {
  ok(R.MENU[r] !== undefined, r + " 有定義");
}

console.log("\n🧪 2. 教練：只留教練需要嘅入口");
const coach = R.menuFor("coach");
ok(coach.includes("教練中心"), "有教練中心");
ok(coach.includes("我的預約") && coach.includes("收件箱"), "有預約＋收件箱");
for (const badWord of ["企業", "積分", "增值", "證書", "家庭", "商戶", "健康諮詢", "推薦"]) {
  ok(!coach.some((k) => k.includes(badWord)), "冇 " + badWord);
}

console.log("\n🧪 3. 機構／場地／職員");
ok(R.menuFor("org_admin").includes("機構中心"), "機構管理員有機構中心");
ok(!R.menuFor("org_admin").some((k) => k.includes("積分")), "機構冇積分");
ok(R.menuFor("partner_owner").includes("商戶中心"), "場地有商戶中心");
ok(R.menuFor("partner_owner").some((k) => k.includes("場地")), "場地有場地入口");
ok(R.menuFor("admin").includes("管理後台"), "職員有管理後台");
ok(R.menuFor("auditor").includes("管理後台"), "核數有管理後台（唯讀）");
ok(!R.menuFor("admin").some((k) => k.includes("教練中心")), "職員選單冇教練中心（用後台進入）");

console.log("\n🧪 4. 學員不受限");
ok(R.menuFor("user") === null, "學員 = 全部功能（不裁剪）");

console.log("\n🧪 5. 前端使用單一來源");
const my = fs.readFileSync(path.join(FE, "my.html"), "utf8");
ok(my.includes("ZPRoles.menuFor"), "我的頁用 roles.js MENU");
ok(!my.includes("const COMMON = ["), "已移除重複定義");
ok(/roles\.js\?v=3/.test(my), "roles.js 已升 v=3");

console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
