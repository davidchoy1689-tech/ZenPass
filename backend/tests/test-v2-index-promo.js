/**
 * Test: Hero 優惠碼「一鍵複製」按鈕 + Toast（index.html / v2.css）
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");

const fails = [];
const has = (s, m) => { if (!s.includes(m)) fails.push("missing: " + m); };

has(html, 'id="copyPromo"');
has(html, "📋 一鍵複製");
has(html, 'id="promoCode"');
has(html, "WELCOME50");
has(html, 'id="toast"');
// toast 文字包含優惠碼
if (!/已複製優惠碼\s*"\s*\+\s*PROMO\s*\+\s*"！/.test(html)) fails.push("toast text should be 已複製優惠碼 WELCOME50！ (got dynamic PROMO)");
has(html, "navigator.clipboard");
// fallback copy
has(html, "execCommand");

// CSS
has(css, ".promo-code");
if (!/\.banner\s*\{[^}]*flex-wrap:\s*wrap/.test(css)) fails.push(".banner should wrap (flex-wrap:wrap) for mobile");
has(css, ".promo {");
has(css, ".toast {");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ hero 一鍵複製優惠碼 tests passed");
