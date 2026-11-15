/**
 * 機構退款／結算申請（2026-11-16）
 */
process.env.JWT_SECRET = "orgfund-0123456789-abcdefghijklmnop";
const path = require("path"), os = require("os");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ofr-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

const authPath = require.resolve("../src/middleware/auth");
const real = Object.assign({}, require(authPath));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: Object.assign({}, real, {
    authenticateToken: (req, _r, next) => { req.user = global.__me; next(); },
    requirePermission: () => (_q, _r, next) => next(),
  }),
};
const express = require(path.join(__dirname, "..", "node_modules", "express"));
const router = require("../src/routes/org-funds");
const app = express();
app.use("/api", router);
const server = app.listen(0);
const port = server.address().port;
const post = (u, b) => fetch(`http://127.0.0.1:${port}${u}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (u) => fetch(`http://127.0.0.1:${port}${u}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

db.prepare("INSERT INTO users (id,email,name,role) VALUES ('org1','o@t.hk','機構管理員','org_admin')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('adm','a@t.hk','營運','super_admin')").run();
db.exec(`CREATE TABLE IF NOT EXISTS corporate_companies (id TEXT PRIMARY KEY, name TEXT, credit_pool REAL, credit_used REAL, status TEXT)`);
try { db.exec("ALTER TABLE corporate_companies ADD COLUMN name_en TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE corporate_companies ADD COLUMN created_at TEXT"); } catch (e) {}
db.prepare("INSERT INTO corporate_companies (id,name,name_en,credit_pool,credit_used,status) VALUES ('c1','香港康樂及體育有限公司','HK LEISURE AND FITNESS CO LTD',1000,0,'active')").run();
db.exec(`CREATE TABLE IF NOT EXISTS corporate_members (id TEXT PRIMARY KEY, company_id TEXT, user_id TEXT, role TEXT, status TEXT)`);
db.prepare("INSERT INTO corporate_members (id,company_id,user_id,role,status) VALUES ('m1','c1','org1','owner','active')").run();
db.exec(`CREATE TABLE IF NOT EXISTS coach_payout_settings (coach_id TEXT PRIMARY KEY, fps_type TEXT, fps_proxy_value TEXT, bank_code TEXT, account_holder_name TEXT, verified_at TEXT)`);

(async () => {
  global.__me = { id: "org1", role: "org_admin" };
  console.log("\n🧪 1. 未登記收款戶口 → 擋");
  let r = await post("/api/org/fund-requests", { type: "refund", amount: 500 });
  ok(r.status === 400 && r.body.code === "BANK_REQUIRED", "BANK_REQUIRED", JSON.stringify(r.body));

  console.log("\n🧪 2. 登記後提交");
  db.prepare("INSERT INTO coach_payout_settings VALUES ('org1','mobile','91234567','004','HK LEISURE AND FITNESS CO LTD',datetime('now'))").run();
  r = await post("/api/org/fund-requests", { type: "refund", amount: 500, note: "11 月餘額" });
  ok(r.status === 201, "提交成功", JSON.stringify(r.body));
  const id = r.body.id;

  r = await post("/api/org/fund-requests", { type: "settlement", amount: 300 });
  ok(r.status === 409 && r.body.code === "DUPLICATE", "重複 pending → 409", JSON.stringify(r.body));

  r = await post("/api/org/fund-requests", { type: "refund", amount: 50 });
  ok(r.status === 400, "低於 $100 → 擋", String(r.status));

  r = await get("/api/org/fund-requests");
  ok(r.status === 200 && r.body.requests.length === 1, "機構睇到自己申請", r.body.requests && r.body.requests.length);
  ok(r.body.requests[0].amount === 500, "金額正確", r.body.requests[0] && r.body.requests[0].amount);

  console.log("\n🧪 3. 營運審批 → 過數");
  global.__me = { id: "adm", role: "super_admin" };
  r = await get("/api/admin/org-fund-requests?status=pending");
  ok(r.status === 200 && r.body.requests.length === 1, "營運見到 pending", r.body.requests && r.body.requests.length);

  r = await post(`/api/admin/org-fund-requests/${id}/paid`, { reference: "FPS1234" });
  ok(r.status === 409, "未批准唔可以標已過數", String(r.status));

  r = await post(`/api/admin/org-fund-requests/${id}/approve`, {});
  ok(r.status === 200 && r.body.status === "approved", "批准成功");

  r = await post(`/api/admin/org-fund-requests/${id}/paid`, { reference: "FPS1234" });
  ok(r.status === 200 && r.body.status === "paid", "登記參考編號 → paid");
  const row = db.prepare("SELECT * FROM org_fund_requests WHERE id=?").get(id);
  ok(row.paid_reference === "FPS1234", "參考編號已存", row.paid_reference);

  console.log("\n🧪 4. 機構英文名稱（name_en）比對");
  const svc = require("fs").readFileSync(path.join(__dirname, "..", "src", "services", "payout-settings.js"), "utf8");
  ok(svc.includes("company.name_en"), "收款人優先比對機構英文名稱");
  const corp = require("fs").readFileSync(path.join(__dirname, "..", "src", "routes", "corporate.js"), "utf8");
  ok(corp.includes("name_en"), "新增／更新企業支援 name_en");

  console.log("\n🧪 5. 前端接線");
  const dash = require("fs").readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "corporate-dashboard.html"), "utf8");
  ok(dash.includes("org/fund-requests"), "機構看板有申請表");
  const admin = require("fs").readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "admin.html"), "utf8");
  ok(admin.includes("orgfund") && admin.includes("機構資金"), "後台有機構資金 tab");

  server.close();
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
