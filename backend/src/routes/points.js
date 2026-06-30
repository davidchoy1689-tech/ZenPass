/**
 * ZenPass 禪流 - 積分系統路由
 * Points / Loyalty System
 *
 * 積分係免費賺取嘅獎勵分數，同 Credits（課金點數）完全分開。
 * 用戶可透過參與活動賺取積分，然後兌換獎勵。
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// ===== 等級門檻定義 =====
const TIERS = [
  { id: "bronze", label: "🥉 銅牌", minPoints: 0, color: "#CD7F32" },
  { id: "silver", label: "🥈 銀牌", minPoints: 500, color: "#C0C0C0" },
  { id: "gold", label: "🥇 金牌", minPoints: 2000, color: "#FFD700" },
  { id: "diamond", label: "💎 鑽石", minPoints: 5000, color: "#B9F2FF" },
];

/**
 * 計算等級
 */
function calcTier(points) {
  let current = TIERS[0];
  let next = TIERS[1];
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (points >= TIERS[i].minPoints) {
      current = TIERS[i];
      next = TIERS[i + 1] || null;
      break;
    }
  }
  return { current, next };
}

/**
 * 寫入積分交易紀錄 + 更新用戶積分
 */
function addPointsTx(userId, type, points, source, description, referenceId) {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  try {
    const user = db
      .prepare("SELECT points FROM users WHERE id = ?")
      .get(userId);
    if (!user) return null;

    const currentPoints = user.points || 0;
    const delta = type === "earn" ? points : -points;
    const newBalance = Math.max(0, currentPoints + delta);

    // 計算新等級
    const tier = calcTier(newBalance);

    // 寫入 transaction
    const txId = uuidv4();
    db.prepare(
      `
      INSERT INTO points_transactions (id, user_id, type, points, balance_after, source, reference_id, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      txId,
      userId,
      type,
      points,
      newBalance,
      source,
      referenceId || null,
      description || null,
    );

    // 更新用戶積分 + 等級
    db.prepare(
      `
      UPDATE users SET points = ?, points_tier = ?, points_tier_label = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
    ).run(newBalance, tier.current.id, tier.current.label, userId);

    return { txId, points: newBalance, tier: tier.current };
  } finally {

  }
}

/**
 * 獲取用戶積分摘要
 */
function getUserPointsSummary(userId) {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  try {
    const user = db
      .prepare(
        `
      SELECT id, name, points, points_tier, points_tier_label, last_checkin, checkin_streak
      FROM users WHERE id = ?
    `,
      )
      .get(userId);
    if (!user) return null;

    const tier = calcTier(user.points || 0);

    // 本月賺取積分
    const monthEarned = db
      .prepare(
        `
      SELECT COALESCE(SUM(points), 0) as total FROM points_transactions
      WHERE user_id = ? AND type = 'earn'
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `,
      )
      .get(userId);

    // 歷史總賺取
    const totalEarned = db
      .prepare(
        `
      SELECT COALESCE(SUM(points), 0) as total FROM points_transactions
      WHERE user_id = ? AND type = 'earn'
    `,
      )
      .get(userId);

    // 歷史總花費
    const totalSpent = db
      .prepare(
        `
      SELECT COALESCE(SUM(points), 0) as total FROM points_transactions
      WHERE user_id = ? AND type = 'spend'
    `,
      )
      .get(userId);

    // 今天是否已簽到
    const today = new Date().toISOString().split("T")[0];

    // 本週預約數量（for weekly challenge）
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekBookings = db
      .prepare(
        `
      SELECT COUNT(*) as total FROM bookings
      WHERE user_id = ? AND created_at >= ? AND status IN ('confirmed', 'completed', 'attended')
    `,
      )
      .get(userId, weekStartStr);

    const checkedInToday = user.last_checkin
      ? user.last_checkin.startsWith(today)
      : false;

    return {
      points: user.points || 0,
      tier: tier.current,
      nextTier: tier.next,
      tierProgress: tier.next
        ? Math.round(
            (((user.points || 0) - tier.current.minPoints) /
              (tier.next.minPoints - tier.current.minPoints)) *
              100,
          )
        : 100,
      checkinStreak: user.checkin_streak || 0,
      checkedInToday,
      weekBookings: weekBookings ? weekBookings.total : 0,
      monthEarned: monthEarned.total,
      totalEarned: totalEarned.total,
      totalSpent: totalSpent.total,
    };
  } finally {

  }
}

// ===== GET /api/points — 取用戶積分摘要 =====
router.get("/", authenticateToken, (req, res) => {
  try {
    const summary = getUserPointsSummary(req.user.id);
    if (!summary) return res.status(404).json({ error: "用戶不存在" });
    res.json(summary);
  } catch (err) {
    console.error("取積分摘要錯誤:", err);
    res.status(500).json({ error: "無法取得積分資料" });
  }
});

