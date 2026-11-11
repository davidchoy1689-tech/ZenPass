/**
 * Phase 2.1-PROD — 付款履約補償隊列
 *
 * Stripe 已扣款但發卡／寫單失敗時，寫入此隊列由 cron 重試，
 * 避免「扣了真錢卻沒發 Pass」。
 */
const crypto = require("crypto");
const { getDb } = require("./database");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_fulfillments_queue (
      id TEXT PRIMARY KEY,
      payment_intent_id TEXT UNIQUE NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'hkd',
      customer_email TEXT,
      metadata_payload TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      last_retry_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fulfill_queue_status
      ON payment_fulfillments_queue(status, retry_count);
  `);
}

function enqueue(payload) {
  const db = getDb();
  ensureSchema(db);
  const pi = String(payload.payment_intent_id || payload.paymentIntentId || "");
  if (!pi) throw new Error("payment_intent_id required");
  const existing = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE payment_intent_id=?").get(pi);
  if (existing) {
    db.prepare("UPDATE payment_fulfillments_queue SET error_message=?, metadata_payload=COALESCE(?,metadata_payload) WHERE id=?")
      .run(String(payload.error_message || ""), payload.metadata ? JSON.stringify(payload.metadata) : null, existing.id);
    return { ...existing, duplicated: true };
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO payment_fulfillments_queue
       (id,payment_intent_id,amount_cents,currency,customer_email,metadata_payload,error_message)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, pi, Math.round(Number(payload.amount_cents || 0)), String(payload.currency || "hkd").toLowerCase(),
    payload.customer_email || null, JSON.stringify(payload.metadata || {}), String(payload.error_message || ""));
  return db.prepare("SELECT * FROM payment_fulfillments_queue WHERE id=?").get(id);
}

function pending(limit = 50) {
  const db = getDb();
  ensureSchema(db);
  return db.prepare("SELECT * FROM payment_fulfillments_queue WHERE status='pending' AND retry_count < 5 ORDER BY created_at ASC LIMIT ?").all(limit);
}

function markResolved(id) {
  const db = getDb();
  ensureSchema(db);
  db.prepare("UPDATE payment_fulfillments_queue SET status='resolved', last_retry_at=datetime('now') WHERE id=?").run(id);
}

function markRetry(id, error) {
  const db = getDb();
  ensureSchema(db);
  const row = db.prepare("SELECT * FROM payment_fulfillments_queue WHERE id=?").get(id);
  if (!row) return null;
  const n = Number(row.retry_count || 0) + 1;
  const status = n >= 5 ? "failed_manual_review" : "pending";
  db.prepare("UPDATE payment_fulfillments_queue SET retry_count=?, status=?, error_message=?, last_retry_at=datetime('now') WHERE id=?")
    .run(n, status, String(error || "").slice(0, 500), id);
  return { ...row, retry_count: n, status };
}

async function reconcile(handler, { limit = 50 } = {}) {
  const rows = pending(limit);
  const result = { scanned: rows.length, resolved: 0, retried: 0, failed: 0, results: [] };
  for (const row of rows) {
    let meta = {};
    try { meta = JSON.parse(row.metadata_payload || "{}"); } catch (e) {}
    try {
      const out = await handler({ ...row, metadata: meta });
      if (out && out.ok === false) throw new Error(out.error || "fulfill failed");
      markResolved(row.id);
      result.resolved++;
      result.results.push({ id: row.id, status: "resolved" });
    } catch (e) {
      const r = markRetry(row.id, e.message);
      if (r && r.status === "failed_manual_review") result.failed++;
      else result.retried++;
      result.results.push({ id: row.id, status: r?.status || "pending", error: e.message });
    }
  }
  return result;
}

module.exports = {
  ensureSchema, enqueue, pending, markResolved, markRetry, reconcile,
  // 規格別名（工單用語）
  enqueueFailedFulfillment: enqueue,
  processFulfillmentQueue: (handler, opts) => reconcile(handler, opts),
};
