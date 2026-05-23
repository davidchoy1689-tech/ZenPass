/**
 * ZenPass 禪流 - 定價系統 API
 * 管理員可隨時調整會籍價格、Credit 消耗、加購點數
 */

const express = require("express");
const router = express.Router();
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "..", "data", "zenpass.db");

// ===== Helper: get all pricing config =====
function getAllConfig() {
  const db = new Database(DB_PATH);
  const rows = db.prepare("SELECT key, value FROM pricing_config").all();
  db.close();
  const config = {};
  rows.forEach((r) => {
    try { config[r.key] = JSON.parse(r.value); }
    catch (e) { config[r.key] = r.value; }
  });
  return config;
}

// ===== Helper: get pricing config by category =====
function getConfigByCategory(category) {
  const db = new Database(DB_PATH);
  const rows = db.prepare("SELECT key, value, label FROM pricing_config WHERE category = ?").all(category);
  db.close();
  const result = {};
  rows.forEach((r) => {
    try { result[r.key] = JSON.parse(r.value); }
    catch (e) { result[r.key] = r.value; }
  });
  return result;
}

// ===== GET /api/pricing/all — 取得全部定價 =====
router.get("/all", (req, res) => {
  try {
    const config = getAllConfig();
    // Build plans object (compatible with frontend expectations)
    const plans = {};
    const planTypes = ['lite', 'standard', 'silver', 'gold'];
    planTypes.forEach(type => {
      const name = config['plan_' + type + '_name'];
      plans[type] = {
        name: name?.zh || type,
        name_en: name?.en || type,
        price_hkd: parseInt(config['plan_' + type + '_price']) || 0,
        credits_granted: parseInt(config['plan_' + type + '_credits']) || 0,
        duration_days: 30,
        description: config['plan_' + type + '_description']?.zh || '',
        features: config['plan_' + type + '_features'] || [],
        avg_price: parseInt(config['plan_' + type + '_price']) / Math.max(parseInt(config['plan_' + type + '_credits']), 1) || 0,
        popular: config['plan_' + type + '_popular'] === true || config['plan_' + type + '_popular'] === 'true',
      };
      if (plans[type].credits_granted === 0) plans[type].avg_price = 0;
    });

    // Build credit packages
    const packages = [];
    const packSizes = ['small', 'medium', 'large'];
    packSizes.forEach(size => {
      const label = config['credit_pack_' + size + '_label'];
      packages.push({
        credits: parseInt(config['credit_pack_' + size + '_credits']) || 0,
        price: parseInt(config['credit_pack_' + size + '_price']) || 0,
        label: label?.zh || size,
        bonus: parseInt(config['credit_pack_' + size + '_bonus']) || 0,
        popular: size === 'medium',
      });
    });

    res.json({
      plans,
      packages,
      credit_costs: {
        basic: config.credit_cost_basic || [3, 5, 8],
        standard: config.credit_cost_standard || [5, 8, 12],
        premium: config.credit_cost_premium || [8, 12, 18],
      },
      credit_validity_days: parseInt(config.credit_validity_days) || 180,
      currency: config.currency || 'HKD',
    });
  } catch (err) {
    console.error("獲取定價錯誤:", err);
    res.status(500).json({ error: "無法獲取定價資料" });
  }
});

// ===== GET /api/pricing/plans — 取得會籍方案 (compatible with frontend) =====
router.get("/plans", (req, res) => {
  try {
    const config = getAllConfig();
    const plans = {};
    const planTypes = ['lite', 'standard', 'silver', 'gold'];
    planTypes.forEach(type => {
      const name = config['plan_' + type + '_name'];
      plans[type] = {
        name: name?.zh || type,
        name_en: name?.en || type,
        price_hkd: parseInt(config['plan_' + type + '_price']) || 0,
        credits_granted: parseInt(config['plan_' + type + '_credits']) || 0,
        duration_days: 30,
        description: config['plan_' + type + '_description']?.zh || '',
        features: config['plan_' + type + '_features'] || [],
        avg_price: parseInt(config['plan_' + type + '_price']) / Math.max(parseInt(config['plan_' + type + '_credits']), 1) || 0,
        popular: config['plan_' + type + '_popular'] === true || config['plan_' + type + '_popular'] === 'true',
      };
      if (plans[type].credits_granted === 0) plans[type].avg_price = 0;
    });
    res.json({ plans });
  } catch (err) {
    console.error("獲取會籍方案錯誤:", err);
    res.status(500).json({ error: "無法獲取會籍方案" });
  }
});

// ===== GET /api/pricing/packages — 取得加購點數方案 =====
router.get("/packages", (req, res) => {
  try {
    const config = getAllConfig();
    const packages = [];
    const packSizes = ['small', 'medium', 'large'];
    packSizes.forEach(size => {
      const label = config['credit_pack_' + size + '_label'];
      packages.push({
        credits: parseInt(config['credit_pack_' + size + '_credits']) || 0,
        price: parseInt(config['credit_pack_' + size + '_price']) || 0,
        label: label?.zh || size,
        bonus: parseInt(config['credit_pack_' + size + '_bonus']) || 0,
        popular: size === 'medium',
      });
    });
    res.json({ packages });
  } catch (err) {
    console.error("獲取點數方案錯誤:", err);
    res.status(500).json({ error: "無法獲取點數方案" });
  }
});

// ===== GET /api/admin/pricing — 管理員睇全部定價設定 =====
router.get("/admin/pricing", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const rows = db.prepare("SELECT key, value, label, category FROM pricing_config ORDER BY category, key").all();
    db.close();
    // Group by category
    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push({
        key: r.key,
        value: r.value,
        label: r.label,
      });
    });
    res.json({ categories: grouped });
  } catch (err) {
    console.error("獲取定價設定錯誤:", err);
    res.status(500).json({ error: "無法獲取定價設定" });
  }
});

// ===== PUT /api/admin/pricing — 管理員更新定價 =====
router.put("/admin/pricing", (req, res) => {
  try {
    const { updates } = req.body; // { key: value, ... }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: "請提供更新資料" });
    }

    const db = new Database(DB_PATH);
    const update = db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = ?");

    const updateMany = db.transaction(() => {
      let count = 0;
      for (const [key, value] of Object.entries(updates)) {
        const result = update.run(String(value), key);
        if (result.changes > 0) count++;
      }
      return count;
    });

    const updatedCount = updateMany();
    db.close();

    res.json({ success: true, updated: updatedCount });
  } catch (err) {
    console.error("更新定價錯誤:", err);
    res.status(500).json({ error: "更新定價失敗" });
  }
});

module.exports = router;
