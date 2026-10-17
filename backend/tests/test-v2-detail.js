/**
 * Test: detail.html 高轉換課堂詳情頁（7 區塊 + RWD + 真實資料）
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const html = fs.readFileSync(path.join(root, "detail.html"), "utf8");

const fails = [];
const has = (m, l) => { if (!html.includes(m)) fails.push("missing " + (l || "") + ": " + m); };

// 1 Hero：輪播 / 標籤 / 標題 / 評分 / 參數
has('id="carousel"', "carousel");
has('id="tags"', "tags");
has('class="dt-title"', "title");
has('id="rating"', "rating");
has('id="venue"', "venue");
has('id="duration"', "duration");
has('id="capacity"', "capacity");
has("在地圖查看", "map link");

// 2 你會學到
has("課堂內容", "highlights section");
has('id="timeline"', "timeline");
has('id="audience"', "audience");
has("適合對象", "audience label");
has("分鐘</span>", "duration badge");

// 3 教練
has("🧑‍🏫 教練", "coach section");
has('id="coachName"', "coach name");

// 4 場地
has("場地資訊", "venue section");
has('id="mapBtn"', "map button");

// 5 評價
has("學員評價", "reviews section");
has('id="revs"', "reviews list");

// 6 FAQ
has("常見問題", "faq section");
if ((html.match(/<details class="dt-faq">/g) || []).length < 4) fails.push("expect >=4 FAQ items");

// 7 預約流程 + sticky CTA
has("預約流程", "flow section");
has('class="dt-sticky"', "sticky cta");
has('id="bookBtn"', "book button");
has("booking.html?id=", "book link");

// Mobile-first / RWD
has('name="viewport"', "viewport");
has("@media (min-width: 720px)", "desktop breakpoint");
has("scroll-snap-type: x mandatory", "carousel snap");
has("env(safe-area-inset-bottom)", "safe area");

// 真實資料優先 + demo fallback
has('api.get("/classes/" + encodeURIComponent(id))', "fetch class");
has("renderDemo", "demo fallback");
has("avg_rating", "real rating");
has("max_participants", "real capacity");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ detail.html tests passed");
