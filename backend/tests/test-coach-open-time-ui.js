#!/usr/bin/env node
/**
 * test-coach-open-time-ui.js — 前端回歸：開班時間唔可以再變 04:00
 * 檢查：
 *  1) coach-dashboard 有用 hk-time.js（HK 業務時區）
 *  2) 冇再直接 new Date("YYYY-MM-DD HH:mm:ss")（會被當本地時間 → 少 8 小時）
 *  3) 送出用 date + start_time HH:mm + duration_min
 *  4) 顯示用 local_date / local_time 或 HkTime
 */
const fs = require("fs");
const path = require("path");
let pass = 0, bad = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));

const root = path.join(__dirname, "../../frontend-v2");
const dash = fs.readFileSync(path.join(root, "coach-dashboard.html"), "utf8");
const hk = fs.readFileSync(path.join(root, "assets/hk-time.js"), "utf8");
const cal = fs.readFileSync(path.join(root, "assets/coach-calendar.js"), "utf8");

ok(fs.existsSync(path.join(root, "assets/hk-time.js")), "hk-time.js 存在");
ok(/HkTime\.localToIso|localToIso\(/.test(hk), "hk-time 有 localToIso");
ok(/\+08:00/.test(hk), "hk-time 用 +08:00");
ok(/timeZone:\s*TZ/.test(hk), "hk-time 用 Asia/Hong_Kong 格式");

ok(/assets\/hk-time\.js\?v=/.test(dash), "coach-dashboard 已引入 hk-time.js");
ok(!/new Date\(String\(t\)\.replace\(" ", "T"\)\)/.test(dash), "已移除會誤判時區嘅 new Date(…)");
ok(/HkTime\.dateOf/.test(dash) && /HkTime\.timeOf/.test(dash), "dayKey/hhmm2 改用 HkTime");
ok(/HkTime\.fmtShort/.test(dash), "fmt 改用 HkTime.fmtShort");
ok(/HkTime\.today\(\)/.test(dash), "SEL_DAY 用 HK 今日");

ok(/date:\s*date/.test(dash) && /duration_min:\s*dur/.test(dash), "送出帶 date + duration_min");
ok(/start_time:\s*timeStr/.test(dash), "start_time 送 HH:mm（HK 牆鐘）");
ok(/\.slice\(0,\s*5\)/.test(dash), "時間有 slice(0,5) 清理秒數");

ok(/HkTime\.dateOf/.test(cal) || /hkParts/.test(cal), "coach-calendar 有 HK 安全解析");
ok(!/new Date\(String\(raw\)\.replace\(" ", "T"\)\)\s*;/.test(cal), "coach-calendar 無裸解析");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
