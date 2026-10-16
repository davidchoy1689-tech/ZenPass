/**
 * Test: Header（登入/註冊、Pass 餘額、頭像）+ 「什麼是新興運動？」區塊
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");

const fails = [];
const has = (s, m, label) => { if (!s.includes(m)) fails.push("missing " + (label || "") + ": " + m); };

// Header
has(html, 'id="loginBtn"', "login btn");
has(html, 'href="login.html"', "login link");
has(html, "登入 / 註冊", "login label");
has(html, 'id="userChip"', "avatar chip");
has(html, 'id="walletChip"', "wallet chip");
has(html, 'id="walletBal"', "wallet balance");
has(html, "💳", "wallet icon");
// 登入狀態邏輯（用 api.me()）
has(html, "api.me()", "auth probe");
if (!/loginBtn\.hidden\s*=\s*true/.test(html)) fails.push("should hide login when logged in");
if (!/userChip\.hidden\s*=\s*false/.test(html)) fails.push("should show avatar when logged in");

// Why block
has(html, "什麼是新興運動", "why title");
has(html, "零經驗上手", "adv 1");
has(html, "跨年齡", "adv 2");
has(html, "國際認可運動", "adv 3");
has(html, 'class="why-grid"', "why grid");

// CSS
has(css, ".hero-chip", "hero chip css");
has(css, ".hero-login", "hero login css");
has(css, ".why-grid", "why grid css");
if (!/\.why-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(css)) fails.push("why-grid should be 3 columns");
if (!/@media \(max-width: 560px\)\s*\{\s*\.why-grid\s*\{\s*grid-template-columns:\s*1fr/.test(css)) fails.push("why-grid should stack on mobile");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ header + 新興運動 why 區塊 tests passed");
