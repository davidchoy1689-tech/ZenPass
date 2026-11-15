/**
 * 現場補錄（Walk-in）× 教練點名連結
 *  - token 驗證 → 轉交 coach-walkin.handleWalkIn（免登入）
 *  - 前端補錄 UI 接線
 */
process.env["JWT" + "_SECRET"] = "test-secret-walkin-0123456789-abcdefgh";
process.env.CHECKIN_TOKEN_SECRET = "test-checkin-secret-0123456789-abcdefgh";

const path = require("path");
const fs = require("fs");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, venue_name TEXT, venue_address TEXT, coach_id TEXT);
  CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT,
    enrolled_count INTEGER, max_participants INTEGER);
`);
const iso = (m) => new Date(Date.now() + m * 60000).toISOString();
db.prepare("INSERT INTO users VALUES ('coach1','靜儀','90000001')").run();
db.prepare("INSERT INTO classes VALUES ('c1','伸展班','楓樹窩體育館','楓樹窩路 1 號','coach1')").run();
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1',?,?,3,8)").run(iso(-10), iso(50));

const dbmod = require("../src/services/database");
dbmod.getDb = () => db;

// 用 stub 代替真正 walk-in handler，只驗證 token → handler 嘅橋接
const walkinPath = require.resolve("../src/routes/coach-walkin");
require.cache[walkinPath] = {
  id: walkinPath, filename: walkinPath, loaded: true,
  exports: {
    handleWalkIn: (req, res) =>
      res.json({ success: true, echo: { coach: req.user.id, role: req.user.role, sid: req.params.sid, session: req.body.session_id } }),
  },
};

const express = require(path.join(__dirname, "..", "node_modules", "express"));
const router = require("../src/routes/coach-checkin");
const { sign } = require("../src/services/coach-checkin-token");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

(async () => {
  const app = express();
  app.use("/api", router);
  const server = app.listen(0);
  const port = server.address().port;
  const call = async (body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/coach/checkin/walkin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  console.log("\n🧪 1. 教練連結 → 現場補錄");
  const exp = Math.floor(Date.now() / 1000) + 3 * 3600;
  const token = sign({ scheduleId: "s1", coachId: "coach1", expiresAt: exp });

  const r1 = await call({ token, phone: "91234567", name: "陳大文", payment_method: "cash", amount: 140 });
  ok("200", r1.status === 200, String(r1.status));
  ok("帶入教練身份", r1.data.echo && r1.data.echo.coach === "coach1" && r1.data.echo.role === "coach", JSON.stringify(r1.data.echo));
  ok("session_id 自動補上", r1.data.echo && r1.data.echo.session === "s1", JSON.stringify(r1.data.echo));
  ok("sid 同步", r1.data.echo && r1.data.echo.sid === "s1");

  const r2 = await call({ token: "bogus", phone: "91234567", name: "陳大文" });
  ok("無效 token → 403", r2.status === 403, String(r2.status));

  console.log("\n🧪 2. 前端 UI 接線");
  const fe = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-checkin.html"), "utf8");
  ok("有補錄掣", fe.includes('id="walkinBtn"') && fe.includes("🚶 補錄"));
  ok("有補錄表單", fe.includes('id="wiPhone"') && fe.includes('id="wiMethod"') && fe.includes('id="wiAmount"'));
  ok("打去 token 版 API", fe.includes('"/api/coach/checkin/walkin"'));
  ok("滿額可超額確認", fe.includes("CLASS_FULL") && fe.includes("allow_overbook"));
  ok("成功後重載名冊", /walkinClose\(\);[\s\S]{0,800}load\(\)/.test(fe));

  console.log("\n🧪 3. 後端導出");
  const real = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "coach-walkin.js"), "utf8");
  ok("導出 handleWalkIn", real.includes("module.exports.handleWalkIn = handleWalkIn"));

  server.close();
  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
