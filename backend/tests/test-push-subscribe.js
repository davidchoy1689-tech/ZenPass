/**
 * Web Push：VAPID 公鑰、訪客訂閱、booking 同步
 */
process.env.VAPID_PUBLIC_KEY = "BP_TEST_PUBLIC_KEY";

const path = require("path");
const http = require("http");
const express = require(path.join(__dirname, "..", "node_modules", "express"));
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
  CREATE TABLE guest_sessions (token TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT);
  CREATE TABLE bookings (id TEXT PRIMARY KEY, user_id TEXT, schedule_id TEXT, status TEXT, push_subscription TEXT);
  CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, subscription TEXT,
    user_agent TEXT, created_at TEXT, updated_at TEXT);
`);
db.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001')").run();
db.prepare("INSERT INTO guest_sessions VALUES ('tok-valid','u1',datetime('now','+1 day'))").run();
db.prepare("INSERT INTO guest_sessions VALUES ('tok-expired','u1',datetime('now','-1 day'))").run();
db.prepare("INSERT INTO bookings VALUES ('b1','u1','s1','pending_payment',NULL)").run();

const dbmod = require("../src/services/database");
dbmod.getDb = () => db;
const router = require("../src/routes/push-public");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/push", router);
  const server = app.listen(0);
  const port = server.address().port;
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  console.log("\n🧪 1. VAPID 公鑰");
  const k = await call("GET", "/api/push/vapid-public-key");
  ok("200 + key", k.status === 200 && k.data.key === "BP_TEST_PUBLIC_KEY");

  console.log("\n🧪 2. 訪客訂閱");
  const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
  const r = await call("POST", "/api/push/guest-subscribe", { token: "tok-valid", subscription: sub });
  ok("200", r.status === 200 && r.data.success === true);
  ok("push_subscriptions 1 筆", db.prepare("SELECT COUNT(*) n FROM push_subscriptions").get().n === 1);
  ok("booking 已寫 push_subscription", JSON.parse(db.prepare("SELECT push_subscription p FROM bookings WHERE id='b1'").get().p).endpoint === sub.endpoint);

  console.log("\n🧪 3. 重複訂閱（更新，不重複）");
  await call("POST", "/api/push/guest-subscribe", { token: "tok-valid", subscription: sub });
  ok("仍然 1 筆", db.prepare("SELECT COUNT(*) n FROM push_subscriptions").get().n === 1);

  console.log("\n🧪 4. 過期 token");
  const bad = await call("POST", "/api/push/guest-subscribe", { token: "tok-expired", subscription: sub });
  ok("401", bad.status === 401);

  console.log("\n🧪 5. 缺 subscription");
  const miss = await call("POST", "/api/push/guest-subscribe", { token: "tok-valid" });
  ok("400", miss.status === 400);

  server.close();
  console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
