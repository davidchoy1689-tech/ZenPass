/**
 * ZenPass 禪流 - Loyalty Tier 忠誠度系統
 * 每月根據預約次數計算用戶 tier
 */

const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

// ===== Tier Definitions =====
const TIERS = {
  bronze: {
    name: "銅牌",
    name_en: "Bronze",
    icon: "🥉",
    min_bookings: 0,
    max_bookings: 4,
    benefits: [],
    next_tier: "silver",
  },
  silver: {
    name: "銀牌",
    name_en: "Silver",
    icon: "🥈",
    min_bookings: 5,
    max_bookings: 9,
    benefits: [
      { icon: "🎯", text: "優先預約權" },
      { icon: "💵", text: "Top-up 95折 (5% off)" },
    ],
    next_tier: "gold",
  },
  gold: {
    name: "金牌",
    name_en: "Gold",
    icon: "🥇",
    min_bookings: 10,
    max_bookings: 19,
    benefits: [
      { icon: "🎯", text: "優先預約權" },
      { icon: "💵", text: "Top-up 9折 (10% off)" },
      { icon: "⏰", text: "早鳥 24 小時優先預約" },
    ],
    next_tier: "vip",
  },
  vip: {
    name: "VIP",
    name_en: "VIP",
    icon: "👑",
    min_bookings: 20,
    max_bookings: Infinity,
    benefits: [
      { icon: "🎯", text: "優先預約權" },
      { icon: "💵", text: "Top-up 9折 (10% off)" },
      { icon: "⏰", text: "早鳥 24 小時優先預約" },
      { icon: "🎧", text: "專屬客服" },
      { icon: "🎫", text: "每月免費 Guest Pass 1 張" },
    ],
    next_tier: null,
  },
};

/**
 * 計算用戶嘅 tier（根據該月 booking 次數）
 * @param {number} bookingCount - 該月已確認 booking 數
 * @returns {string} tier key
 */
function calculateTier(bookingCount) {
  if (bookingCount >= 20) return "vip";
  if (bookingCount >= 10) return "gold";
  if (bookingCount >= 5) return "silver";
  return "bronze";
}

/**
 * 更新特定用戶嘅 loyalty tier
 * @param {string} userId
 * @param {number} bookingCount - 可選，若無則自動計算
 * @returns {object} { tier, tierInfo, benefits }
 */
function updateUserTier(userId, bookingCount) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  if (bookingCount === undefined || bookingCount === null) {
    // Auto-calculate from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const result = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM bookings
         WHERE user_id = ? AND status IN ('confirmed', 'attended')
         AND created_at >= ?`
      )
      .get(userId, thirtyDaysAgo);
    bookingCount = result.cnt || 0;
  }

  const tier = calculateTier(bookingCount);
  const tierInfo = TIERS[tier];

  db.prepare(
    "UPDATE users SET loyalty_tier = ?, monthly_bookings = ? WHERE id = ?"
  ).run(tier, bookingCount, userId);

  return {
    tier,
    tier_info: tierInfo,
    booking_count: bookingCount,
    benefits: tierInfo.benefits,
  };
}

/**
 * 批量更新所有活躍用戶嘅 tier（每月 1 號 cron 用）
 * @returns {number} 更新人數
 */
function updateAllTiers() {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const users = db
    .prepare("SELECT id FROM users WHERE credits > 0 OR membership_type != 'none'")
    .all();

  let updated = 0;

  for (const user of users) {
    try {
      updateUserTier(user.id);
      updated++;
    } catch (err) {
      console.error(`[LOYALTY] Error updating user ${user.id}:`, err.message);
    }
  }

  return updated;
}

/**
 * 查詢用戶嘅 tier 資訊
 * @param {string} userId
 * @returns {object}
 */
function getUserTierInfo(userId) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const user = db
    .prepare("SELECT loyalty_tier, monthly_bookings, credits FROM users WHERE id = ?")
    .get(userId);

  if (!user) return null;

  const currentTier = user.loyalty_tier || "bronze";
  const currentTierInfo = TIERS[currentTier];
  const bookingCount = user.monthly_bookings || 0;

  // 計算下一 tier 嘅 progress
  let nextTierInfo = null;
  let progress = 100;

  if (currentTier === "bronze") {
    nextTierInfo = TIERS.silver;
    progress = Math.min(100, Math.round((bookingCount / 5) * 100));
  } else if (currentTier === "silver") {
    nextTierInfo = TIERS.gold;
    progress = Math.min(100, Math.round(((bookingCount - 4) / 5) * 100));
  } else if (currentTier === "gold") {
    nextTierInfo = TIERS.vip;
    progress = Math.min(100, Math.round(((bookingCount - 9) / 10) * 100));
  }

  // 計算本月 booking 數（過去30日）
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const thisMonthResult = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM bookings
       WHERE user_id = ? AND status IN ('confirmed', 'attended')
       AND created_at >= ?`
    )
    .get(userId, thirtyDaysAgo);

  return {
    user_id: userId,
    current_tier: currentTier,
    current_tier_info: currentTierInfo,
    booking_count: bookingCount,
    this_month_bookings: thisMonthResult.cnt || 0,
    next_tier: currentTierInfo.next_tier,
    next_tier_info: nextTierInfo,
    progress_percent: progress,
    benefits: currentTierInfo.benefits,
  };
}

/**
 * 頂層優惠計算（用於 top-up 折扣）
 * @param {string} userId
 * @param {number} amount
 * @returns {number} 折扣百分比
 */
function getTopUpDiscount(userId) {
  const db = getDb();
  const user = db.prepare("SELECT loyalty_tier FROM users WHERE id = ?").get(userId);
  if (!user) return 0;

  const tier = user.loyalty_tier || "bronze";
  switch (tier) {
    case "vip": return 10;
    case "gold": return 10;
    case "silver": return 5;
    default: return 0;
  }
}

module.exports = {
  TIERS,
  calculateTier,
  updateUserTier,
  updateAllTiers,
  getUserTierInfo,
  getTopUpDiscount,
};
