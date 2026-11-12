#!/usr/bin/env node
/**
 * Phase 5.7 — 手機篩選表導航（focus trap／鍵盤／live region）
 */
const fs = require("fs");
const path = require("path");

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const home = fs.readFileSync(path.join(__dirname, "../../frontend-v2/index.html"), "utf8");

console.log("🧪 1. 焦點管理（P0）");
ok(/function sheetFirstFocus\(\)/.test(home), "首焦函數存在");
ok(/var chips = sheet\.querySelectorAll\('#sdActive \.af'\)/.test(home), "有已選 chip 先聚焦 chip");
ok(/sheetTrigger = document\.activeElement/.test(home), "記住開啟前焦點");
ok(/setTimeout\(sheetFirstFocus, 80\)/.test(home), "開啟後焦點入 sheet");
ok(/if \(sheetTrigger && sheetTrigger\.focus\)/.test(home), "關閉後焦點返搜尋列");
ok(/if \(!drawer\.classList\.contains\('on'\)\) return;/.test(home), "未開時唔攔鍵盤");
ok(/if \(e\.key !== 'Tab'\) return;/.test(home) && /first\.focus\(\)/.test(home) && /last\.focus\(\)/.test(home), "Tab focus trap");

console.log("\n🧪 2. 鍵盤操作（P0 / P2）");
ok(/e\.key === 'Escape'\) \{ e\.preventDefault\(\); closeDrawer\(\);/.test(home), "Esc 關閉");
ok(/cur\.classList\.contains\('af'\) && \(e\.key === 'Delete' \|\| e\.key === 'Backspace'\)/.test(home), "chip Delete/Backspace 移除");
ok(/closest\('\.sd-chips, \.sd-districts'\)/.test(home), "方向鍵只在 chips 組內生效");
ok(/e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'/.test(home), "←→ 同組移動");
ok(/e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/.test(home) && /var order = \[areaChips, districtsBox, timeChips, kindChips\]/.test(home), "↑↓ 跳組");

console.log("\n🧪 3. Live region 與狀態");
ok(/id="sdGo"[^>]*aria-live="polite"/.test(home), "CTA aria-live");
ok(/sdGo\.setAttribute\('aria-disabled'/.test(home), "零結果 aria-disabled");
ok(/role="dialog" aria-modal="true" aria-labelledby="sdTitle"/.test(home), "dialog + aria-modal + labelledby");
ok(/aria-pressed/.test(home), "chip aria-pressed");
ok(/aria-label', '移除 ' \+ label/.test(home), "已選 chip 語音名稱");

console.log("\n🧪 4. 焦點視覺與重繪");
ok(/\.sd-chip:focus-visible[^{]*\{[^}]*outline: 2px solid #0F766E/.test(home), "chip focus ring");
ok(/lastChip = \{ box:/.test(home), "記錄最後焦點 chip");
ok(/setTimeout\(function \(\) \{\s*var a = document\.activeElement;/.test(home), "重繪後還原焦點");
ok(/document\.body\.style\.overflow = 'hidden'/.test(home), "開啟時鎖背景滾動");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
