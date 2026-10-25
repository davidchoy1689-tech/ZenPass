/** ZenPass — 教練自助開班 + 下架 demo 課程 tests */
const fs = require("fs");
const path = require("path");

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

console.log("🧪 教練自助開班 / 下架 demo tests");

const root = path.join(__dirname, "..");
const coach = fs.readFileSync(path.join(root, "src/routes/coach.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "src/routes/admin.js"), "utf8");
const web = path.join(root, "..", "frontend-v2");
const page = fs.readFileSync(path.join(web, "coach.html"), "utf8");

console.log("── 教練自助開班 API ──");
ok(coach.includes('router.post("/classes"'), "POST /api/coach/classes 存在");
ok(/if \(!me\.is_coach\)/.test(coach), "只限已批核教練");
// 2026-10-25：教練自建班別改為待平台開通（booking_open = 0），防止價格／場地未核實就收單
ok(/status, booking_open, vip_priority_hours, min_participants/.test(coach), "新班預設 booking_open = 0（待平台開通）");
ok(coach.includes("'active', 0,"), "INSERT 時 booking_open 傳 0");
ok(coach.includes("min_participants"), "支援最低成團人數");
ok(coach.includes("partner_venue_id"), "支援指定合作場地");
ok(coach.includes("請選擇場地或填寫場地名稱"), "可以自行輸入場地");
ok(coach.includes("92"), "只可開未來 3 個月（92 日）");
ok(coach.includes("唔可以開過去嘅時段"), "阻止開過去時段");
ok(coach.includes("完結時間必須遲過開始時間"), "驗證 end > start");
ok(coach.includes("一次最多 60 個時段"), "有時段數量上限");
ok(coach.includes("sport_slug"), "支援 sports 項目 slug（自動配圖）");
ok(coach.includes("resolveDistrict"), "自動分區（18 區）");

console.log("── 下架 demo 課程 ──");
ok(admin.includes('router.post("/close-demo-classes"'), "POST /api/admin/close-demo-classes 存在");
ok(admin.includes("CLOSE_DEMO_CLASSES"), "需要 confirm 字串");
ok(/booking_open,0\) = 0/.test(admin) || /COALESCE\(booking_open,0\) = 0/.test(admin), "只下架未開放預約嘅課程");
ok(admin.includes("status = 'inactive'"), "用 inactive（唔刪 row，可追溯）");
ok(admin.includes("writeBlock"), "寫入區塊鏈 audit");

console.log("── 前端 ──");
ok(page.includes("開新班"), "教練頁有「開新班」");
ok(page.includes('api.post("/coach/classes"'), "提交到 /coach/classes");
ok(page.includes("ncSlots") && page.includes("加多個時段"), "支援多個時段");
ok(page.includes("ncVenueManual"), "可選現有場地或自行輸入");
ok(page.includes("loadClasses"), "開班後即時刷新課程列表");
ok(page.includes("detail.html?id="), "課程連結去新版詳情頁");

console.log("──────────────────────────────");
if (fail) {
  console.error("❌ " + fail + " failed");
  process.exit(1);
}
console.log("✅ 教練自助開班 tests passed");

// 追加：單筆預約 API 需兼容 camelCase（前端用 camelCase，validator 用 snake_case）
const bookingsSrc = fs.readFileSync(path.join(__dirname, "..", "src/routes/bookings.js"), "utf8");
if (!bookingsSrc.includes("req.body.scheduleId || req.body.schedule_id")) {
  console.error("  ❌ 單筆預約 API 未兼容 camelCase");
  process.exit(1);
}
console.log("  ✅ 單筆預約 API 兼容 camelCase / snake_case");
