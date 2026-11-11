/**
 * Phase 2.1-RECON — 掉單自動補償 Worker
 *
 * 每 5 分鐘掃描 pending（retry_count < 5），指數退避重試發卡。
 * 成功 → resolved；5 次失敗 → failed_manual_review；每次寫 audit_log。
 */
const { getDb } = require("./database");
const queue = require("./fulfillment-queue");

async function runOnce({ limit = 20, ignoreBackoff = false } = {}) {
  const db = getDb();
  queue.ensureSchema(db);
  const { handleRow } = require("../routes/phase21-prod");
  const rows = queue.pending(limit, { ignoreBackoff });
  const out = { scanned: rows.length, resolved: 0, failed: 0, retried: 0, results: [] };

  for (const row of rows) {
    let meta = {};
    try { meta = JSON.parse(row.metadata_payload || "{}"); } catch (e) {
      meta = null;
    }
    try {
      if (!meta) throw new Error("INVALID_METADATA_JSON");
      const r = await handleRow({ ...row, metadata: meta });
      if (r && r.ok === false) throw new Error(r.error || "fulfill failed");
      queue.markResolved(row.id);
      out.resolved++;
      out.results.push({ id: row.id, status: "resolved" });
      audit(db, "payment.queue_auto_resolved", row, { retry_count: Number(row.retry_count || 0) + 1 });
    } catch (e) {
      const r = queue.markRetry(row.id, e.message);
      if (r && r.status === "failed_manual_review") out.failed++;
      else out.retried++;
      out.results.push({ id: row.id, status: r?.status, error: e.message });
      audit(db, r?.status === "failed_manual_review" ? "payment.queue_manual_review" : "payment.queue_retry_failed", row, {
        retry_count: r?.retry_count, error: e.message, next_retry_at: r?.next_retry_at,
      });
    }
  }
  return out;
}

function audit(db, actionType, row, newValues) {
  try {
    const { audit } = require("./audit");
    audit({
      actionType,
      entityType: "payment_fulfillment",
      entityId: row.payment_intent_id,
      userId: null,
      newValues: { queue_id: row.id, ...newValues },
      description: `付款補償：${actionType}`,
    });
  } catch (e) {
    try {
      db.prepare(
        "INSERT INTO audit_log (id,action_type,entity_type,entity_id,new_values,description,created_at) VALUES (?,?,?,?,?,?,datetime('now'))",
      ).run(require("crypto").randomUUID(), actionType, "payment_fulfillment", row.payment_intent_id, JSON.stringify(newValues), `付款補償：${actionType}`);
    } catch (x) {}
  }
}

function start(intervalMs = 5 * 60 * 1000) {
  const timer = setInterval(() => { runOnce().catch((e) => console.error("[FULFILL WORKER]", e.message)); }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { runOnce, start };
