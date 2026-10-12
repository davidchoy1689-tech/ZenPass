#!/usr/bin/env node
/**
 * test-money-helper.js — 金額 helper / 拆賬不變量測試 (Phase 1 / S3)
 *
 * 重點：splitByRate 用整數 cents，platformCents + venueCents 一定等於原額，
 *      唔會出現「拆賬加起上嚟差一分」嘅審計問題。
 */

const { toCents, fromCents, splitByRate } = require("../src/lib/money");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  ✅ " + msg);
    passed++;
  } else {
    console.log("  ❌ " + msg);
    failed++;
  }
}

console.log("🧪 money helper / 拆賬測試");

// 基本換算
assert(toCents(33.33) === 3333, "toCents(33.33) = 3333");
assert(toCents(0.1) === 10, "toCents(0.1) = 10");
assert(fromCents(3333) === 33.33, "fromCents(3333) = 33.33");

// 拆賬不變量：platform + venue === total（逐分對齊）
const amounts = [0.01, 0.05, 33.33, 99.99, 100, 120, 179.99, 1000, 0.07];
const rates = [0.25, 0.18, 0.12, 0.33, 0.005, 0.5];
let bad = 0;
for (const a of amounts) {
  for (const r of rates) {
    const s = splitByRate(a, r);
    if (s.platformCents + s.venueCents !== s.totalCents) bad++;
    if (s.totalCents !== toCents(a)) bad++;
  }
}
assert(bad === 0, `拆賬 platform+venue === total（${amounts.length}×${rates.length} 組合全部一致）`);

// platform 約等於 amount*rate（±1 分內）
let bad2 = 0;
for (const a of amounts) {
  for (const r of rates) {
    const s = splitByRate(a, r);
    if (Math.abs(s.platformCents - Math.round(a * 100 * r)) > 1) bad2++;
  }
}
assert(bad2 === 0, "platform ≈ amount × rate（±1 分內）");

// 典型個案：100 × 25% = 25 / 75
const s1 = splitByRate(100, 0.25);
assert(s1.platform === 25 && s1.venue === 75, "100 @25% → platform 25 / venue 75");

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
