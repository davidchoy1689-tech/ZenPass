/**
 * 全角色收件箱（2026-11-16）
 */
process.env.JWT_SECRET = "inboxsecret0123456789abcdefghijklmnopqrstuvwxyz";
const path = require("path"), os = require("os");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-inbox-" + Date.now() + ".db");
require("../src/config/init-db")(); require("../src/config/update-db")();
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
const app = express();
app.use("/api", require("../src/routes/inbox"));
const server = app.listen(0);
const port = server.address().port;
const post = (u, b) => fetch(`http://127.0.0.1:${port}${u}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (u) => fetch(`http://127.0.0.1:${port}${u}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

db.prepare("INSERT INTO users (id,email,name,role) VALUES ('stu','s@t.hk','學員甲','user')").run();
db.prepare("INSERT INTO users (id,email,name,role,is_coach) VALUES ('coach','c@t.hk','教練乙','coach',1)").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('org','o@t.hk','機構丙','org_admin')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('ven','v@t.hk','場地丁','partner_owner')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('adm','a@t.hk','客服','admin')").run();

(async () => {
  console.log("\n🧪 1. 所有角色都可以發去平台");
  for (const [id, role] of [["stu", "user"], ["coach", "coach"], ["org", "org_admin"], ["ven", "partner_owner"]]) {
    global.__me = { id, role };
    const r = await post("/api/inbox", { subject: `${role} 查詢`, body: "你好，想查詢一下安排" });
    ok(r.status === 201, `${role} 發送成功`, JSON.stringify(r.body).slice(0, 80));
  }

  console.log("\n🧪 2. 平台收件");
  global.__me = { id: "adm", role: "admin" };
  let r = await get("/api/admin/inbox");
  ok(r.status === 200 && r.body.messages.length === 4, "平台見到 4 條", r.body.messages && r.body.messages.length);
  const first = r.body.messages[0];

  console.log("\n🧪 3. 平台回覆 → 對方未讀");
  r = await post(`/api/admin/inbox/${first.id}/reply`, { body: "已收到，稍後回覆你" });
  ok(r.status === 201, "回覆成功");
  const target = first.from_user_id;
  global.__me = { id: target, role: "user" };
  r = await get("/api/inbox");
  ok(r.body.messages.some((m) => m.from_role === "admin"), "用戶收到回覆");
  ok(r.body.unread === 1, "未讀 1", r.body.unread);

  console.log("\n🧪 4. 已讀");
  const reply = r.body.messages.find((m) => m.from_role === "admin");
  await post(`/api/inbox/${reply.id}/read`, {});
  r = await get("/api/inbox");
  ok(r.body.unread === 0, "已讀清零", r.body.unread);

  console.log("\n🧪 5. 點對點（教練 → 學員）");
  global.__me = { id: "coach", role: "coach" };
  r = await post("/api/inbox", { to_user_id: "stu", subject: "提醒", body: "記得帶水" });
  ok(r.status === 201, "教練發俾學員成功");
  global.__me = { id: "stu", role: "user" };
  r = await get("/api/inbox");
  ok(r.body.messages.some((m) => m.from_name === "教練乙"), "學員收到教練訊息");

  console.log("\n🧪 6. 前端接線");
  const fs = require("fs");
  const inbox = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "inbox.html"), "utf8");
  ok(inbox.includes('api.get("/inbox")') && inbox.includes('api.post("/inbox"'), "通用頁接 API");
  ok(inbox.includes("ZPRoles.isLoggedIn"), "任何已登入角色可用");
  for (const f of ["my.html", "corporate-dashboard.html", "venue-dashboard.html", "coach-hub.html"]) {
    const h = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", f), "utf8");
    ok(h.includes("inbox"), f + " 有入口");
  }
  const admin = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "admin.html"), "utf8");
  ok(admin.includes("/admin/inbox"), "後台用平台訊息 API");
  const roles = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "assets", "roles.js"), "utf8");
  ok(roles.includes("mountInboxTab") && roles.includes("data-inbox-tab"), "底欄訊息 tab 已注入");
  const my = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "my.html"), "utf8");
  ok(/roles\.js\?v=3/.test(my), "我的頁已升級 roles.js");

  server.close();
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
