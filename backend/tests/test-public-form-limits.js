/** ZenPass — 公開表單限流 tests */
const fs = require("fs");
const path = require("path");

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 公開表單限流 tests");

const root = path.join(__dirname, "../src");
const { publicFormLimiter } = require(path.join(root, "middleware/public-form-limit"));
ok(typeof publicFormLimiter === "function", "limiter factory 存在");
const mw = publicFormLimiter({ max: 2, windowMs: 60000 });
ok(typeof mw === "function", "可建立 middleware");

const checks = [
  ["routes/school.js", 'router.post("/inquiry", formLimiter'],
  ["routes/corporate.js", 'router.post("/inquiry", formLimiter'],
  ["routes/partner.js", 'router.post("/apply", formLimiter'],
  ["routes/waitlist.js", 'router.post("/app", formLimiter'],
  ["routes/marketing.js", 'router.post("/subscribe", formLimiter'],
  ["routes/recommendations.js", 'router.post("/pageview", pageviewLimiter'],
];
for (const [f, needle] of checks) {
  const s = fs.readFileSync(path.join(root, f), "utf8");
  ok(s.includes(needle) && s.includes("publicFormLimiter"), `${f} 已套用限流`);
}

console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
process.exit(fail === 0 ? 0 : 1);
