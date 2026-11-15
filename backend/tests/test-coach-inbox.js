/**
 * 教練收件箱（2026-11-16）
 */
process.env.JWT_SECRET = "inbox-test-secret-0123456789-abcdef";
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
app.use("/api", require("../src/routes/coach-inbox"));
const server = app.listen(0);
const port = server.address().port;
const post = (u, b) => fetch(`http://127.0.0.1:${port}${u}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (u) => fetch(`http://127.0.0.1:${port}${u}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

db.prepare("INSERT INTO users (id,email,name,role,is_coach) VALUES ('coach','c@t.hk','測試教練','coach',1)").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('adm','a@t.hk','客服','admin')").run();

(async () => {
  console.log("\n🧪 1. 教練發送給平台");
  global.__me = { id: "coach", role: "coach" };
  let r = await post("/api/coach/inbox", { subject: "班表查詢", body: "想問 12 月可否加開星期三班？" });
  ok(r.status === 201, "發送成功", JSON.stringify(r.body));
  const mid = r.body.id;

  r = await post("/api/coach/inbox", { body: "x" });
  ok(r.status === 400, "太短 → 400", String(r.status));

  r = await get("/api/coach/inbox");
  ok(r.status === 200 && r.body.messages.length === 1, "列表見到", r.body.messages && r.body.messages.length);
  ok(r.body.unread === 1, "未讀 1", r.body.unread);

  console.log("\n🧪 2. 平台回覆");
  global.__me = { id: "adm", role: "admin" };
  r = await get("/api/admin/coach-messages");
  ok(r.status === 200 && r.body.messages.length === 1, "平台收到查詢", r.body.messages && r.body.messages.length);
  r = await post(`/api/admin/coach-messages/${mid}/reply`, { body: "可以，幫你開 12 月逢三 7pm" });
  ok(r.status === 201, "回覆成功", JSON.stringify(r.body));

  global.__me = { id: "coach", role: "coach" };
  r = await get("/api/coach/inbox");
  ok(r.body.messages.length === 2, "教練見到回覆", r.body.messages.length);
  ok(r.body.messages[0].from_role === "admin", "回覆來自平台", r.body.messages[0].from_role);
  ok(r.body.unread === 1, "回覆未讀 1", r.body.unread);

  console.log("\n🧪 3. 標記已讀");
  const replyId = r.body.messages[0].id;
  r = await post(`/api/coach/inbox/${replyId}/read`, {});
  ok(r.status === 200, "已讀成功");
  r = await get("/api/coach/inbox");
  ok(r.body.unread === 0, "未讀清零", r.body.unread);

  console.log("\n🧪 4. 教練發送給學員");
  r = await post("/api/coach/inbox", { to_user_id: "stu1", subject: "提醒", body: "明天記住帶水" });
  ok(r.status === 201, "發給學員成功");
  const row = db.prepare("SELECT to_user_id FROM coach_messages WHERE id=?").get(r.body.id);
  ok(row.to_user_id === "stu1", "有收件人", row.to_user_id);

  console.log("\n🧪 5. 前端接線");
  const fe = require("fs").readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-inbox.html"), "utf8");
  ok(fe.includes("/coach/inbox"), "頁面接 API");
  ok(fe.includes("guardPage(\"coach\")"), "有角色守衛");
  const hub = require("fs").readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-hub.html"), "utf8");
  ok(hub.includes("coach-inbox.html"), "教練中心有入口");

  server.close();
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
