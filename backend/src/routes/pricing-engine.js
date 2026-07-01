/**
 * ZenPass 禪流 - Dynamic Pricing Engine API
 * 動態定價查詢與管理
 */

const express = require("express");
const router = express.Router();
const { getDb } = require("../services/database");
const { calculatePrice, getActiveRules, saveRules, DEFAULT_RULES } = require("../services/pricing-engine");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

// ===== GET /api/pricing/estimate — 估算動態價格 =====
router.get("/estimate", (req, res) => {
  try {
    const { class_id, schedule_id } = req.query;

    if (!class_id && !schedule_id) {
      return res.status(400).json({ success: false, error: "請提供 class_id 或 schedule_id" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    let scheduleInfo;
    let basePrice;

    if (schedule_id) {
      scheduleInfo = db
        .prepare(
          `SELECT cs.id as schedule_id, cs.class_id, cs.start_time, cs.enrolled_count, cs.max_participants,
                  c.title, c.category, c.credits_cost as base_cost
           FROM class_schedules cs
           JOIN classes c ON cs.class_id = c.id
           WHERE cs.id = ? AND cs.status = 'active'`
        )
        .get(schedule_id);
    } else {
      // Use upcoming schedule for this class
      scheduleInfo = db
        .prepare(
          `SELECT cs.id as schedule_id, cs.class_id, cs.start_time, cs.enrolled_count, cs.max_participants,
                  c.title, c.category, c.credits_cost as base_cost
           FROM class_schedules cs
           JOIN classes c ON cs.class_id = c.id
           WHERE cs.class_id = ? AND cs.start_time > datetime('now') AND cs.status = 'active'
           ORDER BY cs.start_time ASC
           LIMIT 1`
        )
        .get(class_id);
    }

    if (!scheduleInfo) {
      return res.status(404).json({ success: false, error: "找不到該課堂或時間表" });
    }

    basePrice = scheduleInfo.base_cost || 12;

    // Check for partner overrides
    let partnerOverrides = null;
    const classData = db
      .prepare("SELECT partner_id FROM classes WHERE id = ?")
      .get(scheduleInfo.class_id);
    if (classData && classData.partner_id) {
      const partnerRules = db
        .prepare("SELECT pricing_rules FROM partner_settings WHERE partner_id = ?")
        .get(classData.partner_id);
      if (partnerRules && partnerRules.pricing_rules) {
        try {
          partnerOverrides = { rules: JSON.parse(partnerRules.pricing_rules) };
        } catch (e) {
          // invalid JSON, ignore
        }
      }
    }

    const result = calculatePrice(basePrice, scheduleInfo, { partner_overrides: partnerOverrides });

    res.json({
      success: true,
      class_id: scheduleInfo.class_id,
      schedule_id: scheduleInfo.schedule_id,
      class_title: scheduleInfo.title,
      start_time: scheduleInfo.start_time,
      basePrice: result.basePrice,
      adjustments: result.adjustments,
      finalPrice: result.finalPrice,
      fill_rate: result.fill_rate,
      total_discount_percent: result.total_discount_percent,
      currency: "credits",
    });
  } catch (err) {
    console.error("估算動態價格錯誤:", err);
    res.status(500).json({ success: false, error: "估算動態價格失敗" });
  }
});

// ===== GET /api/pricing/estimate/batch — 批量估算（多個 schedule） =====
router.get("/estimate/batch", (req, res) => {
  try {
    const { schedule_ids } = req.query;
    if (!schedule_ids) {
      return res.status(400).json({ success: false, error: "請提供 schedule_ids" });
    }

    const ids = String(schedule_ids).split(",").filter(Boolean);
    if (ids.length === 0 || ids.length > 50) {
      return res.status(400).json({ success: false, error: "請提供 1-50 個 schedule_id" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    const placeholders = ids.map(() => "?").join(",");
    const schedules = db
      .prepare(
        `SELECT cs.id as schedule_id, cs.class_id, cs.start_time, cs.enrolled_count, cs.max_participants,
                c.title, c.category, c.credits_cost as base_cost
         FROM class_schedules cs
         JOIN classes c ON cs.class_id = c.id
         WHERE cs.id IN (${placeholders}) AND cs.status = 'active'`
      )
      .all(...ids);

    const results = schedules.map((s) => {
      const basePrice = s.base_cost || 12;
      const pricing = calculatePrice(basePrice, {
        start_time: s.start_time,
        enrolled_count: s.enrolled_count,
        max_participants: s.max_participants,
        class_id: s.class_id,
        schedule_id: s.schedule_id,
      });
      return {
        schedule_id: s.schedule_id,
        class_id: s.class_id,
        title: s.title,
        basePrice: pricing.basePrice,
        finalPrice: pricing.finalPrice,
        adjustments: pricing.adjustments,
        fill_rate: pricing.fill_rate,
      };
    });

    res.json({ success: true, results });
  } catch (err) {
    console.error("批量估算錯誤:", err);
    res.status(500).json({ success: false, error: "批量估算失敗" });
  }
});

// ===== GET /api/pricing/rules — 取得當前定價規則 =====
router.get("/rules", (req, res) => {
  try {
    const activeRules = getActiveRules();
    res.json({
      success: true,
      rules: activeRules,
      rule_count: activeRules.length,
    });
  } catch (err) {
    console.error("獲取定價規則錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取定價規則" });
  }
});

// ===== PUT /api/pricing/rules — 儲存定價規則（管理員用） =====
router.put("/rules", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { rules } = req.body;
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({ success: false, error: "請提供有效嘅規則陣列" });
    }

    // Validate each rule
    for (const rule of rules) {
      if (!rule.type || !["time", "occupancy", "early_bird", "last_minute"].includes(rule.type)) {
        return res.status(400).json({ success: false, error: `無效嘅規則類型: ${rule.type}` });
      }
      if (!rule.multiplier || rule.multiplier <= 0) {
        return res.status(400).json({ success: false, error: `規則 ${rule.id || rule.type} 嘅 multiplier 必須大於 0` });
      }
    }

    const count = saveRules(rules);

    // ⛓️ Blockchain audit trail
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "pricing",
        entityId: "rules",
        data: {
          adminId: req.user.id,
          rule_count: rules.length,
          action: "update_pricing_rules",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write pricing rules block:", blockErr.message);
    }

    res.json({
      success: true,
      message: `✅ 已儲存 ${count} 條定價規則`,
      rules_updated: count,
    });
  } catch (err) {
    console.error("儲存定價規則錯誤:", err);
    res.status(500).json({ success: false, error: "儲存定價規則失敗" });
  }
});

// ===== POST /api/pricing/rules/reset — 重置為預設規則（管理員用） =====
router.post("/rules/reset", authenticateToken, requireAdmin, (req, res) => {
  try {
    const count = saveRules(DEFAULT_RULES);

    res.json({
      success: true,
      message: `✅ 已重置為 ${count} 條預設定價規則`,
      rules: DEFAULT_RULES,
    });
  } catch (err) {
    console.error("重置定價規則錯誤:", err);
    res.status(500).json({ success: false, error: "重置定價規則失敗" });
  }
});

module.exports = router;
