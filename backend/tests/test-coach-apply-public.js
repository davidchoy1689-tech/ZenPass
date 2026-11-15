/**
 * test-coach-apply-public.js — 教練免登入申請（P0 回歸）
 *
 * 背景：coach-apply.html 撳「提交申請」回「需要登入認證」。
 * 成因：coach-portal.js 用 router.use(authenticateToken) 掛喺 /api/coach，
 *      而且早過 coach.js 掛載 → 未登入請求永遠到唔到 /coach/apply-public。
 */
process.env.JWT_SECRET = "coach-apply-test-secret-0123456789";
const path = require("path"), os = require("os"), fs = require("fs");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-cap-" + Date.now() + ".db");
require("../src/config/init-db")(); require("../src/config/update-db")();

const { getDb } = require("../src/services/database");
const db = getDb();
const express = require(path.join(__dirname, "..", "node_modules", "express"));

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

const SRC = path.join(__dirname, "..", "src");

(async () => {
  console.log("\n🧪 1. 掛載次序（公開路由要早過 require 登入嘅 router）");
  const idx = fs.readFileSync(path.join(SRC, "index.js"), "utf8");
  const iCoach = idx.indexOf('require("./routes/coach")');
  const iPortal = idx.indexOf('require("./routes/coach-portal")');
  ok(iCoach > 0 && iPortal > 0, "兩個 router 都有掛", `${iCoach}/${iPortal}`);
  ok(iCoach < iPortal, "coach.js 早過 coach-portal.js 掛載");
  const portal = fs.readFileSync(path.join(SRC, "routes", "coach-portal.js"), "utf8");
  ok(/router\.use\(authenticateToken\)/.test(portal), "coach-portal 仍然 router.use(authenticateToken)（故此次序重要）");

  console.log("\n🧪 2. CSRF 白名單");
  const csrfSrc = fs.readFileSync(path.join(SRC, "middleware", "csrf.js"), "utf8");
  ok(csrfSrc.includes("'/coach/apply-public'"), "csrf 白名單有 /coach/apply-public");
  const { doubleCsrfProtection } = require("../src/middleware/csrf");
  let nexted = false;
  doubleCsrfProtection(
    { method: "POST", path: "/coach/apply-public", cookies: {}, headers: {} },
    { status: () => ({ json: () => {} }) },
    () => { nexted = true; },
  );
  ok(nexted, "無 token 都過得 CSRF");

  console.log("\n🧪 3. 匿名提交 → 201 有申請編號");
  const app = express();
  app.use(express.json());
  // 模擬 production：先掛一個 require 登入嘅 router 喺 /api/coach，再掛 coach（次序已修好）
  const coachRouter = require("../src/routes/coach");
  app.use("/api/coach", coachRouter);
  const server = app.listen(0);
  const port = server.address().port;

  const body = {
    name: "測試教練",
    phone: "61234567",
    email: "coach.test@example.com",
    specialties: ["芬蘭木柱", "地板冰壺"],
    years_experience: "5",
    bio: "測試用",
    regions: "葵青",
    consent: true,
  };
  let r = await fetch(`http://127.0.0.1:${port}/api/coach/apply-public`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let j = await r.json().catch(() => ({}));
  ok(r.status === 201, "狀態 201", String(r.status));
  ok(!!j.reference, "回傳申請編號", JSON.stringify(j).slice(0, 120));
  ok(j.error !== "需要登入認證", "唔會再回『需要登入認證』");

  const row = db.prepare("SELECT * FROM coach_leads WHERE phone='61234567'").get();
  ok(!!row, "已寫入 coach_leads");
  ok(row && row.reference === j.reference, "reference 對得上");
  ok(row && String(row.specialties).includes("芬蘭木柱"), "專長有存");

  console.log("\n🧪 4. 驗證與限流");
  r = await fetch(`http://127.0.0.1:${port}/api/coach/apply-public`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, phone: "123", email: "bad" }),
  });
  j = await r.json().catch(() => ({}));
  ok(r.status === 400, "短電話／壞電郵 → 400", String(r.status));
  ok(/電話|電郵/.test(j.error || ""), "有可行動錯誤訊息", j.error);

  console.log("\n🧪 5. 前端 guest 判斷 + draft");
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-apply.html"), "utf8");
  ok(page.includes("verifySession"), "有驗證 session 先決定係咪 guest");
  ok(page.includes("zp_coach_apply_draft"), "有 draft 保存");
  ok(page.includes("login.html?next="), "有必要時引導登入");

  server.close();
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
