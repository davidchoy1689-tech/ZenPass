#!/usr/bin/env node
/**
 * Phase 5.4 — 首頁 Hero 精簡（David 2026-11-13 wireframe）
 * 鎖死：桌面用完整搜尋列、手機用膠囊、單行 chips、3 格價值帶、層級與尺寸
 */
const fs = require("fs");
const path = require("path");

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const FE = path.join(__dirname, "../../frontend-v2");
const home = fs.readFileSync(path.join(FE, "index.html"), "utf8");

console.log("🧪 1. 結構");
ok(/class="hero-brand-pill"/.test(home), "保留品牌 pill");
ok(/<h1>全港<span class="hl">新興運動<\/span>與<span class="hl">樂齡強肌<\/span>體驗平台<\/h1>/.test(home), "H1 文案一致");
ok(/class="search-capsule"/.test(home) && /id="qsGo"/.test(home), "保留完整搜尋膠囊（Phase 5.2 結構）");
ok(/id="heroSearchPill"/.test(home), "保留手機膠囊按鈕");
ok(/🔍 探索全港課程/.test(home), "手機膠囊文案精簡為「探索全港課程」");
ok(!/class="hot-search"/.test(home), "已移除重複嘅熱搜 chip 行");
ok((home.match(/class="loc-pill"/g) || []).length === 6, "單行 chips 保持 6 粒");
ok(/class="loc-pill" href="explore\.html">全部即開班次 →</.test(home), "首粒為實心「全部即開班次 →」");
ok(/class="hero-value-strip"/.test(home) && (home.match(/class="hero-value"/g) || []).length === 3, "3 格價值帶");
ok(/新客首堂半價/.test(home) && /免註冊即預約/.test(home) && /全港 18 區/.test(home), "價值帶三項齊");

console.log("\n🧪 2. 響應式規則");
ok(/@media \(min-width: 768px\) \{\s*\/\* 桌面：直接用完整搜尋列/.test(home), "桌面斷點存在");
ok(/\.search-capsule-wrapper \.search-capsule \{ display: flex !important; \}/.test(home), "桌面顯示完整搜尋列");
ok(/\.search-capsule-wrapper \.hero-search-pill \{ display: none !important; \}/.test(home), "桌面隱藏膠囊按鈕");
ok(/body\.home \.hero h1 \{ font-size: 28px; line-height: 1\.22/.test(home), "手機 H1 = 28px");
ok(/\.hscroll\.loc-row \{ overflow-x: auto; flex-wrap: nowrap;/.test(home), "手機 chips 單行橫向滾動");
ok(/\.hero \{ padding-bottom: 34px; \}/.test(home), "手機 Hero 收緊下邊距");

console.log("\n🧪 3. 唔會撞爛既有功能");
ok(/\.search-capsule\{border:2px solid #059669/.test(home), "保留 2px 綠框搜尋列規則（test-ui-polish）");
ok(/id="qsArea"/.test(home) && /id="qsDate"/.test(home) && /id="qsCat"/.test(home), "三個篩選器齊");
ok(/id="heroSearchSummary"/.test(home), "手機膠囊摘要節點保留（drawer 會寫入）");
ok(/id="searchDrawer"/.test(home) && /id="sdGo"/.test(home), "全螢幕篩選抽屜未受影響");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
