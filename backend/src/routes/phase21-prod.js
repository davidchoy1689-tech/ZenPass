/**
 * Phase 2.1-PROD — 真錢金流設定、補償隊列與對帳
 *
 * GET  /api/public/config                     前端動態取 Stripe PK／模式
 * GET  /api/admin/fulfillments                補償隊列（財務／管理員）
 * POST /api/admin/fulfillments/:id/retry      手動重試
 * POST /api/internal/cron/reconcile-payments  排程／本機觸發
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const stripeSvc = require("../services/stripe");
const queue = require("../services/fulfillment-queue");
const recon = require("../services/daily-reconciliation");
const fulfillmentWorker = require("../services/fulfillment-worker");

const router = express.Router();

function isLocal(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
function adminOrLocal(req, res, next) {
  if (isLocal(req)) return next();
  return authenticateToken(req, res, () => {
    if (!["admin", "super_admin", "platform_manager"].includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: "需要管理員權限" });
    }
    next();
  });
}

async function handleRow(row) {
  const db = getDb();
  const md = row.metadata || {};
  if (md.product_type === "user_pass") {
    const passes = require("../services/passes");
    passes.ensureSchema(db);
    const plan = passes.resolvePlan(md.plan_key || md.plan_id);
    if (!plan) return { ok: false, error: "無效 Pass 方案：" + (md.plan_key || "") };
    if (Number(row.amount_cents) !== Number(plan.price_cents)) {
      return { ok: false, error: `金額不符：${row.amount_cents} vs ${plan.price_cents}` };
    }
    const r = passes.fulfillPassPurchase(db, {
      userId: md.owner_user_id || md.user_id,
      planId: plan.id,
      familyGroupId: md.family_group_id || null,
      paymentIntentId: row.payment_intent_id,
      sessionId: md.session_id || row.payment_intent_id,
    });
    return r.ok ? { ok: true, pass_id: r.pass?.id } : { ok: false, error: r.error };
  }
  if (md.product_type === "marketplace_product" && md.order_id) {
    require("../services/marketplace").ensureSchema(db);
    const order = db.prepare("SELECT * FROM marketplace_orders WHERE id=?").get(md.order_id);
    if (!order) return { ok: false, error: "找不到商城訂單" };
    if (order.order_status !== "pending_payment") return { ok: true, already: true };
    const r = require("../routes/marketplace").markPaid(db, order.id, row.payment_intent_id);
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }
  return { ok: false, error: "未知 product_type：" + (md.product_type || "none") };
}

router.get("/public/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, ...stripeSvc.publicConfig() });
});

router.get("/admin/fulfillments", authenticateToken, requirePermission("finance.payout.view"), (req, res) => {
  const db = getDb();
  queue.ensureSchema(db);
  const status = String(req.query.status || "");
  const rows = status
    ? db.prepare("SELECT * FROM payment_fulfillments_queue WHERE status=? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM payment_fulfillments_queue ORDER BY created_at DESC LIMIT 200").all();
  res.json({ success: true, items: rows });
});

router.post("/admin/fulfillments/:id/retry", authenticateToken, requirePermission("finance.payout.process"), async (req, res) => {
  try {
    const db = getDb();
    queue.ensureSchema(db);
    const row = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "紀錄不存在" });
    let meta = {};
    try { meta = JSON.parse(row.metadata_payload || "{}"); } catch (e) {}
    try {
      const out = await handleRow({ ...row, metadata: meta });
      if (out.ok === false) throw new Error(out.error || "fulfill failed");
      queue.markResolved(row.id);
      res.json({ success: true, status: "resolved", result: out });
    } catch (e) {
      const r = queue.markRetry(row.id, e.message);
      res.status(409).json({ success: false, error: e.message, queue: r });
    }
  } catch (e) {
    console.error("[FULFILL] retry:", e.message);
    res.status(500).json({ success: false, error: "重試失敗" });
  }
});

router.post("/internal/cron/reconcile-payments", adminOrLocal, async (req, res) => {
  try {
    const out = await queue.reconcile(handleRow, { limit: Number(req.body?.limit || 50) });
    if (out.failed > 0) {
      try {
        const { sendTelegramAlert } = require("../services/notification");
        await sendTelegramAlert(`🚨 付款補償失敗 ${out.failed} 筆（需人手處理）`);
      } catch (e) {}
    }
    res.json({ success: true, ...out });
  } catch (e) {
    console.error("[FULFILL] reconcile:", e.message);
    res.status(500).json({ success: false, error: "對帳失敗" });
  }
});

// ===== Phase 2.1-RECON =====
router.get("/admin/ops/health-summary", adminOrLocal, (req, res) => {
  try {
    const db = getDb();
    recon.ensureSchema(db);
    queue.ensureSchema(db);
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, ...recon.stats(db) });
  } catch (e) {
    console.error("[OPS] health-summary:", e.message);
    res.status(500).json({ success: false, error: "讀取健康指標失敗" });
  }
});

router.post("/internal/cron/fulfillment-worker", adminOrLocal, async (req, res) => {
  try {
    const out = await fulfillmentWorker.runOnce({ limit: Number(req.body?.limit || 20), ignoreBackoff: req.body?.ignore_backoff === true });
    res.json({ success: true, ...out });
  } catch (e) {
    console.error("[FULFILL WORKER] manual:", e.message);
    res.status(500).json({ success: false, error: "Worker 執行失敗" });
  }
});

router.post("/internal/cron/daily-reconciliation", adminOrLocal, async (req, res) => {
  try {
    const report = await recon.runForDate(req.body?.date);
    res.json({ success: true, report });
  } catch (e) {
    console.error("[RECON] daily:", e.message);
    res.status(500).json({ success: false, error: "對帳失敗" });
  }
});

router.get("/admin/reconciliation/reports", authenticateToken, requirePermission("finance.payout.view"), (req, res) => {
  const db = getDb();
  recon.ensureSchema(db);
  const rows = db.prepare("SELECT * FROM daily_reconciliation_reports ORDER BY reconciliation_date DESC LIMIT 90").all();
  res.json({ success: true, reports: rows });
});

module.exports = router;
module.exports.handleRow = handleRow;
