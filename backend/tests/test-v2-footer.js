/**
 * Test: Footer（社群實質連結 + 付款方式圖示）
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const js = fs.readFileSync(path.join(root, "assets/footer.js"), "utf8");

const fails = [];
const has = (m, label) => { if (!js.includes(m)) fails.push("missing " + (label || "") + ": " + m); };

// 社群連結：實質 URL + 新分頁 + 無 opener
has("https://wa.me/852", "WhatsApp URL");
has("wa.me/85290335538", "WhatsApp 客服號碼");
has("instagram.com/zenpass_hk", "Instagram 專頁");
has("facebook.com/zenpass.hk", "Facebook 專頁");
const socialLinks = js.match(/class="(wa|ig|fb)"[^>]*target="_blank"[^>]*rel="noopener"/g) || [];
if (socialLinks.length < 3) fails.push("social links should open in new tab with rel=noopener (got " + socialLinks.length + ")");

// 付款方式圖示
has("zp-pay-row", "pay row");
has("接受付款方式", "pay title");
has('aria-label="Visa"', "Visa");
has('aria-label="Mastercard"', "Mastercard");
has('aria-label="轉數快 FPS"', "FPS");
has('aria-label="PayMe"', "PayMe");
if (!/#1A1F71/.test(js)) fails.push("Visa brand color #1A1F71");
if (!/#EB001B/.test(js) || !/#F79E1B/.test(js)) fails.push("Mastercard brand colors");
if (!/#E30613/.test(js)) fails.push("FPS brand color #E30613");
if (!/#E6007E/.test(js)) fails.push("PayMe brand color #E6007E");
// CSS
has(".zp-pay-badge", "pay badge css");
has(".zp-footer-social a.wa{background:#25D366}", "WhatsApp brand color");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ footer 社群連結 + 付款圖示 tests passed");
