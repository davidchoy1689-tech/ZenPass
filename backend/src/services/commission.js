/**
 * ZenPass 佣金計算引擎
 * 根據佣金計劃自動計算每筆交易嘅分佣
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// 佣金計劃定義
const PLANS = {
  course: {
    // 課程佣金
    basic: { rate: 0.25, label: "Basic 25%" },
    standard: { rate: 0.18, label: "Standard 18%" },
    premium: { rate: 0.12, label: "Premium 12%" },
  },
  rental: {
    // 租場佣金
    basic: { rate: 0.15, label: "Basic 15%" },
    standard: { rate: 0.12, label: "Standard 12%" },
    premium: { rate: 0.08, label: "Premium 8%" },
  },
};

// ===== 課程佣金：學生俾學費 =====
function calcCourseCommission(amount, planKey) {
  const plan = PLANS.course[planKey] || PLANS.course.basic;
  return {
    platform_earned: Math.round(amount * plan.rate * 100) / 100,
    venue_earned: Math.round(amount * (1 - plan.rate) * 100) / 100,
    rate: plan.rate,
    label: plan.label,
  };
}

// ===== 教練開班佣金：學生俾學費 =====
function calcCoachCommission(amount) {
  const rate = 0.15;
  return {
    platform_earned: Math.round(amount * rate * 100) / 100,
    coach_earned: Math.round(amount * (1 - rate) * 100) / 100,
    rate: rate,
    label: "15%",
  };
}

// ===== 租場佣金：教練俾場租 =====
function calcRentalCommission(amount, planKey) {
  const plan = PLANS.rental[planKey] || PLANS.rental.basic;
  return {
    platform_earned: Math.round(amount * plan.rate * 100) / 100,
    venue_earned: Math.round(amount * (1 - plan.rate) * 100) / 100,
    rate: plan.rate,
    label: plan.label,
  };
}

// ===== 從 DB 攞場地嘅計劃 =====
function getVenuePlan(venueId) {
  const db = new Database(DB_PATH);
  const venue = db
    .prepare(
      "SELECT commission_plan, partner_type FROM partner_venues WHERE id = ?",
    )
    .get(venueId);
  db.close();
  return venue || { commission_plan: "basic", partner_type: "full" };
}

module.exports = {
  PLANS,
  calcCourseCommission,
  calcCoachCommission,
  calcRentalCommission,
  getVenuePlan,
};
