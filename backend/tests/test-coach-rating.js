/** ZenPass — 教練評分（階段 1）tests */
const fs = require("fs");
const path = require("path");
const { smoothing, bandOf, PRIOR, WEIGHT } = require("../src/services/coach-rating");

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

console.log("🧪 教練評分（階段 1）tests");
console.log("── 貝氏平滑 ──");
ok(PRIOR === 4.5 && WEIGHT === 10, "先驗 4.5 / 權重 10");
ok(smoothing(0, 0).score === 4.5, "無評價 → 4.5（中性，不會顯示 0 分）");
ok(smoothing(1, 1).score === 4.2, "1 個 1 星 → 4.2（唔會被一個負評毀掉）");
ok(smoothing(1, 5).score === 4.5, "1 個 5 星 → 4.5");
ok(smoothing(10, 40).score === 4.3, "10 個平均 4.0 → 4.3");
ok(smoothing(10, 50).score === 4.8, "10 個全 5 星 → 4.8");
const big = smoothing(100, 400);
ok(big.score === 4.0, "100 個平均 4.0 → 4.0（樣本多趨向真實）");
ok(smoothing(1, 1).raw_avg === 1, "raw_avg 保留真實平均");

console.log("── 等級 ──");
ok(bandOf(4.6) === "excellent", "4.6 → excellent");
ok(bandOf(4.1) === "good", "4.1 → good");
ok(bandOf(3.6) === "fair", "3.6 → fair");
ok(bandOf(3.0) === "needs_improvement", "3.0 → needs_improvement");

console.log("── API / 前端 ──");
const root = path.join(__dirname, "..");
const coach = fs.readFileSync(path.join(root, "src/routes/coach.js"), "utf8");
ok(coach.includes('router.get("/my-rating"'), "GET /api/coach/my-rating 存在");
ok(coach.includes("computeCoachRating"), "用 service 計分");
ok(coach.includes("累積 10 個真實評價後"), "少於 10 個評價提示未公開");

const admin = fs.readFileSync(path.join(root, "src/routes/admin.js"), "utf8");
ok(admin.includes('router.get("/coach-ratings"'), "admin 內部總覽端點存在");

const ratings = fs.readFileSync(path.join(root, "src/routes/ratings.js"), "utf8");
ok(ratings.includes('booking.status !== "attended"'), "只限已出席課堂可評分");
ok(ratings.includes("每張預約一次") || ratings.includes("booking_id = ? AND user_id = ?"), "每張預約只可評一次");

const web = path.join(root, "..", "frontend-v2");
const my = fs.readFileSync(path.join(web, "my-bookings.html"), "utf8");
ok(my.includes("openRateCoach"), "我的預約有『⭐ 評教練』");
ok(my.includes('api.post("/ratings"'), "提交到 /api/ratings");
ok(my.includes("coach_id: b.coach_id"), "提交帶 coach_id");

const coachPage = fs.readFileSync(path.join(web, "coach.html"), "utf8");
ok(coachPage.includes("loadMyRating"), "教練頁載入評分");
ok(coachPage.includes("/coach/my-rating"), "教練頁打 /coach/my-rating");
ok(coachPage.includes("只你自己睇"), "明確標示只教練自己睇");

console.log("──────────────────────────────");
if (fail) {
  console.error("❌ " + fail + " failed");
  process.exit(1);
}
console.log("✅ 教練評分（階段 1）tests passed");
