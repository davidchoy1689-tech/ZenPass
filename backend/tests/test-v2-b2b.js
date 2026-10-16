/**
 * Test: B2B 企業／學校 Team Building Banner（index.html / v2.css）
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");

const fails = [];
const has = (s, m, label) => { if (!s.includes(m)) fails.push("missing " + (label || "") + ": " + m); };

has(html, 'class="b2b"', "b2b block");
has(html, "尋找企業 Team Building 或學校新興運動體驗活動？", "b2b title");
has(html, "立即 WhatsApp 查詢報價", "b2b button label");
// WhatsApp 連結 + 新分頁 + 預填訊息
has(html, "https://wa.me/852", "WhatsApp URL");
if (!/class="b2b-btn"[^>]*target="_blank"[^>]*rel="noopener"/.test(html)) fails.push("b2b button should open new tab with rel=noopener");
if (!/wa\.me\/852\d+\?text=/.test(html)) fails.push("b2b WhatsApp link should prefill text");
// 次要連結
has(html, "corporate.html", "corporate link");
has(html, "school.html", "school link");

// CSS
has(css, ".b2b {", "b2b css");
has(css, ".b2b-btn", "b2b btn css");
if (!/\.b2b-btn[^{]*\{[^}]*#25D366/.test(css)) fails.push("b2b button should use WhatsApp green #25D366");
if (!/@media \(min-width: 640px\)\s*\{\s*\.b2b\s*\{\s*flex-direction:\s*row/.test(css)) fails.push("b2b should be row layout on >=640px");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ B2B Team Building banner tests passed");
