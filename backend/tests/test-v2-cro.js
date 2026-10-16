/**
 * Test: CRO 進階 4 項（WhatsApp 浮動 + 使用說明卡 + 地區 pills + 付款/信任）
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
const exp = fs.readFileSync(path.join(root, "explore.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");
const ftr = fs.readFileSync(path.join(root, "assets/footer.js"), "utf8");

const fails = [];
const has = (s, m, label) => { if (!s.includes(m)) fails.push("missing " + (label || "") + ": " + m); };

// 1. WhatsApp 浮動客服
has(idx, 'class="wa-float"', "wa float");
has(idx, "https://wa.me/85290335538", "wa number 85290335538");
if (!/wa\.me\/85290335538\?text=/.test(idx)) fails.push("wa float should prefill text");
if (!/class="wa-float"[^>]*target="_blank"[^>]*rel="noopener"/.test(idx)) fails.push("wa float new tab");
has(css, ".wa-float {", "wa float css");
has(css, "@keyframes waPulse", "pulse animation");
if (!/prefers-reduced-motion/.test(css)) fails.push("respect prefers-reduced-motion");

// 2. 使用說明 3 欄卡
has(idx, "如何使用 ZenPass 上課？", "how title");
has(idx, "彈性預約", "card 1");
has(idx, "Pass 優惠套票", "card 2");
has(idx, "全城通行", "card 3");
has(css, ".how-grid", "how grid css");

// 3. 地區 pills（香港 18 區）
["cw", "wc", "east", "south", "ytm", "ssp", "kc", "wts", "kt", "kts", "tw", "tm", "yl", "north", "tp", "st", "sk", "islands"].forEach(z => has(idx, "explore.html?zone=" + z, "zone pill " + z));
has(idx, "中西區", "cw label");
has(idx, "離島", "islands label");
has(css, ".loc-pill", "loc pill css");
has(exp, "const ZONES", "explore ZONES");
has(exp, "function inZone", "inZone");
if (!/filter\(inArea\)\.filter\(inScene\)\.filter\(inZone\)/.test(exp)) fails.push("load should filter area+scene+zone");
// 確認 18 區齊全
["cw", "wc", "east", "south", "ytm", "ssp", "kc", "wts", "kt", "kts", "tw", "tm", "yl", "north", "tp", "st", "sk", "islands"].forEach(z => has(exp, z + ": { label:", "explore zone " + z));

// 4. Footer 付款 + 信任
["Visa", "Mastercard", "轉數快 FPS", "PayMe", "八達通", "AlipayHK"].forEach(p => has(ftr, 'aria-label="' + p, "pay " + p));
has(ftr, "香港康樂及體育有限公司 官方營運", "trust label");
has(ftr, "zp-trust", "trust css class");
has(ftr, "#1677FF", "AlipayHK color");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ CRO 4 項（WhatsApp/說明卡/地區/付款信任）tests passed");
