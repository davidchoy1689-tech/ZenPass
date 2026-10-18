/** ZenPass — referral/tiers 對齊真實等級 tests */
const fs = require("fs");
const path = require("path");

process.env.JWT_SECRET = "test_secret_1234567890_abcdefghijklmnop";

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

const router = require("../src/routes/referral");
const layer = router.stack.find((l) => l.route && l.route.path === "/tiers");
const handlers = layer.route.stack.map((s) => s.handle);
const handler = handlers[handlers.length - 1];

let captured = null;
handler({ user: { id: "u1" } }, { json: (x) => (captured = x), status: () => ({ json: (x) => (captured = x) }) });

console.log("🧪 referral/tiers tests");
ok(Array.isArray(captured && captured.tiers), "回傳 tiers 陣列");
ok(captured.tiers.length === 4, "4 個等級");
ok(captured.tiers.map((t) => t.id).join(",") === "bronze,silver,gold,vip", "等級 id 正確");
ok(captured.tiers[3].name.includes("鉑金"), "最高級 = 鉑金");
ok(captured.tiers[3].benefits.some((b) => b.includes("邀請朋友")), "鉑金有邀請朋友權益");

const all = JSON.stringify(captured.tiers);
ok(!/每月 \\d+ 堂免費/.test(all), "冇再寫未實作嘅『每月 X 堂免費』");
ok(!/私人教練諮詢/.test(all), "冇再寫私人教練諮詢");

const src = fs.readFileSync(path.join(__dirname, "../src/routes/referral.js"), "utf8");
ok(/require\("\.\.\/services\/loyalty"\)/.test(src), "用 services/loyalty 做單一來源");

const web = path.join(__dirname, "..", "..", "frontend-v2");
const my = fs.readFileSync(path.join(web, "my.html"), "utf8");
const points = fs.readFileSync(path.join(web, "points.html"), "utf8");
ok(/\/loyalty\/my/.test(my), "我的頁顯示會籍等級（/loyalty/my）");
ok(/bronze: "🥉 銅牌"/.test(my), "我的頁有等級 fallback 對照");
ok(/積分等級/.test(points) && /會籍等級/.test(points), "積分頁清楚標示兩套等級分別");

console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
process.exit(fail === 0 ? 0 : 1);
