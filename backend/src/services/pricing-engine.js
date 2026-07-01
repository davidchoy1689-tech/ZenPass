/**
 * ZenPass 禪流 - Dynamic Pricing Engine
 * Rule-based 動態定價系統
 */

const { getDb } = require("./database");

// ===== 預設定價規則 =====
const DEFAULT_RULES = [
  // 週末上午 85折
  { id: "weekend_morning", type: "time", days: [0, 6], hours: [9, 12], multiplier: 0.85, label: "週末上午優惠", active: true },
  // 週間放工時間 115%
  { id: "weekday_peak", type: "time", days: [1, 2, 3, 4, 5], hours: [17, 20], multiplier: 1.15, label: "繁忙時段附加費", active: true },
  // 滿座率 >80% 加10%
  { id: "high_occupancy", type: "occupancy", min: 0.8, multiplier: 1.10, label: "高滿座附加費", active: true },
  // 滿座率 <30% 減10%
  { id: "low_occupancy", type: "occupancy", max: 0.3, multiplier: 0.90, label: "低滿座優惠", active: true },
  // 7日前預約 85折
  { id: "early_bird", type: "early_bird", days_before: 7, multiplier: 0.85, label: "早鳥優惠", active: true },
  // 2小時前 75折
  { id: "last_minute", type: "last_minute", hours_before: 2, multiplier: 0.75, label: "最後一刻優惠", active: true },
];

/**
 * 從 DB 載入有效規則（若無則用預設值）
 */
function getActiveRules() {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT key, value FROM pricing_config WHERE key LIKE 'pricing_rule_%'")
      .all();

    if (rows.length === 0) return DEFAULT_RULES;

    const rules = [];
    for (const row of rows) {
      try {
        const rule = JSON.parse(row.value);
        if (rule.active !== false) rules.push(rule);
      } catch (e) {
        // skip invalid
      }
    }
    return rules.length > 0 ? rules : DEFAULT_RULES;
  } catch (e) {
    return DEFAULT_RULES;
  }
}

/**
 * Calculate dynamic price based on rules
 * @param {number} basePrice - 基礎價格（HKD 或 Credits）
 * @param {object} scheduleInfo - { schedule_id, start_time, enrolled_count, max_participants, class_id }
 * @param {object} options - { partner_overrides: { rules: array } }
 * @returns {{ finalPrice: number, adjustments: array, basePrice: number }}
 */
function calculatePrice(basePrice, scheduleInfo, options = {}) {
  const adjustments = [];

  // 使用 partner 自定義規則（如有）
  const rules = options.partner_overrides?.rules || getActiveRules();

  const now = new Date();
  const startTime = new Date(scheduleInfo.start_time);
  const dayOfWeek = startTime.getDay();
  const hour = startTime.getHours();

  // 滿座率
  const enrolled = scheduleInfo.enrolled_count || 0;
  const capacity = scheduleInfo.max_participants || 20;
  const fillRate = capacity > 0 ? enrolled / capacity : 0;

  // 距離上堂時間（小時）
  const hoursUntilClass = (startTime.getTime() - now.getTime()) / 3600000;

  let currentPrice = basePrice;

  for (const rule of rules) {
    let applies = false;
    let reason = "";

    switch (rule.type) {
      case "time":
        // 時段規則
        if (rule.days && rule.days.includes(dayOfWeek)) {
          if (rule.hours && rule.hours.length === 2) {
            if (hour >= rule.hours[0] && hour < rule.hours[1]) {
              applies = true;
              reason = rule.label || `時段調整`;
            }
          }
        }
        break;

      case "occupancy":
        // 滿座率規則
        if (rule.min !== undefined && fillRate >= rule.min) {
          applies = true;
          reason = rule.label || `滿座率 ${Math.round(fillRate * 100)}%`;
        } else if (rule.max !== undefined && fillRate <= rule.max) {
          applies = true;
          reason = rule.label || `低滿座率 ${Math.round(fillRate * 100)}%`;
        }
        break;

      case "early_bird":
        // 早鳥優惠
        if (hoursUntilClass >= (rule.days_before || 7) * 24) {
          applies = true;
          reason = rule.label || `${rule.days_before || 7}日前預約`;
        }
        break;

      case "last_minute":
        // 最後一刻優惠
        if (hoursUntilClass <= (rule.hours_before || 2) && hoursUntilClass > 0) {
          applies = true;
          reason = rule.label || `最後 ${rule.hours_before || 2} 小時`;
        }
        break;

      default:
        break;
    }

    if (applies) {
      const adjustment = {
        rule_id: rule.id || rule.type,
        label: reason,
        multiplier: rule.multiplier,
        description: getAdjustmentDescription(rule, startTime),
      };
      adjustments.push(adjustment);
      currentPrice *= rule.multiplier;
    }
  }

  // Round to nearest integer
  const finalPrice = Math.max(1, Math.round(currentPrice));

  return {
    basePrice,
    finalPrice,
    adjustments,
    fill_rate: Math.round(fillRate * 100),
    total_discount_percent: adjustments.length > 0
      ? Math.round((1 - adjustments.reduce((p, a) => p * a.multiplier, 1)) * 100)
      : 0,
  };
}

/**
 * 生成人類可讀嘅規則說明
 */
function getAdjustmentDescription(rule, startTime) {
  switch (rule.type) {
    case "time":
      const dayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
      const dayStr = startTime ? dayNames[startTime.getDay()] : "";
      if (rule.multiplier < 1) {
        return `${dayStr} 非繁忙時段優惠：減 ${Math.round((1 - rule.multiplier) * 100)}%`;
      } else {
        return `${dayStr} 繁忙時段附加費：加 ${Math.round((rule.multiplier - 1) * 100)}%`;
      }
    case "occupancy":
      if (rule.multiplier < 1) {
        return "低滿座率優惠，快啲嚟上堂啦！";
      } else {
        return "課程受歡迎，高滿座率附加費";
      }
    case "early_bird":
      return `早鳥優惠：提前 ${rule.days_before} 日預約，減 ${Math.round((1 - rule.multiplier) * 100)}%`;
    case "last_minute":
      return `最後一刻優惠：上堂前 ${rule.hours_before} 小時預約，減 ${Math.round((1 - rule.multiplier) * 100)}%`;
    default:
      return "";
  }
}

/**
 * 儲存規則到 DB
 */
function saveRules(rules) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO pricing_config (key, value, category, label) VALUES (?, ?, 'dynamic_pricing', ?)"
  );

  const transaction = db.transaction(() => {
    const now = new Date().toISOString();
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      upsert.run(
        `pricing_rule_${rule.id || i}`,
        JSON.stringify({ ...rule, updated_at: now }),
        rule.label || `Rule ${i + 1}`
      );
    }
    return rules.length;
  });

  return transaction();
}

module.exports = { calculatePrice, getActiveRules, saveRules, DEFAULT_RULES };
