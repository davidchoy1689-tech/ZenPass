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
ok(WEATHER_POLICY.cutoffs.leadMinutes === 120, "界線 = 課堂開始前 2 小時（120 分鐘）");
ok(WEATHER_POLICY.rules.length === 4, "4 條判斷規則");
ok(/開始前 2 小時/.test(WEATHER_POLICY.rules[1].text), "規則寫明 2 小時前除下 → 照常");
ok(/不足 2 小時/.test(WEATHER_POLICY.rules[2].text), "規則寫明不足 2 小時 → 取消");
ok(/致電|WhatsApp/.test(WEATHER_POLICY.rules[3].text), "規則提醒出門前查詢");
ok(/全額退款/.test(WEATHER_POLICY.compensation) && /改期/.test(WEATHER_POLICY.compensation), "補償：全額退款或改期");

console.log("\n📋 2. 判斷邏輯");
const c1 = evaluateWeather({ warningActive: true, classStart: "19:00" });
ok(c1.cancel === true && c1.code === "signal_active", "警告生效中 → 取消");
const c2 = evaluateWeather({ warningActive: false, liftedAt: "09:00", classStart: "14:00" });
ok(c2.cancel === false && c2.code === "lifted_before_lead" && c2.minutesBetween === 300, "09:00 除下、14:00 課堂（距 5 小時）→ 照常");
const c3 = evaluateWeather({ warningActive: false, liftedAt: "12:00", classStart: "14:00" });
ok(c3.cancel === false && c3.code === "lifted_before_lead" && c3.minutesBetween === 120, "剛好 2 小時前除下 → 照常（界線含等於）");
const c4 = evaluateWeather({ warningActive: false, liftedAt: "12:30", classStart: "14:00" });
ok(c4.cancel === true && c4.code === "within_lead" && c4.minutesBetween === 90, "1.5 小時前才除下 → 取消");
const c5 = evaluateWeather({ warningActive: false, liftedAt: "13:59", classStart: "14:00" });
ok(c5.cancel === true && c5.code === "within_lead", "1 分鐘前才除下 → 取消");
const c6 = evaluateWeather({ warningActive: false, liftedAt: "18:00", classStart: "19:00" });
ok(c6.cancel === true && c6.code === "within_lead", "19:00 課堂、18:00 才除下 → 取消");
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
ok(/開始前 2 小時/.test(detail), "課程頁列出 2 小時界線");
const ops = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
ok(/weather-warnings/.test(ops) && /極端天氣判斷參考/.test(ops), "後台取消精靈顯示即時警告與參考");

console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
process.exit(fail ? 1 : 0);
