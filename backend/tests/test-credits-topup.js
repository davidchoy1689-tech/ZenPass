/** ZenPass — 增值流程（FPS/PayMe 人手確認）＋ 封閉免費加點漏洞 tests */
const fs = require("fs");
const path = require("path");

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 增值流程 / 加點安全 tests");
const root = path.join(__dirname, "..");
const web = path.join(root, "..", "frontend-v2");

console.log("── 免費加點已封閉 ──");
const mem = fs.readFileSync(path.join(root, "src/routes/memberships.js"), "utf8");
ok(/router\.post\("\/credits", authenticateToken, \(req, res\) => \{\s*\n\s*\/\/ 🚫/.test(mem), "memberships/credits 已加封鎖");
ok(mem.includes("USE_CREDITS_TOPUP"), "回傳 USE_CREDITS_TOPUP 指引");
const creditsIdx = mem.indexOf('router.post("/credits"');
const retIdx = mem.indexOf("return res.status(403)", creditsIdx);
const updateIdx = mem.indexOf("UPDATE users SET credits = credits + ? + ?", creditsIdx);
ok(retIdx > 0 && retIdx < updateIdx, "403 return 喺加點之前（唔會執行到）");

const tp = fs.readFileSync(path.join(root, "src/routes/topup.js"), "utf8");
ok(tp.includes("自動增值暫停用"), "topup/execute 已限制");

console.log("── 新增值 API ──");
const cr = fs.readFileSync(path.join(root, "src/routes/credits.js"), "utf8");
ok(cr.includes('router.post("/topup"'), "POST /api/credits/topup");
ok(cr.includes('router.get("/packages"'), "GET /api/credits/packages");
ok(cr.includes('router.get("/orders"'), "GET /api/credits/orders");
ok(cr.includes('"/admin/pending"'), "管理員待確認清單");
ok(cr.includes('"/admin/:id/confirm"'), "管理員確認（加點）");
ok(cr.includes('"/admin/:id/reject"'), "管理員拒絕");
ok(cr.includes("status IN ('pending','confirmed','rejected')") || cr.includes("status = 'pending'"), "有 pending 狀態控制");
const confirmPart = cr.slice(cr.indexOf('"/admin/:id/confirm"'));
ok(confirmPart.indexOf("UPDATE users SET credits") > 0, "加點只喺管理員確認時發生");
ok(confirmPart.includes("transactions"), "確認後寫入交易紀錄");
ok(confirmPart.includes("writeBlock"), "確認後寫區塊鏈 audit");

const init = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
ok(init.includes("credit_topup_orders"), "init-db 建 credit_topup_orders 表");

const index = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
ok(index.includes('app.use("/api/credits"'), "route 已 mount");

console.log("── 前端 ──");
const page = fs.readFileSync(path.join(web, "buy-credits.html"), "utf8");
ok(page.includes('api.post("/credits/topup"'), "增值頁用新 API");
ok(!page.includes('"/memberships/credits"'), "已移除舊「即時加點」呼叫");
ok(page.includes("9033 5538"), "顯示 FPS 收款號碼");
ok(page.includes("交易參考編號"), "要求填交易參考編號");
ok(page.includes("管理員核對") && page.includes("才會入帳"), "明確講明要人手確認");
ok(page.includes("credits/orders"), "顯示增值紀錄");

const admin = fs.readFileSync(path.join(web, "admin.html"), "utf8");
ok(admin.includes('"topup"'), "admin 有「增值待確認」tab");
ok(admin.includes("/credits/admin/pending"), "admin 讀待確認清單");
ok(admin.includes("/confirm"), "admin 可確認");

console.log("──────────────────────────────");
if (fail) { console.error("❌ " + fail + " failed"); process.exit(1); }
console.log("✅ 增值流程 tests passed");
