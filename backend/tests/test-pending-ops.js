#!/usr/bin/env node
/** ZenPass — 跨裝置 pending_ops tests */
process.env.JWT_SECRET = "test-pending-ops-secret-".repeat(4);
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "zenpass-pending-" + Date.now() + ".db");
process.env.DB_PATH = tmp;
const db = new Database(tmp);
db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, token_version INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
INSERT INTO users (id,email,role) VALUES ('u1','u1@t.hk','user');
INSERT INTO users (id,email,role) VALUES ('u2','u2@t.hk','user');
`);
db.close();

const express = require("express");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
app.use("/api/payments", require("../src/routes/pending-ops"));

let pass = 0, fail = 0;
const ok = (c, m, x) => (c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))));
const tok = (id) => jwt.sign({ id, role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const post = (base, p, body, id) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + tok(id || "u1") },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, data: await r.json() }));

const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  console.log("🧪 1. 建立／取回同一意圖");
  const a1 = await post(base, "/api/payments/pending-op", { scope: "pass:intent", payload_hash: "h1" });
  ok(a1.status === 201 && a1.data.success && a1.data.client_op_id, "第一次建立", a1);
  ok(a1.data.resumed === false, "resumed=false");
  const a2 = await post(base, "/api/payments/pending-op", { scope: "pass:intent", payload_hash: "h1" });
  ok(a2.status === 200 && a2.data.resumed === true && a2.data.client_op_id === a1.data.client_op_id, "第二次取回同一 key");

  console.log("🧪 2. 不同 payload／不同用戶");
  const b1 = await post(base, "/api/payments/pending-op", { scope: "pass:intent", payload_hash: "h2" });
  ok(b1.data.client_op_id !== a1.data.client_op_id, "不同 payload → 不同 key");
  const b2 = await post(base, "/api/payments/pending-op", { scope: "pass:intent", payload_hash: "h1" }, "u2");
  ok(b2.data.client_op_id !== a1.data.client_op_id, "不同用戶 → 不同 key");

  console.log("🧪 3. 完成後開新意圖");
  const c1 = await post(base, "/api/payments/pending-op/" + a1.data.client_op_id + "/complete", {});
  ok(c1.status === 200 && c1.data.completed, "complete 成功");
  const c2 = await post(base, "/api/payments/pending-op/" + a1.data.client_op_id + "/complete", {});
  ok(c2.status === 200 && c2.data.already_completed, "重複 complete 冪等");
  const c3 = await post(base, "/api/payments/pending-op", { scope: "pass:intent", payload_hash: "h1" });
  ok(c3.status === 201 && c3.data.client_op_id !== a1.data.client_op_id, "完成後 → 新 key");

  console.log("🧪 4. 過期自動換新");
  const db2 = new Database(tmp);
  db2.prepare("UPDATE pending_ops SET expires_at=datetime('now','-1 minute') WHERE id=?").run(c3.data.client_op_id);
  db2.close();
  const d1 = await post(base, "/api/payments/pending-op", { scope: "pass:intent", payload_hash: "h1" });
  ok(d1.status === 201 && d1.data.client_op_id !== c3.data.client_op_id, "過期 pending → 新 key");

  console.log("🧪 5. 併發 5 個請求 → 只有一個 pending");
  const many = await Promise.all(
    Array.from({ length: 5 }, () => post(base, "/api/payments/pending-op", { scope: "booking", payload_hash: "race" })),
  );
  const ids = new Set(many.map((x) => x.data.client_op_id));
  ok(ids.size === 1, "5 個請求同一個 key", [...ids]);
  const db3 = new Database(tmp);
  const n = db3.prepare("SELECT COUNT(*) c FROM pending_ops WHERE scope='booking' AND payload_hash='race' AND status='pending'").get().c;
  db3.close();
  ok(n === 1, "DB 只有 1 個 pending 記錄", n);

  console.log("🧪 6. 權限／驗證");
  const e1 = await post(base, "/api/payments/pending-op/" + b1.data.client_op_id + "/complete", {}, "u2");
  ok(e1.status === 404, "唔可以 complete 別人意圖");
  const e2 = await post(base, "/api/payments/pending-op", { scope: "", payload_hash: "" });
  ok(e2.status === 400, "缺 scope／hash → 400");
  const e3 = await fetch(base + "/api/payments/pending-op", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  ok(e3.status === 401, "未登入 → 401");

  console.log("🧪 7. 靜態接線／migration");
  const root = path.join(__dirname, "../..");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/pending-ops/.test(idx), "index.js 已掛 pending-ops");
  const mig = fs.readFileSync(path.join(__dirname, "../src/services/migrate-schema.js"), "utf8");
  ok(/CREATE TABLE IF NOT EXISTS pending_ops/.test(mig), "migration 建 pending_ops");
  const passHtml = fs.readFileSync(path.join(root, "frontend-v2/pass.html"), "utf8");
  ok(/api\.post\("\/payments\/pending-op"/.test(passHtml) && /async function passIdemKey/.test(passHtml), "pass.html 取 server 意圖 key");
  const bk = fs.readFileSync(path.join(root, "frontend-v2/booking.html"), "utf8");
  ok(/api\.post\("\/payments\/pending-op"/.test(bk) && /await idempotencyKeyFor\(\)/.test(bk), "booking.html 用 server 意圖 key");

  server.close();
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.log(fail === 0 ? `\n🎉 全部通過（${pass} 項）` : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
});
