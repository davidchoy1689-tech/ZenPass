/**
 * 前端事件收集（安裝列／成功頁提示）
 */
process.env.JWT_SECRET = "analyticssecret0123456789abcdefghijklmnop";
const path = require("path"), os = require("os");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ae-" + Date.now() + ".db");
require("../src/config/init-db")(); require("../src/config/update-db")();
const { getDb } = require("../src/services/database");
const db = getDb();
const express = require(path.join(__dirname, "..", "node_modules", "express"));

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

(async () => {
  const app = express();
  app.use("/api", require("../src/routes/analytics-events"));
  const server = app.listen(0);
  const port = server.address().port;
  const post = (body) => fetch(`http://127.0.0.1:${port}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  console.log("\n🧪 1. 收集事件");
  let r = await post({ event: "install_bar_impression", path: "/index.html", meta: { v: 1 } });
  ok(r.status === 204, "impression → 204", String(r.status));
  r = await post({ event: "install_bar_dismiss_permanent", path: "/index.html" });
  ok(r.status === 204, "dismiss → 204");
  r = await post({ event: "success_install_hint_shown", path: "/booking.html" });
  ok(r.status === 204, "success hint → 204");

  console.log("\n🧪 2. 拒收未知事件");
  r = await post({ event: "hack_event" });
  ok(r.status === 400, "未知 event → 400", String(r.status));

  console.log("\n🧪 3. 落庫");
  const n = db.prepare("SELECT COUNT(*) c FROM analytics_events").get().c;
  ok(n === 3, "有 3 條紀錄", String(n));
  const row = db.prepare("SELECT * FROM analytics_events WHERE event='install_bar_impression'").get();
  ok(!!row && row.path === "/index.html", "path 有記錄");

  console.log("\n🧪 4. 前端接線");
  const fs = require("fs");
  const mod = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "assets", "pwa-install-bar.js"), "utf8");
  for (const ev of ["install_bar_impression", "install_bar_dismiss_permanent", "install_bar_dismiss_session", "install_bar_click", "install_how_to_ios", "install_accepted"]) {
    ok(mod.includes(ev), "模組有 " + ev);
  }
  const bk = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "booking.html"), "utf8");
  ok(bk.includes("successInstallHint") && bk.includes("success_install_hint_shown"), "成功頁輕提示已接");

  console.log("\n🧪 5. CSRF 白名單（匿名訪客要打得通）");
  const csrf = fs.readFileSync(path.join(__dirname, "..", "src", "middleware", "csrf.js"), "utf8");
  ok(csrf.includes("'/analytics/event'"), "csrf 白名單有 /analytics/event");
  const { doubleCsrfProtection } = require("../src/middleware/csrf");
  const req = { method: "POST", path: "/analytics/event", cookies: {}, headers: {} };
  let nexted = false;
  doubleCsrfProtection(req, { status: () => ({ json: () => {} }) }, () => { nexted = true; });
  ok(nexted, "無 CSRF token 都能通過 analytics/event");

  server.close();
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
