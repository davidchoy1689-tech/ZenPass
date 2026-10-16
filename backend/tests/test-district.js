/**
 * Test: 香港 18 區解析（按課程地區自動分區）
 */
const { DISTRICTS, resolveDistrict, zoneName } = require("../src/services/district.js");

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

// 18 區齊全
eq(DISTRICTS.length, 18, "18 districts");
eq(new Set(DISTRICTS.map((d) => d.code)).size, 18, "unique codes");
eq(new Set(DISTRICTS.map((d) => d.name)).size, 18, "unique names");
[
  "中西區", "灣仔", "東區", "南區", "油尖旺", "深水埗", "九龍城", "黃大仙", "觀塘",
  "葵青", "荃灣", "屯門", "元朗", "北區", "大埔", "沙田", "西貢", "離島",
].forEach((n) => {
  if (!DISTRICTS.some((d) => d.name === n)) fails.push("missing district " + n);
});

// 地址解析
eq(resolveDistrict("香港中環皇后大道中 1 號"), "中西區", "中環 → 中西區");
eq(resolveDistrict("九龍旺角彌敦道 700 號"), "油尖旺", "旺角 → 油尖旺");
eq(resolveDistrict("新界沙田源禾路 12 號"), "沙田", "沙田 → 沙田");
eq(resolveDistrict("將軍澳寶琳"), "西貢", "將軍澳 → 西貢");
eq(resolveDistrict("東涌達東路"), "離島", "東涌 → 離島");
eq(resolveDistrict("荃灣青山公路"), "荃灣", "荃灣 → 荃灣");
eq(resolveDistrict("屯門"), "屯門", "屯門 → 屯門");
eq(resolveDistrict("銅鑼灣"), "灣仔", "銅鑼灣 → 灣仔");
eq(resolveDistrict("觀塘apm"), "觀塘", "觀塘 → 觀塘");
eq(resolveDistrict("北角"), "東區", "北角 → 東區");
eq(resolveDistrict("香港仔"), "南區", "香港仔 → 南區");
eq(resolveDistrict(""), "", "empty → empty");
eq(resolveDistrict("火星"), "", "unknown → empty");

// zoneName
eq(zoneName("kt"), "觀塘", "zoneName kt");
eq(zoneName("islands"), "離島", "zoneName islands");
eq(zoneName("zzz"), "", "zoneName unknown");

// 每個 district code → name 對應 zone param 一致
const codes = DISTRICTS.map((d) => d.code);
["cw","wc","east","south","ytm","ssp","kc","wts","kt","kts","tw","tm","yl","north","tp","st","sk","islands"]
  .forEach((c) => { if (!codes.includes(c)) fails.push("missing code " + c); });

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ 18 區解析 tests passed");
