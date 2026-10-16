/**
 * Test: frontend-v2/assets/sport-icons.js — 精選 8 大主題配對（MEGA）
 * 用 vm 執行（script 非 module），驗證每個運動項目啱都配到啱嘅主題、無走漏。
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const file = path.join(__dirname, "../../frontend-v2/assets/sport-icons.js");
const code = fs.readFileSync(file, "utf8");

const sandbox = {
  document: { readyState: "loading", addEventListener: () => {}, getElementById: () => null, body: null },
  window: {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const cat = sandbox.SPORTS_CATALOGUE;
const megaOfSport = sandbox.megaOfSport;
const megaItems = sandbox.megaItems;
const MEGA = sandbox.MEGA;

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

// 每個項目都配到主題，且總數無走漏
let total = 0;
for (const m of MEGA) {
  const n = megaItems(m).length;
  if (n === 0) fails.push(`theme empty: ${m.k}`);
  total += n;
}
eq(total, cat.length, "sum of theme items === catalogue length");

// 8 大主題存在
eq(MEGA.length, 8, "8 themes");

const bySlug = {};
for (const s of cat) bySlug[s.slug] = s;

function themeOf(slug) {
  const s = bySlug[slug];
  if (!s) { fails.push("missing slug: " + slug); return null; }
  return megaOfSport(s).k;
}

// David 指定例子
eq(themeOf("moelkkyla"), "🔥 新興運動", "芬蘭木柱 → 新興運動");
eq(themeOf("floor-curling"), "🔥 新興運動", "地板冰壺 → 新興運動");
eq(themeOf("pickleball"), "🔥 新興運動", "匹克球 → 新興運動");
eq(themeOf("yoga"), "🧘 身心舒壓", "瑜伽 → 身心舒壓");
eq(themeOf("meditation"), "🧘 身心舒壓", "冥想 → 身心舒壓");
eq(themeOf("sound-bath"), "🧘 身心舒壓", "頌缽 → 身心舒壓");
eq(themeOf("hiit"), "💪 健身體能", "HIIT → 健身體能");
eq(themeOf("core-training"), "💪 健身體能", "核心訓練 → 健身體能");
eq(themeOf("boxing"), "💪 健身體能", "拳擊 → 健身體能");
eq(themeOf("basketball"), "🏀 團體球類", "籃球 → 團體球類");
eq(themeOf("badminton"), "🏀 團體球類", "羽毛球 → 團體球類");
eq(themeOf("football"), "🏀 團體球類", "足球 → 團體球類");
eq(themeOf("hiking"), "🏃 戶外歷奇", "遠足 → 戶外歷奇");
eq(themeOf("camping"), "🏃 戶外歷奇", "露營 → 戶外歷奇");
eq(themeOf("climbing"), "🏃 戶外歷奇", "攀岩 → 戶外歷奇");
eq(themeOf("kpop-dance"), "💃 舞蹈文化", "K-pop → 舞蹈文化");
eq(themeOf("jazz-dance"), "💃 舞蹈文化", "爵士舞 → 舞蹈文化");
eq(themeOf("chinese-dance"), "💃 舞蹈文化", "中國舞 → 舞蹈文化");
eq(themeOf("tai-chi"), "🌿 養生復康", "太極 → 養生復康");
eq(themeOf("foam-rolling"), "🌿 養生復康", "筋膜放鬆 → 養生復康");
eq(themeOf("qigong"), "🌿 養生復康", "八段錦/氣功 → 養生復康");
eq(themeOf("frisbee"), "🏆 趣味競技", "飛盤 → 趣味競技");
eq(themeOf("sport-stacking"), "🏆 趣味競技", "疊杯 → 趣味競技");
eq(themeOf("kendama"), "🏆 趣味競技", "劍球 → 趣味競技");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ v2 mega (8 大主題) tests passed — " + cat.length + " 項目分佈: " +
  MEGA.map((m) => m.k + "=" + megaItems(m).length).join(" | "));
