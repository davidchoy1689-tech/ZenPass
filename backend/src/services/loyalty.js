/**
 * ZenPass 禪流 - Loyalty Tier 忠誠度系統
 * 每月根據預約次數計算用戶 tier
 */

const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");
const { audit } = require("./audit");
const { writeBlock } = require("./blockchain-audit");

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
      { icon: "💵", text: "Top-up 9折 (10% off)" },
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
      { icon: "👑", text: "VIP 優先預約（新課 24 小時）" },
      { icon: "💵", text: "Top-up 9折 (10% off)" },
      { icon: "🎧", text: "專屬客服" },
      { icon: "🎫", text: "每月 1 次免費邀請朋友（健康諮詢／身體評估）" },
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
    .prepare(
      `SELECT id FROM users
       WHERE (credits > 0 OR membership_type != 'none')
         AND COALESCE(loyalty_tier_manual, 0) = 0`,
    )
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
 * 每月 1 號自動結算：按「上一個月（香港時間）」已確認／已出席預約數重算等級
 * - 跳過管理員手動設定（loyalty_tier_manual = 1）
 * - 冇 booking 嘅用戶會回落 bronze（唔會永遠停留在舊等級）
 * @param {Date} now 可注入（測試用）
 */
function refreshMonthlyTiers(now = new Date()) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  // 香港時區嘅上一個月區間（SQLite 存 UTC 字串）
  const hk = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = hk.getUTCFullYear();
  const m = hk.getUTCMonth(); // 0-based；m 即係上一個月嘅 1-based 月份
  const startMs = Date.UTC(y, m - 1, 1) - 8 * 3600 * 1000;
  const endMs = Date.UTC(y, m, 1) - 8 * 3600 * 1000;
  const toSql = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

  const rows = db
    .prepare(
      `SELECT user_id, COUNT(*) AS cnt FROM bookings
       WHERE status IN ('confirmed', 'attended')
         AND created_at >= ? AND created_at < ?
       GROUP BY user_id`,
    )
    .all(toSql(startMs), toSql(endMs));
  const counts = new Map(rows.map((r) => [r.user_id, r.cnt]));

  const users = db
    .prepare("SELECT id, loyalty_tier FROM users WHERE COALESCE(loyalty_tier_manual, 0) = 0")
    .all();

  let updated = 0;
  const apply = db.transaction(() => {
    for (const u of users) {
      const cnt = counts.get(u.id) || 0;
      const tier = calculateTier(cnt);
      if (tier !== u.loyalty_tier || cnt > 0) {
        db.prepare("UPDATE users SET loyalty_tier = ?, monthly_bookings = ? WHERE id = ?").run(
          tier,
          cnt,
          u.id,
        );
      }
      if (tier !== u.loyalty_tier) updated++;
    }
  });
  apply();

  const prevYear = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 12 : m;
  return {
    period: `${prevYear}-${String(prevMonth).padStart(2, "0")}`,
    scanned: users.length,
    changed: updated,
  };
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
 * 管理員手動設定會員等級（設定後每月自動計算會跳過此用戶）
 */
function setUserTierManually(userId, tier, { adminId = null, reason = "" } = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  if (!TIERS[tier]) {
    const err = new Error("無效嘅會員等級");
    err.status = 400;
    throw err;
  }

  const user = db
    .prepare("SELECT id, name, loyalty_tier, loyalty_tier_manual FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    const err = new Error("用戶不存在");
    err.status = 404;
    throw err;
  }

  const oldTier = user.loyalty_tier || "bronze";
  db.prepare(
    "UPDATE users SET loyalty_tier = ?, loyalty_tier_manual = 1 WHERE id = ?",
  ).run(tier, userId);

  try {
    audit({
      actionType: "loyalty.tier_manual",
      entityType: "user",
      entityId: userId,
      userId: adminId,
      oldValues: { loyalty_tier: oldTier },
      newValues: { loyalty_tier: tier, manual: true },
      description: `管理員手動設定會員等級：${oldTier} → ${tier}${reason ? `（${reason}）` : ""}`,
    });
  } catch (e) {
    console.error("⚠️ Audit failed (loyalty tier):", e.message);
  }

  try {
    writeBlock({
      entityType: "loyalty_tier",
      entityId: userId,
      data: { old_tier: oldTier, new_tier: tier, manual: true, admin_id: adminId, reason },
    });
  } catch (e) {
    console.error("⚠️ Blockchain write failed (loyalty tier):", e.message);
  }

  return {
    user_id: userId,
    old_tier: oldTier,
    tier,
    tier_info: TIERS[tier],
    manual: true,
  };
}

/**
 * 取消手動等級，回復每月自動計算
 */
function resetUserTierToAuto(userId, adminId = null) {
  const db = getDb();
  const user = db
    .prepare("SELECT id, loyalty_tier FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    const err = new Error("用戶不存在");
    err.status = 404;
    throw err;
  }

  db.prepare("UPDATE users SET loyalty_tier_manual = 0 WHERE id = ?").run(userId);
  const result = updateUserTier(userId);

  try {
    audit({
      actionType: "loyalty.tier_auto",
      entityType: "user",
      entityId: userId,
      userId: adminId,
      oldValues: { loyalty_tier: user.loyalty_tier, manual: true },
      newValues: { loyalty_tier: result.tier, manual: false },
      description: `取消手動會員等級，回復自動計算（現為 ${result.tier}）`,
    });
  } catch (e) {}

  return { user_id: userId, tier: result.tier, tier_info: result.tier_info, manual: false };
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

/**
 * 增值折扣报价（單一來源：前台顯示、落單、auto top-up 共用）
 * @returns {{original_amount_hkd:number, discount_percent:number, payable_hkd:number}}
 */
function applyTopUpDiscount(amount, userId) {
  const pct = userId ? getTopUpDiscount(userId) : 0;
  const original = Math.round(Number(amount) * 100) / 100;
  const payable = Math.round(original * (100 - pct)) / 100;
  return {
    original_amount_hkd: original,
    discount_percent: pct,
    payable_hkd: payable,
  };
}

module.exports = {
  TIERS,
  calculateTier,
  updateUserTier,
  updateAllTiers,
  getUserTierInfo,
  getTopUpDiscount,
  applyTopUpDiscount,
  setUserTierManually,
  resetUserTierToAuto,
  refreshMonthlyTiers,
};
