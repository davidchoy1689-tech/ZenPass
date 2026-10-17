/** ZenPass — 會籍購買（FPS/PayMe 人手確認）＋ 封閉免費開通 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 會籍付費流程 tests");
const root = path.join(__dirname, "..");
const web = path.join(root, "..", "frontend-v2");

console.log("── 免費開通已封閉 ──");
const mem = fs.readFileSync(path.join(root, "src/routes/memberships.js"), "utf8");
const idx = mem.indexOf('router.post("/subscribe"');
const ret = mem.indexOf("return res.status(403)", idx);
const grant = mem.indexOf("credits = credits + ?", idx);
ok(idx > 0 && ret > idx, "subscribe 有 403 攔截");
ok(ret < grant, "403 喺加點之前（唔會執行到）");
ok(mem.includes("USE_MEMBERSHIP_ORDER"), "回傳 USE_MEMBERSHIP_ORDER 指引");
ok(mem.includes("module.exports.MEMBERSHIP_PLANS"), "方案表可重用");

console.log("── 新會籍訂單 API ──");
const mo = fs.readFileSync(path.join(root, "src/routes/membership-orders.js"), "utf8");
ok(mo.includes('router.get("/plans"'), "GET /plans");
ok(mo.includes('router.post("/", authenticateToken'), "POST / 建立訂單");
ok(mo.includes('"/my"'), "GET /my");
ok(mo.includes('"/admin/pending"'), "管理員待確認");
ok(mo.includes('"/admin/:id/confirm"'), "管理員確認");
ok(mo.includes('"/admin/:id/reject"'), "管理員拒絕");
const confirmPart = mo.slice(mo.indexOf('"/admin/:id/confirm"'));
ok(confirmPart.indexOf("INSERT INTO memberships") > 0, "會籍只喺確認時建立");
ok(confirmPart.includes("grantEntitlements"), "確認時授予 entitlements");
ok(confirmPart.includes("writeBlock"), "確認時寫 blockchain audit");
ok(mo.includes("741-293856-838"), "顯示 HSBC 戶口");
ok(mo.includes("qr.payme.hsbc.com.hk"), "顯示 PayMe 連結");

const init = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
ok(init.includes("membership_orders"), "init-db 建 membership_orders 表");
const index = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
ok(index.includes('app.use("/api/membership-orders"'), "route 已 mount");

console.log("── 前端 ──");
const page = fs.readFileSync(path.join(web, "membership.html"), "utf8");
ok(page.includes("/membership-orders"), "會籍頁用新 API");
ok(!page.includes('api.post("/memberships/subscribe"'), "已移除免費訂閱呼叫");
ok(page.includes("交易參考編號"), "要求填交易參考編號");
ok(page.includes("myOrders"), "顯示我嘅訂單");
ok(page.includes("loadOrders"), "載入訂單狀態");

const admin = fs.readFileSync(path.join(web, "admin.html"), "utf8");
ok(admin.includes('"morder"'), "admin 有「會籍待確認」tab");
ok(admin.includes("/membership-orders/admin/pending"), "admin 讀待確認清單");

console.log("──────────────────────────────");
if (fail) { console.error("❌ " + fail + " failed"); process.exit(1); }
console.log("✅ 會籍付費流程 tests passed");
