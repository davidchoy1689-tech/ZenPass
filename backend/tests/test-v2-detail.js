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
has('id="coachBio"', "coach bio");
has('id="coachTags"', "coach tags");
has('id="coachStats"', "coach stats");
has("教練資料待更新", "coach fallback（唔造假）");
has("coach_verified", "coach verified 動態顯示");

// 4 場地
has("場地資訊", "venue section");
has('id="mapBtn"', "map button");

// 5 評價
has("學員評價", "reviews section");
has("學員花絮", "gallery title");
has('id="revHead"', "review summary");
has("暫無評價", "no fake reviews（暫無評價）");
has("Array.isArray(reviews)", "reviews 只用真實資料");
has("WELCOME50", "review mentions promo");
has("dt-rev-card", "review card css class");
has('id="revs"', "reviews list");

// 6 FAQ
has("常見問題", "faq section");
if ((html.match(/<details class="dt-faq"/g) || []).length < 5) fails.push("expect >=5 FAQ items");
has("穿著什麼衣服", "faq clothing");
// 場地設施：2026-10-20 改為只用真實資料，唔可以再寫死賣點
if (/冷氣開放|提供儲物櫃|免費飲水機|全套比賽級器材/.test(html)) fails.push("facilities must not be hardcoded");
has('id="facilities"', "facility container");
has("c.facilities", "facility from API data");

// 7 預約流程 + sticky CTA
has("預約流程", "flow section");
has('class="dt-sticky"', "sticky cta");
has('id="bookBtn"', "book button");
has("立即報名留位", "bar cta");
has('id="sheet"', "sheet drawer");
has("function openSheet", "sheet open");
has("function renderSessions", "sessions render");
has("function renderDates", "dates render");
has('id="dateStrip"', "date strip");
has('id="sheetConfirm"', "confirm button");
has("前往結賬", "checkout label");
has("名額暫滿", "full slot label");
has("_next7", "7-day strip");
has('?q=', "q param support");
const exp = fs.readFileSync(path.join(root, "explore.html"), "utf8");
if (!exp.includes("detail.html?id=")) fails.push("explore cards should link to detail.html");
const idx2 = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!idx2.includes("/classes?limit=6&sort=popular")) fails.push("index hot rail should fetch real classes");
if (!idx2.includes("booking_open) === 1")) fails.push("index hot rail should only show bookable classes");
if (!idx2.includes("hotRail")) fails.push("index hotRail id");
const cd = fs.readFileSync(path.join(root, "class-detail.html"), "utf8");
if (!cd.includes('location.replace("detail.html"')) fails.push("class-detail should redirect to detail");
has("function goBook", "goBook");
has("已帶入 WELCOME50", "promo tip");
has('id="priceOld"', "original price");
has("position: fixed; left: 0; right: 0; bottom: 0", "sticky bottom");
has("0.5", "half price");
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
