/**
 * ZenPass — 極端天氣安排（參考康文署）tests
 * node backend/tests/test-weather-policy.js
 */
process.env.JWT_SECRET = "test-s…cdef";
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

const { WEATHER_POLICY, evaluateWeather, toMinutes } = require("../src/config/weather-policy");

console.log("\n🧪 極端天氣安排（康文署藍本）\n");

console.log("📋 1. 政策內容");
ok(/康樂及文化事務署/.test(WEATHER_POLICY.source), "政策來源標明參考康文署");
ok(WEATHER_POLICY.cutoffs.day === "10:00" && WEATHER_POLICY.cutoffs.evening === "15:00", "分界時間 10:00 / 15:00");
ok(WEATHER_POLICY.rules.length === 4, "4 條判斷規則");
ok(/10:00 前/.test(WEATHER_POLICY.rules[1].text) && /12:00/.test(WEATHER_POLICY.rules[1].text), "上午除下 → 12:00 後照常");
ok(/15:00 前/.test(WEATHER_POLICY.rules[2].text) && /18:00/.test(WEATHER_POLICY.rules[2].text), "下午 15:00 前除下 → 18:00 後照常");
ok(/全額退款/.test(WEATHER_POLICY.compensation) && /改期/.test(WEATHER_POLICY.compensation), "補償：全額退款或改期");

console.log("\n📋 2. 判斷邏輯");
const c1 = evaluateWeather({ warningActive: true, classStart: "19:00" });
ok(c1.cancel === true && c1.code === "signal_active", "警告生效中 → 取消");
const c2 = evaluateWeather({ warningActive: false, liftedAt: "09:30", classStart: "14:00" });
ok(c2.cancel === false && c2.code === "lifted_before_day", "10:00 前除下、14:00 課堂 → 照常");
const c3 = evaluateWeather({ warningActive: false, liftedAt: "09:30", classStart: "11:30" });
ok(c3.cancel === true && c3.code === "before_day_resume", "10:00 前除下、11:30 課堂 → 取消（未及 12:00）");
const c4 = evaluateWeather({ warningActive: false, liftedAt: "14:00", classStart: "19:00" });
ok(c4.cancel === false && c4.code === "lifted_before_evening", "15:00 前除下、19:00 課堂 → 照常");
const c5 = evaluateWeather({ warningActive: false, liftedAt: "14:00", classStart: "17:00" });
ok(c5.cancel === true && c5.code === "before_evening_resume", "15:00 前除下、17:00 課堂 → 取消（未及 18:00）");
const c6 = evaluateWeather({ warningActive: false, liftedAt: "16:00", classStart: "19:00" });
ok(c6.cancel === true && c6.code === "lifted_after_evening", "15:00 後除下 → 當日餘下全取消");
const c7 = evaluateWeather({ warningActive: false, liftedAt: "", classStart: "19:00" });
ok(c7.cancel === false && c7.code === "manual_review", "資料不足 → 交管理員判斷（唔會自動取消）");
ok(toMinutes("10:00") === 600 && toMinutes("bad") === null, "時間解析正確");

console.log("\n📋 3. 接線");
const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
ok(/\/api\/platform/.test(idx), "已掛載 /api/platform");
const routeSrc = fs.readFileSync(path.join(__dirname, "../src/routes/platform.js"), "utf8");
ok(/weather-policy/.test(routeSrc) && /weather-warnings/.test(routeSrc), "有政策與即時警告端點");
const hkoSrc = fs.readFileSync(path.join(__dirname, "../src/services/hko-warnings.js"), "utf8");
ok(/data\.weather\.gov\.hk/.test(hkoSrc), "接天文台開放數據（hko-warnings service）");
ok(/TC\(8\|9\|10\)/.test(hkoSrc), "識別八號或以上信號");
ok(/WRAINB/.test(hkoSrc), "識別黑色暴雨");
const detail = fs.readFileSync(path.join(__dirname, "../../frontend-v2/detail.html"), "utf8");
ok(/10:00 前/.test(detail) && /15:00 前/.test(detail), "課程頁列出康文署式分界");
const ops = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
ok(/weather-warnings/.test(ops) && /極端天氣判斷參考/.test(ops), "後台取消精靈顯示即時警告與參考");

console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
process.exit(fail ? 1 : 0);
