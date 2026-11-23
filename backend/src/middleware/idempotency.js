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
const evlog = require("../services/event-log");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

/** 穩定序列化：物件 key 排序，確保同一個 body 永遠產生同一個 hash */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

/**
 * Idempotency middleware
 * 用前要喺 route 度加 idempotency key 檢查
 * 放喺 authenticateToken 之後，body validation 之前
 */
/** 啟動時確保欄位存在（避免第一次請求才 ALTER） */
function ensureSchema() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    const cols = db.prepare("PRAGMA table_info(idempotency_keys)").all().map((c) => c.name);
    if (!cols.includes("body_hash")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN body_hash TEXT");
    if (!cols.includes("status")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN status TEXT DEFAULT 'pending'");
    if (!cols.includes("user_id")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN user_id TEXT");
    if (!cols.includes("method")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN method TEXT");
    if (!cols.includes("path")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN path TEXT");
    if (!cols.includes("completed_at")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN completed_at TEXT");
    db.close();
  } catch (e) { /* 表未建立時忽略 */ }
}

/** SQLite datetime('now') 係 UTC 但冇 Z；直接 new Date() 會被當本地時間（HK）→ 年齡計錯 */
function utcAgeSec(sqliteDatetime) {
  const s = String(sqliteDatetime || "").trim();
  if (!s) return 0;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, (Date.now() - d.getTime()) / 1000);
}

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

  // 2026-11-14：body_hash（偵測同 key 但唔同 payload）idempotent migration
  try {
    const cols = db.prepare("PRAGMA table_info(idempotency_keys)").all().map((c) => c.name);
    if (!cols.includes("body_hash")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN body_hash TEXT");
    if (!cols.includes("status")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN status TEXT DEFAULT 'pending'");
    if (!cols.includes("user_id")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN user_id TEXT");
    if (!cols.includes("method")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN method TEXT");
    if (!cols.includes("path")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN path TEXT");
    if (!cols.includes("completed_at")) db.exec("ALTER TABLE idempotency_keys ADD COLUMN completed_at TEXT");
  } catch (e) { /* 表可能未建立，忽略 */ }

  const bodyHash = "sha256:" + require("crypto")
    .createHash("sha256")
    .update(stableStringify(req.body || {}))
    .digest("hex");
  const userId = req.user && req.user.id ? String(req.user.id) : null;
  const method = String(req.method || "").toUpperCase();
  const path = String(req.originalUrl || req.path || "").split("?")[0];

  try {
    // ─── Atomic insert-or-check ───────────────────────────────
    // INSERT OR IGNORE 係原子操作：如果 id 已存在就 ignore
    // SQLite 嘅 UNIQUE constraint 保證只有一個 request 可以成功 INSERT
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys
           (id, response_data, body_hash, status, user_id, method, path, created_at)
         VALUES (?, '{}', ?, 'pending', ?, ?, ?, datetime('now'))`,
      )
      .run(key, bodyHash, userId, method, path);

    if (result.changes === 0) {
      // ── Key 已存在 → 另一 request 已經佔用 ──
      // SELECT 現有 response，return cached data
      const existing = db
        .prepare("SELECT response_data, created_at, body_hash, status, user_id, method, path FROM idempotency_keys WHERE id = ?")
        .get(key);

      if (existing) {
        // 唔同用戶重用同一個 key → 拒絕（防止猜 key 讀取別人 response）
        if (existing.user_id && userId && String(existing.user_id) !== userId) {
          evlog.warn("idem_user_mismatch", { key, owner: existing.user_id, requester: userId });
          db.close();
          return res.status(403).json({
            success: false,
            error: "Idempotency-Key 屬於其他用戶",
            code: "IDEMPOTENCY_KEY_USER_MISMATCH",
          });
        }
        // 舊資料未記錄 user_id → 首次由登入用戶使用時補上
        if (!existing.user_id && userId) {
          try {
            db.prepare("UPDATE idempotency_keys SET user_id=? WHERE id=?").run(userId, key);
          } catch (e) { /* ignore */ }
        }
        // 同 key 但 payload 唔同 → 拒絕（避免「改咗電話但重播舊 booking」）
        if (existing.body_hash && existing.body_hash !== bodyHash) {
          evlog.warn("idem_mismatch", { key });
          db.close();
          return res.status(409).json({
            success: false,
            error: "同一個 Idempotency-Key 唔可以用於唔同嘅預約內容",
            code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY",
          });
        }
        // 上次失敗／已過期 → 允許同一個 key 重新開始（唔可以 DELETE，只 update）
        if (existing.status === "failed" || existing.status === "expired") {
          db.prepare("UPDATE idempotency_keys SET status='pending', response_data='{}', body_hash=? WHERE id=?").run(bodyHash, key);
          evlog.info("idem_retry", { key, previous: existing.status });
        } else {

        const age = utcAgeSec(existing.created_at);
        console.log(`[IDEMPOTENCY] Reusing key ${key} (${age.toFixed(1)}s old)`);
        evlog.info("idem_hit", { key, age_sec: Math.round(age) });

        // Check if response is still empty (request still processing)
        let takenOver = false;
        if (existing.response_data === "{}" || !existing.response_data) {
          // 卡住嘅 pending（>180s，例如 process 被殺）→ 允許接手重試，避免永久鎖死
          if (age > Number(process.env.IDEMPOTENCY_STALE_SEC || 180)) {
            db.prepare(
              "UPDATE idempotency_keys SET status='pending', response_data='{}', body_hash=?, user_id=? WHERE id=?",
            ).run(bodyHash, userId, key);
            evlog.warn("idem_stale_takeover", { key, age_sec: Math.round(age) });
            takenOver = true;
          } else {
            // 另一個 request 仍處理中 → 409，client 可用同一 key 短暫重試
            db.close();
            return res.status(409).json({
              error: "Request with this idempotency key is still being processed",
              code: "IDEMPOTENCY_IN_FLIGHT",
              retry_after_sec: 1,
            });
          }
        }

        if (!takenOver) {
          let parsed;
          try {
            parsed = JSON.parse(existing.response_data);
          } catch {
            // 資料損壞：標記 failed，令 caller 可以重試（唔可以 DELETE，DB trigger 會擋）
            db.prepare("UPDATE idempotency_keys SET status='failed', response_data='{}' WHERE id = ?").run(key);
            parsed = undefined;
          }
          if (parsed !== undefined) {
            db.close();
            return res.status(200).json(parsed);
          }
        }
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
            "UPDATE idempotency_keys SET response_data = ?, status='completed', completed_at=datetime('now') WHERE id = ?",
          ).run(JSON.stringify(body), res.idempotencyKey);
        } catch (e) {
          console.error("[IDEMPOTENCY] Cache failed:", e.message);
        }
      } else if (res.idempotencyKey) {
        // 失敗請求唔應該留低空 key（否則同 key 重試會永遠 409 IN_FLIGHT）
        try {
          // 唔可以 DELETE（財務表 trigger 擋）→ 標記 failed，同 key 下次可以重試
          db.prepare("UPDATE idempotency_keys SET status='failed' WHERE id = ?").run(res.idempotencyKey);
        } catch (e) { /* ignore */ }
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

/**
 * optionalIdempotency — 有帶 Idempotency-Key 才做去重，冇帶照常處理
 * 用於「連點兩次都唔想開兩組班」但又唔想硬性 400 嘅端點
 */
function optionalIdempotency(req, res, next) {
  const key = req.headers["idempotency-key"] || (req.body && req.body.idempotency_key);
  if (!key) return next();
  return requireIdempotency(req, res, next);
}

function cleanupExpiredKeys() {
  const db = new Database(DB_PATH);
  try {
    const result = db
      .prepare(
        "UPDATE idempotency_keys SET status='expired' WHERE status <> 'expired' AND created_at < datetime('now', '-7 day')",
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

module.exports = {
  optionalIdempotency,
  requireIdempotency,
  cleanupExpiredKeys,
  ensureSchema,
};
