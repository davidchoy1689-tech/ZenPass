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
    try {
      config[r.key] = JSON.parse(r.value);
    } catch (e) {
      config[r.key] = r.value;
    }
  });
  return config;
}

// ===== Helper: get pricing config by category =====
function getConfigByCategory(category) {
  const db = new Database(DB_PATH);
  const rows = db
    .prepare("SELECT key, value, label FROM pricing_config WHERE category = ?")
    .all(category);
  db.close();
  const result = {};
  rows.forEach((r) => {
    try {
      result[r.key] = JSON.parse(r.value);
    } catch (e) {
      result[r.key] = r.value;
    }
  });
  return result;
}

// ===== GET /api/pricing/all — 取得全部定價 =====
router.get("/all", (req, res) => {
  try {
    const config = getAllConfig();
    // Build plans object (compatible with frontend expectations)
    const plans = {};
    const planTypes = ["lite", "standard", "silver", "gold"];
    planTypes.forEach((type) => {
      const name = config["plan_" + type + "_name"];
      plans[type] = {
        name: name?.zh || type,
        name_en: name?.en || type,
        price_hkd: parseInt(config["plan_" + type + "_price"]) || 0,
        credits_granted: parseInt(config["plan_" + type + "_credits"]) || 0,
        duration_days: 30,
        description: config["plan_" + type + "_description"]?.zh || "",
        features: config["plan_" + type + "_features"] || [],
        avg_price:
          Math.round(
            parseInt(config["plan_" + type + "_price"]) /
              Math.max(parseInt(config["plan_" + type + "_credits"]), 1),
          ) || 0,
        popular:
          config["plan_" + type + "_popular"] === true ||
          config["plan_" + type + "_popular"] === "true",
      };
      if (plans[type].credits_granted === 0) plans[type].avg_price = 0;
    });

    // Build credit packages
    const packages = [];
    const packSizes = ["small", "medium", "large"];
    packSizes.forEach((size) => {
      const label = config["credit_pack_" + size + "_label"];
      packages.push({
        credits: parseInt(config["credit_pack_" + size + "_credits"]) || 0,
        price: parseInt(config["credit_pack_" + size + "_price"]) || 0,
        label: label?.zh || size,
        bonus: parseInt(config["credit_pack_" + size + "_bonus"]) || 0,
        popular: size === "medium",
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
      currency: config.currency || "HKD",
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
    const planTypes = ["lite", "standard", "silver", "gold"];
    planTypes.forEach((type) => {
      const name = config["plan_" + type + "_name"];
      plans[type] = {
        name: name?.zh || type,
        name_en: name?.en || type,
        price_hkd: parseInt(config["plan_" + type + "_price"]) || 0,
        credits_granted: parseInt(config["plan_" + type + "_credits"]) || 0,
        duration_days: 30,
        description: config["plan_" + type + "_description"]?.zh || "",
        features: config["plan_" + type + "_features"] || [],
        avg_price:
          Math.round(
            parseInt(config["plan_" + type + "_price"]) /
              Math.max(parseInt(config["plan_" + type + "_credits"]), 1),
          ) || 0,
        popular:
          config["plan_" + type + "_popular"] === true ||
          config["plan_" + type + "_popular"] === "true",
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
    const packSizes = ["small", "medium", "large"];
    packSizes.forEach((size) => {
      const label = config["credit_pack_" + size + "_label"];
      packages.push({
        credits: parseInt(config["credit_pack_" + size + "_credits"]) || 0,
        price: parseInt(config["credit_pack_" + size + "_price"]) || 0,
        label: label?.zh || size,
        bonus: parseInt(config["credit_pack_" + size + "_bonus"]) || 0,
        popular: size === "medium",
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
    const rows = db
      .prepare(
        "SELECT key, value, label, category FROM pricing_config ORDER BY category, key",
      )
      .all();
    db.close();
    // Group by category
    const grouped = {};
    rows.forEach((r) => {
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
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "請提供更新資料" });
    }

    const db = new Database(DB_PATH);
    const update = db.prepare(
      "UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = ?",
    );

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


// ===== GET /api/pricing/dynamic — 動態時段定價 =====
// 根據剩餘名額自動調整 Credit 消耗
router.get('/dynamic', function(req, res) {
  try {
    var db = new Database(DB_PATH);
    var now = new Date().toISOString();
    
    // Get upcoming schedules with enrollment data
    var schedules = db.prepare(`
      SELECT cs.id, cs.class_id, cs.start_time, cs.enrolled_count, cs.max_participants,
             c.title, c.category, c.credits_cost as base_cost
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      WHERE cs.start_time > ? AND cs.status = 'active' AND c.status = 'active'
      ORDER BY cs.start_time
      LIMIT 100
    `).all(now);

    // Get pricing rules
    var configRows = db.prepare('SELECT key, value FROM pricing_config').all();
    var config = {};
    configRows.forEach(function(r) { config[r.key] = r.value; });

    var peakThreshold = parseInt(config.peak_threshold_hour || '17');
    var peakEndThreshold = parseInt(config.peak_end_hour || '21');
    var offPeakDays = (config.off_peak_days || '0,6').split(',').map(function(s) { return parseInt(s); });
    var discountFill = parseFloat(config.dynamic_fill_discount || '0.8');
    var surchargeDemand = parseFloat(config.dynamic_demand_surcharge || '1.2');

    var results = schedules.map(function(s) {
      var start = new Date(s.start_time);
      var hour = start.getHours();
      var day = start.getDay();
      var enrolled = s.enrolled_count || 0;
      var capacity = s.max_participants || 20;
      var fillRate = capacity > 0 ? enrolled / capacity : 0;
      
      // Base tier from config
      var baseCost = s.base_cost || 12;
      
      // Determine time tier
      var isOffPeak = offPeakDays.indexOf(day) >= 0 || hour < 9 || hour >= 21;
      var isPeak = hour >= peakThreshold && hour < peakEndThreshold && offPeakDays.indexOf(day) < 0;
      var isStandard = !isOffPeak && !isPeak;
      
      var tierCredits;
      var tierName;
      if (isOffPeak) {
        tierCredits = parseInt(config.off_peak_credits || '12');
        tierName = 'off_peak';
      } else if (isPeak) {
        tierCredits = parseInt(config.peak_credits || '15');
        tierName = 'peak';
      } else {
        tierCredits = parseInt(config.standard_credits || '12');
        tierName = 'standard';
      }
      
      // Dynamic adjustment based on fill rate
      var dynamicMultiplier = 1.0;
      if (fillRate < 0.3) {
        // Low fill → discount to fill up
        dynamicMultiplier = discountFill;
      } else if (fillRate > 0.85) {
        // High fill → surcharge (demand pricing)
        dynamicMultiplier = surchargeDemand;
      }
      
      var dynamicCredits = Math.round(tierCredits * dynamicMultiplier);
      
      return {
        schedule_id: s.id,
        class_id: s.class_id,
        title: s.title,
        category: s.category,
        start_time: s.start_time,
        enrolled: enrolled,
        capacity: capacity,
        fill_rate: Math.round(fillRate * 100) + '%',
        base_cost: baseCost,
        time_tier: tierName,
        static_cost: tierCredits,
        dynamic_cost: Math.max(6, dynamicCredits),
        multiplier: dynamicMultiplier
      };
    });

    db.close();
    res.json({ schedules: results, rules: {
      peak_hours: peakThreshold + ':00-' + peakEndThreshold + ':00',
      off_peak_days: ['Sat', 'Sun'],
      fill_discount: discountFill,
      demand_surcharge: surchargeDemand
    }});
  } catch(err) {
    console.error('[PRICING] dynamic error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
