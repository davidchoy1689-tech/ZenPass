#!/usr/bin/env node
/**
 * Phase 5.8 — 共用 filter state（draft / applied、持久化、摘要只反映 applied）
 */
const fs = require("fs");
const path = require("path");

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const home = fs.readFileSync(path.join(__dirname, "../../frontend-v2/index.html"), "utf8");

console.log("🧪 1. 單一狀態來源");
ok(/var store = FS\.createInitialStore\(\)/.test(home), "store 由 createInitialStore 建立");
ok(/var F = store\.draft;/.test(home) && /var APPLIED = store\.applied;/.test(home), "F／APPLIED 由 store 派生");
ok(/assets\/filter-store\.js/.test(home), "載入共用 filter store 模組");
ok(/dispatch\(\{ type: 'OPEN_PANEL' \}\)/.test(home), "開啟用 OPEN_PANEL");
ok(/dispatch\(\{ type: 'DISCARD_DRAFT' \}\)/.test(home), "關閉用 DISCARD_DRAFT");
ok(/dispatch\(\{ type: 'APPLY' \}\)/.test(home) && (home.match(/type: 'APPLY'/g)||[]).length >= 2, "兩個 CTA 都用 APPLY");
ok(!/var F2|var state2|mirrorState/.test(home), "冇重複第二份狀態");

console.log("\n🧪 2. 開啟＝草稿、套用＝提交、關閉＝丟棄");
ok(/function openDrawer\(\) \{\s*\n\s*dispatch\(\{ type: 'OPEN_PANEL' \}\);/.test(home), "手機開啟時 OPEN_PANEL");
ok(/function openPanel\(\) \{[\s\S]{0,200}dispatch\(\{ type: 'OPEN_PANEL' \}\);/.test(home), "桌面開啟時 OPEN_PANEL");
ok((home.match(/dispatch\(\{ type: 'APPLY' \}\);/g) || []).length >= 2, "兩個 CTA 都 dispatch APPLY");
ok(/dispatch\(\{ type: 'DISCARD_DRAFT' \}\);\s*\n\s*renderAll\(\);\s*\n\s*drawer\.classList\.remove\('on'\)/.test(home), "手機關閉時 DISCARD_DRAFT");
ok(/dispatch\(\{ type: 'DISCARD_DRAFT' \}\);\s*\n\s*dPanel\.classList\.remove\('on'\)/.test(home), "桌面關閉時 DISCARD_DRAFT");

console.log("\n🧪 3. 摘要只反映 applied");
ok(/function summaryTextFor\(st\)/.test(home) && /function summaryText\(\) \{ return summaryTextFor\(APPLIED\); \}/.test(home), "summaryText 以 applied 計算");
ok(/heroSummaryEl\.textContent = \(APPLIED\.zone \|\| APPLIED\.date \|\| APPLIED\.cats\.length\)/.test(home), "Hero 摘要用 applied 判斷");

console.log("\n🧪 4. 持久化與 URL");
ok(/sessionStorage\.setItem\('zp_filters'/.test(home), "套用後寫 sessionStorage");
ok(/sessionStorage\.getItem\('zp_filters'\)/.test(home), "載入時讀 sessionStorage");
ok(/loadApplied\(\);\s*\n\s*renderAll\(\);/.test(home), "初始化時 hydrate");
ok(/p\.set\('zone'/.test(home) && /p\.set\('date'/.test(home) && /p\.set\('cats'/.test(home), "URL 帶 zone/date/cats");

console.log("\n🧪 5. 兩個 UI 共用同一份");
ok(/renderDesktop\(\)[\s\S]{0,80}F\.cats/.test(home) || /F\.cats\.forEach/.test(home), "桌面讀 F");
ok(/kindChips\.appendChild\(chip\(k\.l, k\.k \? F\.cats\.indexOf/.test(home), "手機讀 F");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
