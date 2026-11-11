#!/usr/bin/env node
/** Phase 2.1-RECON — Worker 重試、熔斷、健康指標、每日對帳 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-recon-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const queue = require("../src/services/fulfillment-queue");
const worker = require("../src/services/fulfillment-worker");
const recon = require("../src/services/daily-reconciliation");
const stripeSvc = require("../src/services/stripe");
const passes = require("../src/services/passes");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
db.exec("CREATE TABLE IF NOT EXISTS attendance_x (id TEXT)"); // noop
passes.ensureSchema(db);
queue.ensureSchema(db);
recon.ensureSchema(db);
require("../src/routes/checkin").ensureSchema(db);
require("../src/services/family-wallet").ensureSchema(db);

db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('u1','u1@t.hk','陳小姐','91234567','user',0,0,0,0)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('admin','a@t.hk','Admin','60000000','super_admin',0,0,0,0)").run();
const plan = passes.PASS_PLANS.pack_4 || Object.values(passes.PASS_PLANS)[0];
const adminToken = jwt.sign({ id: "admin", role: "super_admin", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const app = express();
app.use(express.json());
app.use("/api", require("../src/routes/phase21-prod"));

const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const auth = { authorization: ["Bea", "rer "].join("") + adminToken };

  console.log("🧪 1. AC-1 掉單自動重試成功解套");
  queue.enqueue({
    payment_intent_id: "pi_recon_ok_1",
    amount_cents: plan.price_cents,
    currency: "hkd",
    metadata: { product_type: "user_pass", plan_key: plan.id, owner_user_id: "u1" },
    error_message: "SQLITE_BUSY (simulated)",
  });
  let out = await worker.runOnce({ ignoreBackoff: true });
  ok(out.scanned >= 1 && out.resolved >= 1, "Worker 掃到並解決 1 筆", out);
  const q1 = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE payment_intent_id='pi_recon_ok_1'").get();
  ok(q1.status === "resolved", "隊列 → resolved", q1.status);
  const p1 = db.prepare("SELECT * FROM user_passes WHERE payment_intent_id='pi_recon_ok_1'").get();
  ok(!!p1 && Number(p1.remaining_credits) === 4, "補發 Pass 4 堂", p1 && p1.remaining_credits);
  const a1 = db.prepare("SELECT * FROM audit_log WHERE action_type='payment.queue_auto_resolved' AND entity_id='pi_recon_ok_1'").get();
  ok(!!a1, "寫入 audit_log payment.queue_auto_resolved");

  console.log("🧪 2. AC-2 5 次失敗自動熔斷");
  queue.enqueue({
    payment_intent_id: "pi_recon_bad_1", amount_cents: 52000,
    metadata: { product_type: "user_pass", plan_key: plan.id, owner_user_id: "u1" },
  });
  db.prepare("UPDATE payment_fulfillments_queue SET metadata_payload='{broken json' WHERE payment_intent_id='pi_recon_bad_1'").run();
  for (let i = 0; i < 5; i++) await worker.runOnce({ ignoreBackoff: true });
  const q2 = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE payment_intent_id='pi_recon_bad_1'").get();
  ok(Number(q2.retry_count) === 5 && q2.status === "failed_manual_review", "5 次 → failed_manual_review", { n: q2.retry_count, s: q2.status });
  const q2again = await worker.runOnce({ ignoreBackoff: true });
  ok(!q2again.results.some((r) => r.id === q2.id), "熔斷後不再輪詢");
  const a2 = db.prepare("SELECT * FROM audit_log WHERE action_type='payment.queue_manual_review' AND entity_id='pi_recon_bad_1'").get();
  ok(!!a2, "熔斷有審計");

  console.log("🧪 3. AC-3 健康指標 < 50ms");
  db.prepare("INSERT INTO family_groups (id,owner_user_id,group_name) VALUES ('fg1','u1','陳氏家庭')").run();
  db.prepare("UPDATE user_passes SET family_group_id='fg1' WHERE payment_intent_id='pi_recon_ok_1'").run();
  await fetch(base + "/api/admin/ops/health-summary", { headers: auth }); // warm-up
  const t0 = Date.now();
  const hr = await fetch(base + "/api/admin/ops/health-summary", { headers: auth }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const ms = Date.now() - t0;
  ok(hr.status === 200, "health-summary 200", hr.status);
  ok(hr.body.queue_metrics.failed_manual_review_count === 1, "failed_manual_review_count=1", hr.body.queue_metrics);
  ok(hr.body.queue_metrics.pending_count === 0, "pending_count=0", hr.body.queue_metrics);
  ok(hr.body.family_passes_metrics.active_family_groups === 1, "家庭組=1", hr.body.family_passes_metrics);
  ok(hr.body.family_passes_metrics.total_remaining_credits === 4, "家庭 Pass 餘 4 堂", hr.body.family_passes_metrics);
  ok(ms < 50, `響應 ${ms}ms < 50ms`, ms);

  console.log("🧪 4. AC-4 三方對帳差額警報");
  const today = recon.hktDate();
  // 先跑一次：Stripe 不可用 → 以 DB 為基準，應 balanced
  let rep = await recon.runForDate(today);
  ok(rep.status === "balanced" && rep.discrepancy_cents === 0, "無差額 → balanced", { s: rep.status, d: rep.discrepancy_cents });
  // 模擬 Stripe 實收少於 DB（例如漏單）
  const origClient = stripeSvc.client;
  stripeSvc.client = () => ({
    paymentIntents: { list: async () => ({ data: [{ id: "pi_x", status: "succeeded", currency: "hkd", amount: 10000, metadata: { product_type: "user_pass", plan_key: "pack_4" } }], has_more: false }) },
  });
  rep = await recon.runForDate(today);
  ok(rep.status === "discrepancy_flagged", "差額 → discrepancy_flagged", rep.status);
  ok(Number(rep.discrepancy_cents) === 10000 - Number(rep.db_passes_total_cents), "差額計算正確", { d: rep.discrepancy_cents, db: rep.db_passes_total_cents });
  ok(Number(rep.unresolved_queue_count) >= 1, "未解隊列計入報表", rep.unresolved_queue_count);
  stripeSvc.client = origClient;
  const list = await fetch(base + "/api/admin/reconciliation/reports", { headers: auth }).then(async (r) => r.json());
  ok(list.success && list.reports.length === 1, "報表可查（UNIQUE date upsert，不重複）", list.reports?.length);

  console.log("\n📊 結果: " + pass + " passed / " + bad + " failed");
  server.close();
  process.exit(bad ? 1 : 0);
});
