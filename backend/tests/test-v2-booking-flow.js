/**
 * Test: 預約流程優化（快捷搜尋 / 優惠碼領取 / 信任元素 / 完成頁日曆）
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
const exp = fs.readFileSync(path.join(root, "explore.html"), "utf8");
const bk = fs.readFileSync(path.join(root, "booking.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");

const fails = [];
const has = (s, m, l) => { if (!s.includes(m)) fails.push("missing " + (l || "") + ": " + m); };

// 1) 快捷搜尋
has(idx, 'id="qsDate"', "date select");
has(idx, 'value="today"', "today option");
has(idx, 'value="tomorrow"', "tomorrow option");
has(idx, 'value="weekend"', "weekend option");
has(idx, "🔍 尋找課堂", "cta");
if (!/date=.*encodeURIComponent|parts\.push\("date="/.test(idx)) fails.push("qsGo should pass date param");
has(exp, "const DATEQ", "explore DATEQ");
has(exp, "function inDate", "explore inDate");
if (!/filter\(inZone\)\.filter\(inDate\)/.test(exp)) fails.push("explore filter chain should include inDate");

// 2) WELCOME50 領取
has(idx, 'id="claimPromo"', "claim card");
if (!/localStorage\.setItem\("zp_promo"/.test(idx)) fails.push("claim should save zp_promo");
if (!/localStorage\.getItem\("zp_promo"\)/.test(bk)) fails.push("booking should read zp_promo");
has(bk, "applyPromo", "booking auto-apply");

// 3) 信任元素
has(exp, 'class="trust"', "trust row");
has(exp, "新手友善", "beginner chip");
has(exp, "剩 \" + left + \" 個名額", "seats left chip");
has(css, ".trust", "trust css");

// 4) 完成頁
has(bk, "function setupDoneActions", "done actions");
has(bk, "icsBtn", "ICS button");
has(bk, "gcalBtn", "Google Calendar button");
has(bk, "waRemind", "WhatsApp reminder button");
has(bk, "BEGIN:VCALENDAR", "ICS content");
has(bk, "calendar.google.com/calendar/render", "Google Calendar url");
if (!/setupDoneActions\(\)/.test(bk)) fails.push("setupDoneActions should be called");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ 預約流程 4 項優化 tests passed");
