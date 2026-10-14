/**
 * ZenPass v2.1 — Outbox（可靠事件流）
 *
 * 交易時先寫入 outbox（同交易一齊），再由 dispatcher 非同步派發。
 * 避免「做咗動作但通知/下游失敗」嘅不一致。non-throwing。
 */
const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

function enqueue({ topic, refType, refId, payload }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO outbox_events (id, topic, ref_type, ref_id, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        uuidv4(),
        topic,
        refType || null,
        refId || null,
        payload ? JSON.stringify(payload) : null,
      );
    return true;
  } catch (e) {
    console.error("⚠️ [OUTBOX] enqueue failed:", e.message);
    return false;
  }
}

function pending(limit = 100) {
  try {
    return getDb()
      .prepare("SELECT * FROM outbox_events WHERE status = 'pending' ORDER BY created_at LIMIT ?")
      .all(limit);
  } catch (e) {
    return [];
  }
}

function markDispatched(id) {
  try {
    return getDb()
      .prepare("UPDATE outbox_events SET status='dispatched', dispatched_at=datetime('now'), attempts=attempts+1 WHERE id=?")
      .run(id).changes > 0;
  } catch (e) {
    return false;
  }
}

function markFailed(id) {
  try {
    return getDb()
      .prepare("UPDATE outbox_events SET status='failed', attempts=attempts+1 WHERE id=?")
      .run(id).changes > 0;
  } catch (e) {
    return false;
  }
}

function counts() {
  try {
    const rows = getDb()
      .prepare("SELECT status, COUNT(*) c FROM outbox_events GROUP BY status")
      .all();
    const out = {};
    rows.forEach((r) => (out[r.status] = r.c));
    return out;
  } catch (e) {
    return {};
  }
}

module.exports = { enqueue, pending, markDispatched, markFailed, counts };