// ===== GET /api/points/history — 積分交易紀錄 =====
router.get("/history", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const transactions = db
      .prepare(
        `
      SELECT * FROM points_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(req.user.id, limit, offset);

    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM points_transactions WHERE user_id = ?
    `,
      )
      .get(req.user.id);

    res.json({ transactions, total: total.count, limit, offset });
  } catch (err) {
    console.error("取積分歷史錯誤:", err);
    res.status(500).json({ error: "無法取得積分歷史" });
  }
});

// ===== GET /api/points/tiers — 等級資訊 =====
router.get("/tiers", (req, res) => {
  res.json({ tiers: TIERS });
});

// ===== GET /api/points/rewards — 獎勵目錄 =====
router.get("/rewards", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const rewards = db
      .prepare(
        `
      SELECT * FROM points_rewards WHERE is_active = 1 ORDER BY points_cost ASC
    `,
      )
      .all();

    res.json({ rewards });
  } catch (err) {
    console.error("取獎勵目錄錯誤:", err);
    res.status(500).json({ error: "無法取得獎勵目錄" });
  }
});

// ===== POST /api/points/checkin — 每日簽到 =====
router.post("/checkin", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare(
        `
      SELECT id, points, last_checkin, checkin_streak FROM users WHERE id = ?
    `,
      )
      .get(req.user.id);

    if (!user) {

      return res.status(404).json({ error: "用戶不存在" });
    }

    const today = new Date().toISOString().split("T")[0];

    // 檢查今日是否已簽到
    if (user.last_checkin && user.last_checkin.startsWith(today)) {

      return res
        .status(400)
        .json({ error: "今日已簽到", alreadyCheckedIn: true });
    }

    // 計算連續簽到天數
    let streak = user.checkin_streak || 0;

    if (user.last_checkin) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      if (user.last_checkin.startsWith(yesterdayStr)) {
        streak += 1; // 連續
      } else {
        streak = 1; // 斷纜，重設
      }
    } else {
      streak = 1; // 第一次簽到
    }

    // 計算簽到獎勵積分（基本 5 + 連續加成）
    const basePoints = 5;
    const streakBonus = Math.min(Math.floor((streak - 1) / 5), 5) * 2; // 每連續5日+2分，上限額外10分
    const totalPoints = basePoints + streakBonus;

    // 記錄簽到交易
    const desc = `📅 每日簽到 Day ${streak}${streakBonus > 0 ? `（連續獎勵 +${streakBonus}）` : ""}`;
    const result = addPointsTx(
      req.user.id,
      "earn",
      totalPoints,
      "checkin",
      desc,
      null,
    );

    if (!result) {
      return res.status(500).json({ error: "簽到失敗" });
    }

    // 更新 last_checkin 和 checkin_streak
    db.pragma("foreign_keys = ON");
    db
      .prepare(
        `
      UPDATE users SET last_checkin = datetime('now'), checkin_streak = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(streak, req.user.id);

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "points_reward",
        entityId: result.txId,
        data: {
          userId: req.user.id,
          points: totalPoints,
          source: "checkin",
          streak,
          streak_bonus: streakBonus,
          description: desc,
          new_balance: result.points,
          action: "checkin",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write checkin block:", blockErr.message);
    }

    res.json({
      success: true,
      points: totalPoints,
      streak,
      streakBonus,
      balance: result.points,
      tier: result.tier,
      description: desc,
    });
  } catch (err) {
    console.error("簽到錯誤:", err);
    res.status(500).json({ error: "簽到失敗" });
  }
});

// ===== POST /api/points/redeem — 兌換獎勵 =====
router.post("/redeem", authenticateToken, (req, res) => {
  try {
    const { reward_id } = req.body;
    if (!reward_id) return res.status(400).json({ error: "請選擇獎勵" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 檢查獎勵
    const reward = db
      .prepare(
        `
      SELECT * FROM points_rewards WHERE id = ? AND is_active = 1
    `,
      )
      .get(reward_id);

    if (!reward) {

      return res.status(404).json({ error: "獎勵不存在或已下架" });
    }

    if (reward.stock !== -1 && reward.stock <= 0) {

      return res.status(400).json({ error: "獎勵已兌換完畢" });
    }

    // 檢查用戶積分
    const user = db
      .prepare("SELECT points FROM users WHERE id = ?")
      .get(req.user.id);
    if (!user || (user.points || 0) < reward.points_cost) {

      return res.status(400).json({
        error: "積分不足",
        required: reward.points_cost,
        current: user?.points || 0,
      });
    }

    // 扣積分
    const desc = `🎁 兌換：${reward.icon} ${reward.name}`;
    const result = addPointsTx(
      req.user.id,
      "spend",
      reward.points_cost,
      "redeem",
      desc,
      reward_id,
    );

    if (!result) {
      return res.status(500).json({ error: "兌換失敗" });
    }

    // 建立兌換記錄
    const redId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 3); // 3個月有效期

    db
      .prepare(
        `
      INSERT INTO points_redemptions (id, user_id, reward_id, reward_name, points_spent, reward_value, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        redId,
        req.user.id,
        reward_id,
        reward.name,
        reward.points_cost,
        reward.reward_value,
        expiresAt.toISOString(),
      );

    // 扣庫存
    if (reward.stock !== -1) {
      db
        .prepare("UPDATE points_rewards SET stock = stock - 1 WHERE id = ?")
        .run(reward_id);
    }

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "points_redemption",
        entityId: redId,
        data: {
          userId: req.user.id,
          reward_id,
          reward_name: reward.name,
          reward_icon: reward.icon,
          points_cost: reward.points_cost,
          reward_value: reward.reward_value,
          new_balance: result.points,
          action: "redeem",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write redemption block:", blockErr.message);
    }

    res.json({
      success: true,
      redemption: {
        id: redId,
        rewardId: reward_id,
        rewardName: reward.name,
        rewardIcon: reward.icon,
        pointsSpent: reward.points_cost,
        expiresAt: expiresAt.toISOString(),
      },
      balance: result.points,
      tier: result.tier,
    });
  } catch (err) {
    console.error("兌換錯誤:", err);
    res.status(500).json({ error: "兌換失敗" });
  }
});

