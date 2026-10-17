/**
 * Test: 取消政策 + 預約期上限（2026-10-17 規則）
 *  - 課程：未來 2 個月
 *  - 租場：未來 3 個月
 *  - 課程取消：≥3日 0% / 1–3日 50% / <1日 100%
 */
const fs = require("fs");
const path = require("path");

const { cancellationFeeRate } = require("../src/services/booking-service.js");

const fails = [];
const eq = (a, b, m) => { if (a !== b) fails.push(`${m}: expected ${b}, got ${a}`); };

// 取消費用
eq(cancellationFeeRate(200), 0, "200h (8日) → 0%");
eq(cancellationFeeRate(72), 0, "72h (3日) → 0%");
eq(cancellationFeeRate(71.9), 0.5, "71.9h → 50%");
eq(cancellationFeeRate(48), 0.5, "48h (2日) → 50%");
eq(cancellationFeeRate(24), 0.5, "24h (1日) → 50%");
eq(cancellationFeeRate(23.9), 1, "23.9h → 100%");
eq(cancellationFeeRate(2), 1, "2h (當日) → 100%");
eq(cancellationFeeRate(NaN), 1, "NaN → 100% (保守)");

// API 預約期（source check）
const cls = fs.readFileSync(path.join(__dirname, "../src/routes/classes.js"), "utf8");
if (!/\+2 months/.test(cls)) fails.push("classes schedules should limit to +2 months");

const vr = fs.readFileSync(path.join(__dirname, "../src/routes/venue-rentals.js"), "utf8");
if (!/\+ 3\)/.test(vr)) fails.push("venue book should limit to +3 months (setMonth(+3))");
if (!/venue_failure_200pct/.test(vr)) fails.push("venue failure 200% penalty");
if (!/tenant_cancel_forfeit/.test(vr)) fails.push("tenant cancel forfeit record");
if (!/已確認嘅租場不可更改/.test(vr)) fails.push("reject should block confirmed rentals");

const bs = fs.readFileSync(path.join(__dirname, "../src/services/booking-service.js"), "utf8");
if (!/課程只開放未來 2 個月內預約/.test(bs)) fails.push("createBooking 2-month guard");

// 前端政策說明
const cd = fs.readFileSync(path.join(__dirname, "../../frontend-v2/class-detail.html"), "utf8");
const vh = fs.readFileSync(path.join(__dirname, "../../frontend-v2/venue-rentals.html"), "utf8");
if (!/取消政策/.test(cd) || !/50%/.test(cd) || !/100%/.test(cd)) fails.push("class-detail cancel policy text");
if (!/3 個月/.test(vh) || !/200%/.test(vh)) fails.push("venue-rentals policy text");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ 取消政策 / 預約期 tests passed");
