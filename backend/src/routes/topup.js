/**
 * ZenPass 禪流 — Auto Top-up 路由
 *
 * 自動加購 Credits 功能：
 * - GET  /api/topup/config        — 睇 Auto Top-up 設定
 * - PUT  /api/topup/config        — 設定 Auto Top-up
 * - POST /api/topup/execute       — 手動觸發一次 check + top-up
 *
 * Bundle 定價：
 *   輕量包: 10cr / HK$100
 *   標準包: 25cr / HK$225
 *   超值包: 55cr / HK$440
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken } = require("../middleware/auth");
const { getDb } = require("../services/database");
const { sendNotification } = require("../services/notification");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();


// Bundle definitions
const BUNDLES = {
  light: { credits: 10, price: 100, label: "輕量包" },
  standard: { credits: 25, price: 225, label: "標準包" },
  premium: { credits: 55, price: 440, label: "超值包" },
};

// ===== 資料庫 Migration =====
function ensureTopupTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_topup_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 0,
      threshold INTEGER DEFAULT 10,
      bundle_type TEXT DEFAULT 'standard',
      created_at TEXT DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Top-up execution history
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_topup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      bundle_type TEXT NOT NULL,
      credits_added INTEGER NOT NULL,
      amount_paid REAL NOT NULL,
      status TEXT DEFAULT 'completed' CHECK(status IN ('completed','failed','pending')),
      trigger TEXT DEFAULT 'auto' CHECK(trigger IN ('auto','manual')),
      created_at TEXT DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

// Run migration on first load
ensureTopupTable();

// ===== 1. GET /api/topup/config — 睇設定 =====
router.get("/config", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    let config = db
      .prepare("SELECT * FROM auto_topup_config WHERE user_id = ?")
      .get(req.user.id);

    if (!config) {
      // Return defaults
      return res.json({
        enabled: false,
        threshold: 10,
        bundle_type: "standard",
        bundle: BUNDLES.standard,
        created_at: null,
        updated_at: null,
      });
    }

    res.json({
      enabled: config.enabled === 1,
      threshold: config.threshold,
      bundle_type: config.bundle_type,
      bundle: BUNDLES[config.bundle_type] || BUNDLES.standard,
      created_at: config.created_at,
      updated_at: config.updated_at,
    });
  } catch (err) {
    console.error("[TOPUP] /config GET error:", err.message);
    res.status(500).json({ success: false, error: "無法獲取 Auto Top-up 設定" });
  }
});

// ===== 2. PUT /api/topup/config — 設定 =====
router.put("/config", authenticateToken, (req, res) => {
  try {
    const { enabled, threshold, bundle } = req.body;

    // Validate bundle
    if (bundle && !BUNDLES[bundle]) {
      return res.status(400).json({
        error: "無效嘅 bundle 類型",
        valid: Object.keys(BUNDLES),
      });
    }

    // Validate threshold
    if (threshold !== undefined) {
      const t = parseInt(threshold);
      if (isNaN(t) || t < 1 || t > 100) {
        return res.status(400).json({ success: false, error: "Threshold 必須喺 1-100 之間" });
      }
    }

    const db = getDb();
    const bundleType = bundle || "standard";
    const finalThreshold = threshold !== undefined ? parseInt(threshold) : 10;
    const finalEnabled = enabled !== undefined ? (enabled ? 1 : 0) : 0;

    // Upsert config
    db.prepare(
      `INSERT INTO auto_topup_config (user_id, enabled, threshold, bundle_type, updated_at)
       VALUES (?, ?, ?, ?, datetime('now', '+8 hours'))
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled,
         threshold = excluded.threshold,
         bundle_type = excluded.bundle_type,
         updated_at = datetime('now', '+8 hours')`,
    ).run(req.user.id, finalEnabled, finalThreshold, bundleType);

    // If enabled, check if immediate top-up needed
    let autoExecuted = null;
    if (finalEnabled) {
      autoExecuted = executeAutoTopup(req.user.id, bundleType, finalThreshold, "auto");
    }

    res.json({
      success: true,
      message: "Auto Top-up 設定已儲存",
      config: {
        enabled: finalEnabled === 1,
        threshold: finalThreshold,
        bundle_type: bundleType,
        bundle: BUNDLES[bundleType],
      },
      auto_executed: autoExecuted,
    });
  } catch (err) {
    console.error("[TOPUP] /config PUT error:", err.message);
    res.status(500).json({ success: false, error: "儲存設定失敗" });
  }
});

// ===== 3. POST /api/topup/execute — 手動觸發 =====
router.post("/execute", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const config = db
      .prepare("SELECT * FROM auto_topup_config WHERE user_id = ?")
      .get(req.user.id);

    if (!config || !config.enabled) {
      return res.status(400).json({
        error: "Auto Top-up 未啟用，請先設定",
        topup_skipped: true,
      });
    }

    const result = executeAutoTopup(req.user.id, config.bundle_type, config.threshold, "manual");

    if (!result) {
      return res.json({
        message: "✅ Credits 足夠，無需 top-up",
        credits_ok: true,
      });
    }

    res.json({
      success: true,
      message: `✅ 已自動加購 ${result.bundle.label}（+${result.credits_added} cr）`,
      ...result,
    });
  } catch (err) {
    console.error("[TOPUP] /execute error:", err.message);
    res.status(500).json({ success: false, error: "執行 Auto Top-up 失敗" });
  }
});

// ===== 4. GET /api/topup/history — Top-up 記錄 =====
router.get("/history", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const { limit = 20, offset = 0 } = req.query;

    const history = db
      .prepare(
        `SELECT * FROM auto_topup_history
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(req.user.id, parseInt(limit), parseInt(offset));

    const total = db
      .prepare(
        "SELECT COUNT(*) as count FROM auto_topup_history WHERE user_id = ?",
      )
      .get(req.user.id);

    res.json({ history, total: total.count });
  } catch (err) {
    console.error("[TOPUP] /history error:", err.message);
    res.status(500).json({ success: false, error: "無法獲取 Top-up 記錄" });
  }
});

// ===== 核心：執行 Auto Top-up =====
function executeAutoTopup(userId, bundleType, threshold, trigger = "auto") {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  try {
    const user = db
      .prepare("SELECT credits FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      console.error(`[TOPUP] User ${userId} not found`);
      return null;
    }

    const currentCredits = user.credits || 0;

    // If credits >= threshold, no top-up needed
    if (currentCredits >= threshold) {
      return null;
    }

    const bundle = BUNDLES[bundleType] || BUNDLES.standard;
    const creditsToAdd = bundle.credits;
    const amountPaid = bundle.price;

    // Deduct "payment" — in production this would use Stripe/fpx
    // For now, we add credits directly tracking as a transaction
    db.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").run(
      creditsToAdd,
      userId,
    );

    // Record in auto_topup_history
    const historyId = db
      .prepare(
        `INSERT INTO auto_topup_history (user_id, bundle_type, credits_added, amount_paid, status, trigger)
         VALUES (?, ?, ?, ?, 'completed', ?)`,
      )
      .run(userId, bundleType, creditsToAdd, amountPaid, trigger)
      .lastInsertRowid;

    // Record in transactions table
    db.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, description)
       VALUES (?, ?, 'credits_topup', ?, ?)`,
    ).run(
      uuidv4(),
      userId,
      amountPaid,
      `Auto Top-up: ${bundle.label}（+${creditsToAdd} cr, 閾值=${threshold}）`,
    );

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "topup",
        entityId: String(historyId),
        data: {
          user_id: userId,
          bundle_type: bundleType,
          credits_added: creditsToAdd,
          amount_paid: amountPaid,
          threshold,
          trigger,
          credits_before: currentCredits,
          credits_after: currentCredits + creditsToAdd,
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (topup):", bcErr.message);
    }

    // Send notification
    try {
      sendNotification("topup.auto_completed", {
        recipient: userId,
        data: {
          credits_added: creditsToAdd,
          bundle_label: bundle.label,
          amount_paid: amountPaid,
          new_balance: currentCredits + creditsToAdd,
          trigger,
        },
      });
    } catch (notifErr) {
      console.error("[TOPUP] Notification error:", notifErr.message);
    }

    console.log(
      `[TOPUP] ${trigger === "auto" ? "🤖" : "👆"} User ${userId}: ${bundle.label} +${creditsToAdd} cr (threshold=${threshold}, was ${currentCredits})`,
    );

    return {
      bundle,
      credits_added: creditsToAdd,
      amount_paid: amountPaid,
      credits_before: currentCredits,
      credits_after: currentCredits + creditsToAdd,
      threshold,
    };
  } catch (err) {
    console.error("[TOPUP] executeAutoTopup error:", err.message);
    return null;
  }
}

// ===== 暴露核心函數（供 scheduler 使用）=====
module.exports = router;
module.exports.executeAutoTopup = executeAutoTopup;
module.exports.BUNDLES = BUNDLES;
module.exports.ensureTopupTable = ensureTopupTable;
