/**
 * 出糧日曆：每月 7 號，週末提早至星期五
 */
const { nextPayoutForMonth, PAYOUT_DAY, RULE_TEXT } = require("../src/services/payout-calendar");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 出糧日（每月 7 號）");
ok("常數 = 7", PAYOUT_DAY === 7);
ok("規則文案寫 7 號", RULE_TEXT.includes("7 號"), RULE_TEXT);

const cases = [
  ["2026-11", "2026-12-07", "2026年12月07日（週一）", false],
  ["2026-10", "2026-11-06", "2026年11月06日（週五）", true],  // 11/7 週六 → 提早 11/06
  ["2026-12", "2027-01-07", "2027年01月07日（週四）", false],
  ["2027-01", "2027-02-05", "2027年02月05日（週五）", true],  // 2/7 週日 → 提早 2/05
];
for (const [month, date, label, shifted] of cases) {
  const p = nextPayoutForMonth(month);
  ok(`${month} → ${date}`, p.date === date, p.date);
  ok(`${month} 標籤完整`, p.label === label, p.label);
  ok(`${month} 提早標記`, p.shifted === shifted, String(p.shifted));
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