// ===== GET /api/points/redemptions — 用戶兌換記錄 =====
// ===== GET /api/points/checkin-dates — 簽到日曆資料 =====
router.get("/checkin-dates", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 獲取當前月份首日和末日
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];

    // 從點數交易中取出本月的簽到記錄
    const checkinDays = db
      .prepare(
        `
      SELECT DISTINCT DATE(created_at) as checkin_date
      FROM points_transactions
      WHERE user_id = ? AND source = 'checkin'
      AND created_at >= ? AND created_at < ?
      ORDER BY checkin_date
    `,
      )
      .all(req.user.id, monthStart, monthEnd + "T23:59:59");

    res.json({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      days: checkinDays.map((d) => d.checkin_date),
    });
  } catch (err) {
    console.error("取簽到日期錯誤:", err);
    res.status(500).json({ error: "無法取得簽到日期" });
  }
});

// ===== GET /api/points/leaderboard — 積分排行榜 =====
router.get("/leaderboard", (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const topUsers = db
      .prepare(
        `
      SELECT id, name, points, points_tier_label, points_tier
      FROM users
      WHERE points > 0
      ORDER BY points DESC
      LIMIT 10
    `,
      )
      .all();

    res.json({ leaderboard: topUsers });
  } catch (err) {
    console.error("取排行榜錯誤:", err);
    res.status(500).json({ error: "無法取得排行榜" });
  }
});

router.get("/redemptions", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const redemptions = db
      .prepare(
        `
      SELECT r.*, p.icon as reward_icon
      FROM points_redemptions r
      LEFT JOIN points_rewards p ON r.reward_id = p.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT 50
    `,
      )
      .all(req.user.id);

    res.json({ redemptions });
  } catch (err) {
    console.error("取兌換記錄錯誤:", err);
    res.status(500).json({ error: "無法取得兌換記錄" });
  }
});

