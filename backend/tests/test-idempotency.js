#!/usr/bin/env node
/** ZenPass — Idempotency-Key 儲存策略 tests（客戶端意圖 key + 伺服器去重） */
process.env.JWT_SECRET = "test-secret-for-idempotency-0123456789";
const os = require("os");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-idem-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));

const db0 = new Database(tmp);
db0.exec(`CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  response_data TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
db0.close();

const express = require("express");
const { optionalIdempotency } = require("../src/middleware/idempotency");
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: req.headers["x-user"] || "u1", role: "coach" };
  next();
});

let calls = 0;
app.post("/api/once", optionalIdempotency, (req, res) => {
  calls++;
  setTimeout(() => res.json({ success: true, n: calls, echo: req.body.x || null }), 80);
});
let failCalls = 0;
app.post("/api/fail-once", optionalIdempotency, (req, res) => {
  failCalls++;
  if (failCalls === 1) return res.status(500).json({ success: false, error: "boom" });
  res.json({ success: true, n: failCalls });
});

const post = (base, p, body, key, user) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key, "x-user": user || "u1" },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, data: await r.json() }));

const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  console.log("🧪 1. 同一 key + 同一 body → 只執行一次");
  const a1 = await post(base, "/api/once", { x: 1 }, "k-basic");
  const c1 = calls;
  const a2 = await post(base, "/api/once", { x: 1 }, "k-basic");
  ok(a1.status === 200 && a1.data.n === 1, "第一次成功");
  ok(a2.status === 200 && a2.data.n === 1 && calls === c1, "第二次回傳快取，冇再執行");

  console.log("🧪 2. Body key 次序唔影響 hash");
  const b1 = await post(base, "/api/once", { a: 1, b: 2 }, "k-order");
  const c2 = calls;
  const b2 = await post(base, "/api/once", { b: 2, a: 1 }, "k-order");
  ok(b1.status === 200 && b2.status === 200 && b2.data.n === b1.data.n && calls === c2, "排序後同一 hash → 重用");

  console.log("🧪 3. 同一 key + 不同 body → 409");
  const d = await post(base, "/api/once", { x: 99 }, "k-basic");
  ok(d.status === 409 && d.data.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY", "拒絕改 payload");

  console.log("🧪 4. 唔同用戶重用同一 key → 403");
  const e = await post(base, "/api/once", { x: 1 }, "k-basic", "u2");
  ok(e.status === 403 && e.data.code === "IDEMPOTENCY_KEY_USER_MISMATCH", "拒絕跨用戶讀取");

  console.log("🧪 5. 併發同一 key → 一個執行，另一個 409 IN_FLIGHT");
  const [f1, f2] = await Promise.all([
    post(base, "/api/once", { c: 1 }, "k-race"),
    post(base, "/api/once", { c: 1 }, "k-race"),
  ]);
  const statuses = [f1.status, f2.status].sort();
  ok(statuses[0] === 200 && statuses[1] === 409, "一個 200、一個 409", statuses);
  const inflight = [f1, f2].find((x) => x.status === 409);
  ok(inflight && inflight.data.retry_after_sec === 1, "409 帶 retry_after_sec");

  console.log("🧪 6. 失敗後同一 key 可重試");
  const g1 = await post(base, "/api/fail-once", {}, "k-fail");
  const g2 = await post(base, "/api/fail-once", {}, "k-fail");
  ok(g1.status === 500, "第一次失敗");
  ok(g2.status === 200 && g2.data.n === 2, "第二次同一 key 重新執行成功");

  console.log("🧪 7. 卡死 pending（>180s）可接手");
  const crypto = require("crypto");
  const emptyHash = "sha256:" + crypto.createHash("sha256").update("{}").digest("hex");
  const db = new Database(tmp);
  db.prepare(
    "INSERT INTO idempotency_keys (id,response_data,status,user_id,body_hash,created_at) VALUES (?,?,?,?,?,datetime('now','-10 minutes'))",
  ).run("k-stale", "{}", "pending", "u1", emptyHash);
  db.close();
  const before = calls;
  const h = await post(base, "/api/once", {}, "k-stale");
  ok(h.status === 200 && calls === before + 1, "過期 pending 被接手執行");

  console.log("🧪 8. 靜態：前端意圖 key + offline queue");
  const root = path.join(__dirname, "../..");
  const apiJs = fs.readFileSync(path.join(root, "frontend-v2/assets/api.js"), "utf8");
  ok(/newOpKey\s*:\s*uuid/.test(apiJs), "api.js 有 newOpKey()");
  ok(/IDEMPOTENCY_IN_FLIGHT/.test(apiJs), "api.js 識別 in-flight 並重試");
  const cd = fs.readFileSync(path.join(root, "frontend-v2/coach-dashboard.html"), "utf8");
  ok(/intentKey\("coach-schedule"/.test(cd), "開班用同一意圖 key");
  ok(/coach-settle:/.test(cd), "結算用同一意圖 key");
  const oqJs = fs.readFileSync(path.join(root, "frontend-v2/assets/offline-queue.js"), "utf8");
  ok(/idempotencyKey/.test(oqJs), "offline queue 記錄固定 key");

  console.log("🧪 9. offline queue：重試重用同一 key");
  const vm = require("vm");
  const oqSrc = fs.readFileSync(path.join(root, "frontend-v2/assets/offline-queue.js"), "utf8");
  const oqMod = { exports: {} };
  vm.runInNewContext(oqSrc, { module: oqMod, exports: oqMod.exports, window: undefined, globalThis: {} });
  const { createQueue } = oqMod.exports;
  const mem = (() => { let m = {}; return { getItem: (k) => m[k] || null, setItem: (k, v) => (m[k] = v) }; })();
  const q = createQueue(mem);
  q.add({ booking_id: "bk1", schedule_id: "s1" });
  q.add({ booking_id: "bk1", schedule_id: "s1" });
  ok(q.read().length === 1, "同一 booking 唔會重複入隊");
  const firstKey = q.read()[0].idempotencyKey;
  ok(firstKey === "attend:s1:bk1", "key 由 schedule+booking 衍生");
  const seen = [];
  await q.flush((item) => { seen.push(item.idempotencyKey); return "retry"; });
  await q.flush((item) => { seen.push(item.idempotencyKey); return true; });
  ok(seen.length === 2 && seen[0] === firstKey && seen[1] === firstKey, "兩次 flush 用同一 key");

  console.log("🧪 10. 路由／migration 已接");
  const coachJs = fs.readFileSync(path.join(__dirname, "../src/routes/coach.js"), "utf8");
  ok(/schedules\/:sid\/settle"[\s\S]{0,160}optionalIdempotency/.test(coachJs), "settle 已套 idempotency");
  ok(/already_settled/.test(coachJs), "重複結算回傳上次結果");
  const mig = fs.readFileSync(path.join(__dirname, "../src/services/migrate-schema.js"), "utf8");
  ok(/idempotency_keys", "user_id"/.test(mig), "migration 有 user_id");
  const passJs = fs.readFileSync(path.join(__dirname, "../src/routes/passes.js"), "utf8");
  ok(/create-checkout"[\s\S]{0,120}requireIdempotency/.test(passJs), "create-checkout 已套 idempotency");
  ok(/create-intent"[\s\S]{0,120}requireIdempotency/.test(passJs), "create-intent 已套 idempotency");
  ok(/fps-order"[\s\S]{0,120}requireIdempotency/.test(passJs), "fps-order 已套 idempotency");
  const passHtml = fs.readFileSync(path.join(root, "frontend-v2/pass.html"), "utf8");
  ok(/passIdemKey\("intent"/.test(passHtml) && /passIdemKey\("checkout"/.test(passHtml) && /passIdemKey\("fps"/.test(passHtml), "付款三條路徑都有意圖 key");

  server.close();
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.log(fail === 0 ? `\n🎉 全部通過（${pass} 項）` : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
});
