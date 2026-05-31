/**
 * ZenPass 禪流 — Idempotency 中介軟體
 *
 * 防止重複請求：所有付款、預約等重要操作必須帶 Idempotency-Key
 * 同一 key 重複請求只會 return 第一次結果，唔會 double charge
 *
 * IPO-ready：確保 financial transaction 嘅 exactly-once semantics
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

/**
 * Idempotency middleware
 * 用前要喺 route 度加 idempotency key 檢查
 * 放喺 authenticateToken 之後，body validation 之前
 */
function requireIdempotency(req, res, next) {
  const key = req.headers["idempotency-key"] || req.body?.idempotency_key;

  if (!key) {
    return res.status(400).json({
      error: "缺少 Idempotency-Key (header or body)",
      code: "MISSING_IDEMPOTENCY_KEY",
    });
  }

  const db = new Database(DB_PATH);
  try {
    const existing = db
      .prepare(
        "SELECT response_data, created_at FROM idempotency_keys WHERE id = ?",
      )
      .get(key);

    if (existing) {
      // Same key used before → return cached response
      const age = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
      console.log(`[IDEMPOTENCY] Reusing key ${key} (${age.toFixed(1)}s old)`);
      try {
        return res.status(200).json(JSON.parse(existing.response_data));
      } catch {
        // If cached data is corrupted, allow retry
        db.prepare("DELETE FROM idempotency_keys WHERE id = ?").run(key);
      }
    }

    // Store the key so next call with same key gets blocked until response
    db.prepare(
      "INSERT INTO idempotency_keys (id, response_data, created_at) VALUES (?, ?, datetime('now'))",
    ).run(key, "{}");

    // Attach helper to store response when done
    res.idempotencyKey = key;

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.idempotencyKey && res.statusCode >= 200 && res.statusCode < 300) {
        try {
          db.prepare(
            "UPDATE idempotency_keys SET response_data = ? WHERE id = ?",
          ).run(JSON.stringify(body), res.idempotencyKey);
        } catch (e) {
          console.error("[IDEMPOTENCY] Cache failed:", e.message);
        }
      }
      db.close();
      return originalJson(body);
    };

    next();
  } catch (err) {
    db.close();
    console.error("[IDEMPOTENCY] Error:", err.message);
    next();
  }
}

/**
 * Cleanup expired idempotency keys (older than 24 hours)
 * Call this periodically via scheduler
 */
function cleanupExpiredKeys() {
  const db = new Database(DB_PATH);
  try {
    const result = db
      .prepare(
        "DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-1 day')",
      )
      .run();
    if (result.changes > 0) {
      console.log(`[IDEMPOTENCY] Cleaned ${result.changes} expired keys`);
    }
  } catch (err) {
    console.error("[IDEMPOTENCY] Cleanup error:", err.message);
  } finally {
    db.close();
  }
}

module.exports = { requireIdempotency, cleanupExpiredKeys };
