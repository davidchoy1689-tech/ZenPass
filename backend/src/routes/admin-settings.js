/**
 * ZenPass — 系統參數中心 API（2026-11-17）
 *
 *   GET  /api/admin/settings            讀取全部分組參數（含預設值／最後更新時間）
 *   POST /api/admin/settings            批量更新 { updates: { key: value } }
 *   POST /api/admin/settings/reset      還原預設 { keys: [...] }
 *
 * 權限：
 *   - 讀取：admin 級以上（客服 admin 可看，方便解釋政策）
 *   - 修改：access = "ops"   → admin 級以上
 *           access = "super" → 只限 super_admin（金錢／安全／上線相關）
 * 全部改動寫 audit_log（settings.update）
 */
const express = require("express");
const router = express.Router();
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin, hasMinimumRole } = require("../middleware/auth");
const settings = require("../services/settings-service");

const EDIT_ROLES = ["super_admin", "platform_manager", "admin"];

function requireEditor(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: "需要登入認證" });
  if (!EDIT_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: "需要管理員權限" });
  }
  next();
}

router.get("/", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    res.json({ success: true, ...settings.describe(db) });
  } catch (err) {
    console.error("[SETTINGS] read:", err.message);
    res.status(500).json({ success: false, error: "讀取系統參數失敗" });
  }
});

router.post("/", authenticateToken, requireAdmin, requireEditor, (req, res) => {
  try {
    const db = getDb();
    const updates = (req.body && req.body.updates) || {};
    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ success: false, error: "沒有需要更新的參數" });

    const denied = [];
    for (const key of keys) {
      const item = settings.getItem(key);
      if (!item) return res.status(400).json({ success: false, error: `未註冊的參數：${key}` });
      if (item.access === "super" && !hasMinimumRole(req.user.role, "super_admin")) {
        denied.push(key);
      }
    }
    if (denied.length) {
      return res.status(403).json({
        success: false,
        error: "以下參數只限 super_admin 修改：" + denied.join("、"),
        code: "SUPER_ADMIN_REQUIRED",
        denied,
      });
    }

    const out = settings.setMany(db, updates, { actorId: req.user.id });
    res.json({ success: true, changed: out.changes.length, changes: out.changes });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("[SETTINGS] write:", err.message);
    res.status(status).json({ success: false, error: err.message, code: err.code, details: err.details });
  }
});

router.post("/reset", authenticateToken, requireAdmin, requireEditor, (req, res) => {
  try {
    const db = getDb();
    const keys = (req.body && req.body.keys) || [];
    const denied = keys.filter((k) => {
      const item = settings.getItem(k);
      return item && item.access === "super" && !hasMinimumRole(req.user.role, "super_admin");
    });
    if (denied.length) {
      return res.status(403).json({
        success: false,
        error: "以下參數只限 super_admin 還原：" + denied.join("、"),
        code: "SUPER_ADMIN_REQUIRED",
        denied,
      });
    }
    const out = settings.resetToDefaults(db, keys, { actorId: req.user.id });
    res.json({ success: true, values: out.values });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
  }
});

module.exports = router;
