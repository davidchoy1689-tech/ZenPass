#!/usr/bin/env node
/**
 * Phase 5.6 — 桌面篩選面板鍵盤導航（WCAG 2.2 keyboard parity）
 * 鎖死：focus trap、roving tabindex、方向鍵、Space/Enter、Ctrl+Enter、Esc、chip Delete、ARIA
 */
const fs = require("fs");
const path = require("path");

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const home = fs.readFileSync(path.join(__dirname, "../../frontend-v2/index.html"), "utf8");

console.log("🧪 1. 語意與 ARIA");
ok(/id="dPanel" role="dialog" aria-label="篩選課程"/.test(home), "面板 role=dialog + 名稱");
ok(/id="dpRegion"[^>]*role="radiogroup"/.test(home), "地區 radiogroup");
ok(/id="dpTime"[^>]*role="radiogroup"/.test(home), "時段 radiogroup");
ok(/id="dpKind"[^>]*role="group"/.test(home), "運動類型 group");
ok(/setAttribute\('role', kind === 'check' \? 'checkbox' : 'radio'\)/.test(home), "選項 role 依類型（radio/checkbox）");
ok(/setAttribute\('aria-checked', pressed \? 'true' : 'false'\)/.test(home), "aria-checked 反映狀態");
ok(/id="dpGo"[^>]*aria-live="polite"/.test(home), "CTA aria-live 公告結果數");
ok(/setAttribute\('aria-disabled', count === 0 \? 'true' : 'false'\)/.test(home), "零結果 aria-disabled");
ok(/aria-label', '移除 ' \+ label/.test(home), "chip 有「移除 X」名稱");

console.log("\n🧪 2. 焦點管理");
ok(/function firstFocus\(\)/.test(home) && /function restoreFocus\(\)/.test(home), "開啟首焦／關閉還原函數");
ok(/lastTrigger = document\.activeElement/.test(home), "記住開啟前焦點");
ok(/t\.focus\(\);/.test(home) && /getElementById\('dsFilterBtn'\)/.test(home), "關閉後焦點返觸發掣");
ok(/setTimeout\(firstFocus, 40\)/.test(home), "開啟後焦點移入面板");
ok(/if \(e\.key === 'Tab'\) \{/.test(home) && /list\[list\.length - 1\]/.test(home), "Tab focus trap");
ok(/e\.shiftKey && \(cur === first/.test(home), "Shift+Tab 反向循環");

console.log("\n🧪 3. 方向鍵與選取");
ok(/e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/.test(home), "↑↓ 同欄移動");
ok(/e\.key === 'Home' \|\| e\.key === 'End'/.test(home), "Home/End 跳首尾");
ok(/e\.key === 'ArrowRight' \|\| e\.key === 'ArrowLeft'/.test(home), "←→ 跨欄");
ok(/e\.key === ' ' \|\| e\.key === 'Enter'/.test(home), "Space/Enter 選取");
ok(/function setRoving\(col, idx\)/.test(home) && /setAttribute\('tabindex', i === idx \? '0' : '-1'\)/.test(home), "roving tabindex");
ok(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === 'Enter'/.test(home), "Ctrl/Cmd+Enter 套用");

console.log("\n🧪 4. 關閉與 chip 鍵盤操作");
ok(/if \(openRegion\) \{ openRegion = ''; renderDesktop\(\); firstFocus\(\); return; \}/.test(home), "Esc 先收地區展開，再關面板");
ok(/e\.stopPropagation\(\);/.test(home), "面板內 Esc 唔會同時觸發文件層關閉");
ok(/e\.key === 'Delete' \|\| e\.key === 'Backspace'/.test(home), "chip Delete/Backspace 移除");
ok(/function restoreAfterChip\(\)/.test(home), "移除後焦點移至下一個 chip");

console.log("\n🧪 5. 視覺與重繪");
ok(/:focus-visible[^{]*\{[^}]*outline: 2px solid #0F766E/.test(home), "2px teal focus ring");
ok(/lastOpt = \{ group: t\.dataset\.group/.test(home), "記錄最後焦點選項");
ok(/if \(a && a !== document\.body && dPanel\.contains\(a\)\) return;/.test(home), "重繪後保留焦點");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
