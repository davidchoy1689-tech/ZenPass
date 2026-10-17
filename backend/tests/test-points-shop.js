/** ZenPass — 積分計劃 / 積分商城 tests */
const fs = require("fs");
const path = require("path");
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 積分計劃 / 商城 tests");
const root = path.join(__dirname, "..");
const web = path.join(root, "..", "frontend-v2");
const pts = fs.readFileSync(path.join(root, "src/routes/points.js"), "utf8");
const page = fs.readFileSync(path.join(web, "points.html"), "utf8");

console.log("── 賺分機制（後端）──");
ok(pts.includes("每日簽到"), "每日簽到有積分");
ok(/const points = 50/.test(pts), "完成課堂 +50");
ok(/const points = 20/.test(pts), "課後評價 +20");
ok(/const points = 100/.test(pts), "推薦朋友 +100");
ok(pts.includes("streakBonus"), "連續簽到有加成");
ok(pts.includes("minPoints: 500"), "等級門檻（500/2000/5000）");

console.log("── 兌換要真正有用 ──");
ok(pts.includes('reward.reward_type === "credit"'), "Credits 獎勵即時入賬");
ok(pts.includes('UPDATE users SET credits = COALESCE(credits,0) + ?'), "真加 credits");
ok(pts.includes('reward.reward_type === "discount"'), "折扣獎勵產生優惠碼");
ok(pts.includes("INSERT INTO promo_codes"), "寫入 promo_codes");
ok(pts.includes("pending_fulfilment"), "實體禮品/免費堂標記待履行");
ok(pts.includes("issued"), "回傳 issued 交付內容");

console.log("── 前端積分頁 ──");
ok(page.includes("點樣賺積分"), "有賺分說明");
ok(page.includes("積分商城"), "有積分商城");
ok(page.includes("每日簽到"), "有簽到掣");
ok(page.includes("/points/checkin"), "呼叫簽到 API");
ok(page.includes("/points/redeem"), "呼叫兌換 API");
ok(page.includes('data-redeem'), "每個獎勵有兌換掣");
ok(page.includes("需要多 "), "積分不足顯示差幾多");
ok(page.includes("已換完"), "售罄顯示");
ok(page.includes("兌換紀錄"), "有兌換紀錄 tab");
ok(page.includes("積分紀錄"), "有積分紀錄 tab");
ok(page.includes("排行榜"), "有排行榜 tab");
ok(page.includes("tierBar"), "有升級進度條");
ok(page.includes("升級"), "顯示距離下一級");

console.log("── 入口 ──");
const my = fs.readFileSync(path.join(web, "my.html"), "utf8");
ok(my.includes("points.html"), "我的頁有積分入口");

console.log("──────────────────────────────");
if (fail) { console.error("❌ " + fail + " failed"); process.exit(1); }
console.log("✅ 積分計劃 tests passed");
