/**
 * ZenPass 禪流 — Idempotency 中介軟體
 *
 * 防止重複請求：所有付款、預約等重要操作必須帶 Idempotency-Key
 * 同一 key 重複請求只會 return 第一次結果，唔會 double charge
 *
 * Fix: 使用 INSERT OR IGNORE 原子操作防止 race condition
 * 就算兩個完全相同 request 同一時間到，都只會處理一次
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
  db.pragma("foreign_keys = ON");

  try {
    // ─── Atomic insert-or-check ───────────────────────────────
    // INSERT OR IGNORE 係原子操作：如果 id 已存在就 ignore
    // SQLite 嘅 UNIQUE constraint 保證只有一個 request 可以成功 INSERT
    const result = db
      .prepare(
        "INSERT OR IGNORE INTO idempotency_keys (id, response_data, created_at) VALUES (?, '{}', datetime('now'))",
      )
      .run(key);

    if (result.changes === 0) {
      // ── Key 已存在 → 另一 request 已經佔用 ──
      // SELECT 現有 response，return cached data
      const existing = db
        .prepare("SELECT response_data, created_at FROM idempotency_keys WHERE id = ?")
        .get(key);

      if (existing) {
        const age = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
        console.log(`[IDEMPOTENCY] Reusing key ${key} (${age.toFixed(1)}s old)`);

        // Check if response is still empty (request still processing)
        if (existing.response_data === "{}" || !existing.response_data) {
          // Another request is still processing this key.
          // Return 409 Conflict so caller knows to retry.
          db.close();
          return res.status(409).json({
            error: "Request with this idempotency key is still being processed",
            code: "IDEMPOTENCY_IN_FLIGHT",
          });
        }

        try {
          db.close();
          return res.status(200).json(JSON.parse(existing.response_data));
        } catch {
          // Corrupted data: delete and let caller retry
          db.prepare("DELETE FROM idempotency_keys WHERE id = ?").run(key);
        }
      }
    }

    // ── 我哋成功建立咗呢個 key → 繼續處理 ──
    // 標記 key 以便後續 intercept res.json
    res.idempotencyKey = key;

    // Intercept res.json 以 cache response
    const originalJson = res.json.bind(res);
    let dbClosed = false;

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
      if (!dbClosed) {
        dbClosed = true;
        db.close();
      }
      return originalJson(body);
    };

    // 喺 response finish 時確保 DB close (for non-json responses / errors)
    const originalEnd = res.end.bind(res);
    res.end = function () {
      if (!dbClosed) {
        dbClosed = true;
        db.close();
      }
      return originalEnd.apply(res, arguments);
    };

    next();
  } catch (err) {
    console.error("[IDEMPOTENCY] Error:", err.message);
    try { db.close(); } catch (e) { /* ignore */ }
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