// ===== POST /api/points/earn-booking — 完成課堂後獲得積分（由 checkin 流程觸發）=====
router.post("/earn-booking", authenticateToken, (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: "缺少預約編號" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 檢查 booking 是否存在且屬於該用戶，狀態為 attended
    const booking = db
      .prepare(
        `
      SELECT b.*, c.title as class_title, cs.start_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.id = ? AND b.user_id = ? AND b.status = 'attended'
    `,
      )
      .get(booking_id, req.user.id);

    if (!booking) {

      return res.status(404).json({ error: "預約不存在、未出席或未簽到" });
    }

    // 檢查是否已領過積分
    const existing = db
      .prepare(
        `
      SELECT id FROM points_transactions
      WHERE user_id = ? AND source = 'booking' AND reference_id = ?
    `,
      )
      .get(req.user.id, booking_id);

    if (existing) {

      return res.status(400).json({ error: "已領取過課堂積分" });
    }

    // 獎勵積分
    const points = 50;
    const desc = `🏋️ 完成課堂：${booking.class_title}`;
    const result = addPointsTx(
      req.user.id,
      "earn",
      points,
      "booking",
      desc,
      booking_id,
    );

    // 順便檢查是否係本週第一堂（額外獎勵）
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const weekBookings = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM points_transactions
      WHERE user_id = ? AND source = 'booking'
      AND created_at >= ?
    `,
      )
      .get(req.user.id, weekStartStr);

    if (weekBookings.count === 1) {
      // 本週第一堂，額外獎勵
      const bonusResult = addPointsTx(
        req.user.id,
        "earn",
        30,
        "weekly_bonus",
        `🏆 本週第一堂額外獎勵 +30`,
        booking_id,
      );

      // ⛓️ Blockchain audit trail — booking points
      try {
        writeBlock({
          entityType: "points_reward",
          entityId: result.txId,
          data: {
            userId: req.user.id,
            booking_id,
            points,
            source: "booking",
            description: desc,
            new_balance: result.points,
            action: "earn_booking",
          },
        });
      } catch (blockErr) {
        console.error("[BLOCKCHAIN] Failed to write booking points block:", blockErr.message);
      }
      // ⛓️ Blockchain audit trail — weekly bonus
      try {
        writeBlock({
          entityType: "points_reward",
          entityId: bonusResult.txId,
          data: {
            userId: req.user.id,
            booking_id,
            points: 30,
            source: "weekly_bonus",
            description: "本週第一堂額外獎勵",
            new_balance: bonusResult.points,
            action: "weekly_bonus",
          },
        });
      } catch (blockErr) {
        console.error("[BLOCKCHAIN] Failed to write weekly bonus block:", blockErr.message);
      }

      return res.json({
        success: true,
        bookingPoints: points,
        weeklyBonus: 30,
        totalEarned: points + 30,
        balance: bonusResult.points,
        tier: bonusResult.tier,
        description: `🏋️ 完成課堂 +${points}，本週首堂獎勵 +30`,
      });
    }

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "points_reward",
        entityId: result.txId,
        data: {
          userId: req.user.id,
          booking_id,
          points,
          source: "booking",
          description: desc,
          new_balance: result.points,
          action: "earn_booking",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write booking points block:", blockErr.message);
    }

    res.json({
      success: true,
      bookingPoints: points,
      weeklyBonus: 0,
      totalEarned: points,
      balance: result.points,
      tier: result.tier,
      description: desc,
    });
  } catch (err) {
    console.error("課堂積分獎勵錯誤:", err);
    res.status(500).json({ error: "無法發放課堂積分" });
  }
});

// ===== POST /api/points/review — 課後評價獎勵 =====
router.post("/review", authenticateToken, (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: "缺少預約編號" });

    // 檢查 booking（至少要是 attended 或 confirmed）
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const booking = db
      .prepare(
        `
      SELECT * FROM bookings WHERE id = ? AND user_id = ?
    `,
      )
      .get(booking_id, req.user.id);

    if (!booking) {

      return res.status(404).json({ error: "預約不存在" });
    }

    if (booking.status !== "attended" && booking.status !== "confirmed") {

      return res.status(400).json({ error: "只能評價已完成的課堂" });
    }

    // 檢查是否已領過評價積分
    const existing = db
      .prepare(
        `
      SELECT id FROM points_transactions
      WHERE user_id = ? AND source = 'review' AND reference_id = ?
    `,
      )
      .get(req.user.id, booking_id);

    if (existing) {

      return res.status(400).json({ error: "已評價過此課堂" });
    }

    const points = 20;
    const desc = `⭐ 課後評價獎勵 +${points}`;
    const result = addPointsTx(
      req.user.id,
      "earn",
      points,
      "review",
      desc,
      booking_id,
    );

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "points_reward",
        entityId: result.txId,
        data: {
          userId: req.user.id,
          booking_id,
          points,
          source: "review",
          description: desc,
          new_balance: result.points,
          action: "review",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write review points block:", blockErr.message);
    }

    res.json({
      success: true,
      points,
      balance: result.points,
      tier: result.tier,
    });
  } catch (err) {
    console.error("評價獎勵錯誤:", err);
    res.status(500).json({ error: "無法發放評價積分" });
  }
});

// ===== POST /api/points/referral — 推薦朋友獎勵 =====
router.post("/referral", authenticateToken, (req, res) => {
  try {
    const { referred_user_id } = req.body;
    if (!referred_user_id)
      return res.status(400).json({ error: "請提供被推薦用戶 ID" });

    // 推薦人獲得 100 積分（新用戶首次預約完成時觸發）
    const points = 100;
    const desc = `👥 推薦朋友獎勵 +${points}`;
    const result = addPointsTx(
      req.user.id,
      "earn",
      points,
      "referral",
      desc,
      referred_user_id,
    );

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "points_reward",
        entityId: result.txId,
        data: {
          userId: req.user.id,
          referred_user_id,
          points,
          source: "referral",
          description: desc,
          new_balance: result.points,
          action: "referral",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write referral points block:", blockErr.message);
    }

    res.json({
      success: true,
      points,
      balance: result.points,
      tier: result.tier,
    });
  } catch (err) {
    console.error("推薦獎勵錯誤:", err);
    res.status(500).json({ error: "無法發放推薦積分" });
  }
});

module.exports = router;
