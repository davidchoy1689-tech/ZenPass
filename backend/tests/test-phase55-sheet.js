#!/usr/bin/env node
/**
 * Phase 5.5 — 手機篩選表（David 2026-11-13 第二份 spec）
 * 鎖死：chip 結構、sticky 頭尾、可拖拽、即時結果數、可移除 filter、無障礙
 */
const fs = require("fs");
const path = require("path");

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const home = fs.readFileSync(path.join(__dirname, "../../frontend-v2/index.html"), "utf8");

console.log("🧪 1. 結構（sticky header / body / sticky footer）");
ok(/id="sdSheet"/.test(home), "sheet 容器");
ok(/class="sd-grab" id="sdGrab"/.test(home), "拖拽把手");
ok(/class="sd-head" id="sdHead"/.test(home), "sticky header");
ok(/id="sdActive"/.test(home), "已選 chips 列");
ok(/id="sdRegionChips"/.test(home) && /id="sdDistricts"/.test(home), "地區：主 chips + 轄下區域");
ok(/id="sdTimeChips"/.test(home), "時段 chips");
ok(/id="sdKindChips"/.test(home), "運動類型 chips");
ok(/class="sd-foot"/.test(home) && /id="sdGo"/.test(home), "sticky footer CTA");
ok(/id="sdReset"[^>]*disabled/.test(home), "重設預設 disabled");

console.log("\n🧪 2. 互動邏輯");
ok(/顯示 ' \+ n \+ ' 個結果/.test(home), "CTA 顯示即時結果數");
ok(/沒有符合的課程，試下改篩選/.test(home), "零結果文案");
ok(/sdGo\.disabled = n === 0/.test(home), "零結果時 CTA disabled");
ok(/location\.href = 'explore\.html' \+ \(p\.toString\(\)/.test(home), "CTA 帶參數去 explore");
ok(/setState\(\{ zone: '', region: '' \}\)/.test(home), "移除地區 chip 會一併清 region");
ok(/p\.set\('zone'/.test(home) && /p\.set\('date'/.test(home) && /p\.set\('cats'/.test(home), "zone／date／cats 參數齊");

console.log("\n🧪 3. 手勢與無障礙");
ok(home.indexOf("translateY(' + dy + 'px)") >= 0, "跟手指拖拽");
ok(/dy > 140 \|\| fast/.test(home), "拖夠遠或快速滑動即關閉");
ok(/e\.key === 'Escape'/.test(home), "Esc 關閉");
ok(/e\.key !== 'Tab'/.test(home) && /first\.focus\(\)/.test(home) && /last\.focus\(\)/.test(home), "Tab 焦點鎖在 sheet 內");
ok(/role="dialog" aria-modal="true"/.test(home), "dialog + aria-modal");
ok(/aria-pressed/.test(home), "chip 有 aria-pressed 狀態");
ok(/aria-label', '移除 ' \+ label/.test(home), "已選 chip 有移除語音標籤");
ok(/document\.body\.style\.overflow = 'hidden'/.test(home), "開啟時鎖背景滾動");
ok(/env\(safe-area-inset-bottom\)/.test(home), "footer 預留 home indicator 安全區");

console.log("\n🧪 4. 動效與響應式");
ok(/cubic-bezier\(\.22,1,\.36,1\)/.test(home), "slide-up 彈性曲線");
ok(/\.sd-sheet\.dragging \{ transition: none; \}/.test(home), "拖拽時取消過渡");
ok(/height: 88%/.test(home), "預設 88% 高度");
ok(/\.sd-chips \{ display: flex; flex-wrap: wrap;/.test(home), "chips 自動換行");

console.log("\n🧪 5. 桌面版（Option A：置中 modal＋兩欄）");
ok(/id="dsFilterBtn"/.test(home), "桌面搜尋列有「⚙️ 篩選」入口");
ok(/@media \(min-width: 900px\)/.test(home), "桌面斷點 900px");
ok(/width: 960px/.test(home) && /max-width: calc\(100vw - 48px\)/.test(home), "置中 960px、細屏自適應");
ok(/transform: translate\(-50%, 0\)/.test(home), "桌面由底部滑入改為淡入上移");
ok(/grid-template-columns: 1fr 1fr/.test(home), "內容兩欄");
ok(/#searchDrawer \.sd-grab \{ display: none; \}/.test(home), "桌面隱藏拖拽把手");
ok(/#searchDrawer \.sd-sec:first-child \{ grid-column: 1 \/ -1; \}/.test(home), "地區佔滿整行");
ok(/getElementById\('dsFilterBtn'\)/.test(home), "按鈕已接線開 sheet");

console.log("\n🧪 6. 唔破壞既有");
ok(/id="searchDrawer"/.test(home) && /id="sdGo"/.test(home), "保留 searchDrawer / sdGo");
ok(/id="heroSearchPill"/.test(home) && /id="ssOpen"/.test(home), "兩個入口仍然開到 sheet");
ok(/\.search-capsule\{border:2px solid #059669/.test(home), "桌面搜尋列規則未被動");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
