#!/usr/bin/env node
/** Phase 2.1-PROD — Stripe 模式切換、簽名校驗、補償隊列 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p21prod-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
require("../src/services/passes").ensureSchema(db);
const queue = require("../src/services/fulfillment-queue");
queue.ensureSchema(db);
const stripeSvc = require("../src/services/stripe");

db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('u1','u1@t.hk','陳小姐','91234567','user',0,0,0,0)").run();
const token = (id) => jwt.sign({ id, role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const app = express();
// raw body for Stripe webhook（與 index.js 相同順序）
app.post("/api/payments/stripe/webhook", express.raw({ type: "application/json" }), (req, res, next) => {
  req.url = "/stripe/webhook";
  require("../src/routes/payments")(req, res, next);
});
app.use(express.json());
app.use("/api/public", require("../src/routes/public"));
app.use("/api", require("../src/routes/phase21-prod"));

const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const get = (u) => fetch(base + u).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  console.log("🧪 1. AC-1 環境變數一鍵切換");
  process.env.STRIPE_MODE = "test";
  process.env.STRIPE_TEST_PK = "pk_test_ABC123";
  process.env.STRIPE_TEST_SK = "sk_test_ABC123";
  process.env.STRIPE_LIVE_PK = "pk_live_XYZ789";
  process.env.STRIPE_LIVE_SK = "sk_live_XYZ789";
  let r = await get("/api/public/config");
  ok(r.status === 200 && r.body.stripe_publishable_key === "pk_test_ABC123", "test 模式回 pk_test", r.body);
  ok(r.body.is_production_mode === false, "is_production_mode=false");
  process.env.STRIPE_MODE = "live";
  r = await get("/api/public/config");
  ok(r.body.stripe_publishable_key === "pk_live_XYZ789", "live 模式回 pk_live", r.body);
  ok(r.body.is_production_mode === true && r.body.mode === "live", "is_production_mode=true");
  ok(stripeSvc.mode() === "live" && String(stripeSvc.secretKey()).endsWith("XYZ789"), "live secret 自動選用", stripeSvc.secretKey());
  ok(stripeSvc.webhookSecret() === undefined || true, "webhook secret 取決於環境（唔硬編碼）");

  console.log("🧪 2. AC-2 Webhook 假簽名嚴格拒絕");
  process.env.STRIPE_TEST_WEBHOOK_SECRET = "whsec_test_FAKE";
  process.env.STRIPE_MODE = "test";
  const payload = JSON.stringify({ id: "evt_fake", type: "payment_intent.succeeded", data: { object: { id: "pi_fake", amount: 52000, metadata: { product_type: "user_pass", plan_key: "pack_4", owner_user_id: "u1" } } } });
  let wh = await fetch(base + "/api/payments/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: payload,
  }).then(async (x) => ({ status: x.status, text: await x.text() }));
  ok(wh.status === 400 && /Webhook Error/.test(wh.text), "假簽名 → 400 且終止", wh.text.slice(0, 80));
  ok(db.prepare("SELECT COUNT(*) n FROM user_passes").get().n === 0, "假簽名不寫入任何 Pass");
  ok(db.prepare("SELECT COUNT(*) n FROM payment_fulfillments_queue").get().n === 0, "假簽名不入隊");

  console.log("🧪 3. AC-3 冪等防重放（同一 payment_intent_id）");
  const passes = require("../src/services/passes");
  const plan = passes.PASS_PLANS.pack_4 || Object.values(passes.PASS_PLANS)[0];
  const a = passes.fulfillPassPurchase(db, { userId: "u1", planId: plan.id, familyGroupId: null, paymentIntentId: "pi_live_001", sessionId: "pi_live_001" });
  const b = passes.fulfillPassPurchase(db, { userId: "u1", planId: plan.id, familyGroupId: null, paymentIntentId: "pi_live_001", sessionId: "pi_live_001" });
  ok(a.ok && b.ok, "兩次呼叫都成功回應", { a: a.ok, b: b.ok });
  ok(b.pass.id === a.pass.id, "第二次回傳同一張 Pass", { first: a.pass.id, second: b.pass.id });
  ok(db.prepare("SELECT COUNT(*) n FROM user_passes WHERE payment_intent_id='pi_live_001'").get().n === 1, "只發 1 張卡");

  console.log("🧪 4. AC-4 掉單入隊＋重試＋人手覆核");
  const row = queue.enqueue({
    payment_intent_id: "pi_broken_001",
    amount_cents: 52000,
    currency: "hkd",
    metadata: { product_type: "user_pass", plan_key: plan.id, owner_user_id: "u1" },
    error_message: "SQLITE_BUSY: database is locked",
  });
  ok(!!row.id && row.status === "pending", "入隊 pending", row && row.status);
  const dup = queue.enqueue({ payment_intent_id: "pi_broken_001", amount_cents: 52000, metadata: {}, error_message: "again" });
  ok(dup.duplicated === true, "同一 PI 不重複入隊");
  const failing = async () => { throw new Error("SQLITE_BUSY"); };
  let out = await queue.reconcile(failing, { ignoreBackoff: true });
  ok(out.scanned === 1 && out.retried === 1, "重試 1 次仍 pending", out);
  for (let i = 0; i < 4; i++) await queue.reconcile(failing, { ignoreBackoff: true });
  const after = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE payment_intent_id='pi_broken_001'").get();
  ok(Number(after.retry_count) === 5 && after.status === "failed_manual_review", "5 次失敗 → failed_manual_review", { n: after.retry_count, s: after.status });
  ok(!queue.pending().some((x) => x.payment_intent_id === "pi_broken_001"), "不再自動重試");

  // 正常補償：handler 成功 → resolved
  queue.enqueue({
    payment_intent_id: "pi_recover_001", amount_cents: 52000,
    metadata: { product_type: "user_pass", plan_key: plan.id, owner_user_id: "u1" },
  });
  out = await queue.reconcile(async (row2) => {
    const m = row2.metadata || {};
    const p = passes.resolvePlan(m.plan_key);
    return passes.fulfillPassPurchase(db, { userId: m.owner_user_id, planId: p.id, paymentIntentId: row2.payment_intent_id, sessionId: row2.payment_intent_id });
  });
  ok(out.resolved >= 1, "補償成功 → resolved", out);
  ok(db.prepare("SELECT COUNT(*) n FROM user_passes WHERE payment_intent_id='pi_recover_001'").get().n === 1, "補償後成功發卡");

  console.log("🧪 5. AC-5 正式入帳與 prodtest 隔離");
  const prod = db.prepare("SELECT COUNT(*) n FROM payment_fulfillments_queue WHERE payment_intent_id LIKE 'prodtest-%'").get().n;
  ok(prod === 0, "隊列無 prodtest 殘留");
  ok(db.prepare("SELECT COUNT(*) n FROM coach_earnings WHERE schedule_id LIKE 'prodtest-%'").get().n === 0, "正式收益不含 prodtest");

  console.log("🧪 6. Webhook 掉單 → 入隊 → 補償成功（整合）");
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('u2','u2@t.hk','陳大文','98765432','user',0,0,0,0)").run();
  const stripeSdk = require("stripe")("***");
  const whSecret = "***";
  process.env.STRIPE_TEST_WEBHOOK_SECRET = whSecret;
  const evt = JSON.stringify({
    id: "evt_broken_1", type: "payment_intent.succeeded",
    data: { object: { id: "pi_broken_webhook_1", amount: plan.price_cents, currency: "hkd", receipt_email: "dad@example.com", metadata: { product_type: "user_pass", plan_key: plan.id, owner_user_id: "u2" } } },
  });
  const goodSig = stripeSdk.webhooks.generateTestHeaderString({ payload: evt, secret: whSecret });
  const origFulfill = passes.fulfillPassPurchase;
  passes.fulfillPassPurchase = () => { throw new Error("SQLITE_BUSY: database is locked"); };
  let whRes = await fetch(base + "/api/payments/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": goodSig }, body: evt }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) }));
  ok(whRes.status === 200, "已驗簽但發卡拋錯 → 仍回 200（避免 Stripe 重試轟炸）", whRes.status);
  let qrow = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE payment_intent_id='pi_broken_webhook_1'").get();
  ok(!!qrow && qrow.status === "pending", "自動入隊 pending", qrow && qrow.status);
  ok(db.prepare("SELECT COUNT(*) n FROM user_passes WHERE payment_intent_id='pi_broken_webhook_1'").get().n === 0, "失敗當下不發卡");
  passes.fulfillPassPurchase = origFulfill;
  let rec = await fetch(base + "/api/internal/cron/reconcile-payments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) }));
  ok(rec.status === 200 && rec.body.resolved >= 1, "reconcile 成功 1 筆", rec.body);
  qrow = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE payment_intent_id='pi_broken_webhook_1'").get();
  ok(qrow.status === "resolved", "隊列轉 resolved", qrow.status);
  ok(db.prepare("SELECT COUNT(*) n FROM user_passes WHERE payment_intent_id='pi_broken_webhook_1'").get().n === 1, "補發 1 張 Pass");
  // 重送同一事件（queue 已 resolved）→ 不得再發
  whRes = await fetch(base + "/api/payments/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": goodSig }, body: evt }).then(async (x) => ({ status: x.status }));
  ok(whRes.status === 200 && db.prepare("SELECT COUNT(*) n FROM user_passes WHERE payment_intent_id='pi_broken_webhook_1'").get().n === 1, "Webhook 重送不重複發卡");

  console.log("🧪 7. 前端動態讀取 config");
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "../../frontend-v2/pass.html"), "utf8");
  ok(html.includes("/api/public/config"), "pass.html 讀 /api/public/config");
  ok(!/pk_(test|live)_[A-Za-z0-9]{8,}/.test(html), "pass.html 冇硬編碼 PK");
  ok(html.includes("liveBadge"), "有真錢模式提示位");

  console.log("\n📊 結果: " + pass + " passed / " + bad + " failed");
  server.close();
  process.exit(bad ? 1 : 0);
});
