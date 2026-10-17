/** ZenPass — 場地評分（代替保證金）＋ 真實文案 tests */
const path = require("path");
const fs = require("fs");
const root = path.join(__dirname, "..", "..", "frontend-v2");
const { scoreFrom } = require("../src/services/venue-rating");

let fail = 0;
function ok(cond, msg) {
  if (cond) console.log("  ✅ " + msg);
  else { console.log("  ❌ " + msg); fail++; }
}

console.log("🧪 場地評分 / 真實文案 tests");
console.log("── 評分公式 ──");
ok(scoreFrom({ completed: 0, failures: 0 }).score === 5, "新場地（無紀錄）= 5.0");
ok(scoreFrom({ completed: 10, failures: 0 }).score === 5, "全完成 = 5.0");
const one = scoreFrom({ completed: 9, failures: 1 });
ok(one.score === 4.4 && one.visibility === "normal", "1 次失誤 / 10 = 4.4（正常曝光）");
const two = scoreFrom({ completed: 8, failures: 2 });
ok(two.score === 3.8 && two.visibility === "normal", "2 次失誤 / 10 = 3.8（正常）");
const three = scoreFrom({ completed: 7, failures: 3 });
ok(three.score === 3.2 && three.visibility === "normal", "3 次失誤 / 10 = 3.2（正常，最後警告）");
const bad = scoreFrom({ completed: 5, failures: 5 });
ok(bad.score === 2 && bad.visibility === "hidden", "50% 失誤 = 2.0（停止曝光）");
const mid = scoreFrom({ completed: 2, failures: 2 });
ok(mid.score === 2.6 && mid.visibility === "deprioritised", "2.6 分 = 排到最後但唔隱藏");

console.log("── 前端真實文案 ──");
const detail = fs.readFileSync(path.join(root, "detail.html"), "utf8");
ok(!detail.includes("Sarah K."), "detail.html 冇假評價 Sarah K.");
ok(!detail.includes("Jason L.") && !detail.includes("Ming C."), "detail.html 冇假評價 Jason/Ming");
ok(!detail.includes("500+") && !detail.includes("5+ 年"), "detail.html 冇假教練年資/學員數");
ok(!detail.includes("32 則"), "detail.html 冇假 32 則評價");
ok(detail.includes("暫無評價"), "冇評價時顯示「暫無評價」");
ok(detail.includes("已約滿"), "未開放課程顯示「已約滿」");
ok(!/minutes:\s*\d+,\s*desc:/.test(detail) || detail.includes("Array.isArray(c.highlights)"),
  "課程流程只用真實 highlights");

const explore = fs.readFileSync(path.join(root, "explore.html"), "utf8");
ok(explore.includes("已約滿"), "explore 未開放卡片顯示「已約滿」");
ok(!explore.includes("敬請期待"), "explore 移除「敬請期待」");

const merchant = fs.readFileSync(path.join(root, "merchant-centre.html"), "utf8");
ok(merchant.includes("場地評分"), "商戶中心顯示場地評分");
ok(merchant.includes("曝光"), "商戶中心顯示曝光影響說明");

console.log("──────────────────────────────");
if (fail) { console.log(`❌ ${fail} failed`); process.exit(1); }
console.log("✅ 場地評分 / 真實文案 tests passed");
