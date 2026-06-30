/**
 * ZenPass 禪流 - 勳章/成就系統路由
 *
 * 勳章係鼓勵用戶探索不同運動類型、養成習慣嘅成就系統。
 * 用戶完成指定條件後自動解鎖，顯示喺個人頁面。
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

/**
 * 香港18區關鍵字對照表
 * 用 venue_address 搵出對應地區
 */
const HK_DISTRICT_KEYWORDS = {
  中西區: ["中環", "上環", "西環", "西營盤", "堅尼地城", "半山", "山頂"],
  東區: [
    "炮台山",
    "北角",
    "鰂魚涌",
    "西灣河",
    "筲箕灣",
    "柴灣",
    "杏花邨",
    "太古城",
    "康怡",
    "維多利亞公園",
  ],
  南區: [
    "香港仔",
    "鴨脷洲",
    "黃竹坑",
    "薄扶林",
    "數碼港",
    "華富",
    "南灣",
    "淺水灣",
    "深水灣",
    "赤柱",
  ],
  灣仔區: ["灣仔", "金鐘", "跑馬地", "大坑", "銅鑼灣"],
  九龍城區: [
    "九龍城",
    "九龍塘",
    "何文田",
    "紅磡",
    "土瓜灣",
    "啟德",
    "馬頭圍",
    "黃埔",
  ],
  觀塘區: [
    "觀塘",
    "牛頭角",
    "九龍灣",
    "藍田",
    "油塘",
    "秀茂坪",
    "順利",
    "佐敦谷",
  ],
  深水埗區: ["深水埗", "長沙灣", "荔枝角", "石硤尾", "南昌", "又一村", "蘇屋"],
  黃大仙區: [
    "黃大仙",
    "慈雲山",
    "鑽石山",
    "新蒲崗",
    "彩虹",
    "牛池灣",
    "樂富",
    "竹園",
  ],
  油尖旺區: [
    "尖沙咀",
    "佐敦",
    "油麻地",
    "旺角",
    "太子",
    "大角咀",
    "奧運",
    "西九龍",
  ],
  離島區: [
    "東涌",
    "機場",
    "大嶼山",
    "長洲",
    "南丫島",
    "坪洲",
    "愉景灣",
    "梅窩",
  ],
  葵青區: ["葵涌", "葵芳", "葵興", "青衣", "荔景"],
  北區: ["上水", "粉嶺", "沙頭角", "打鼓嶺", "羅湖"],
  西貢區: ["西貢", "將軍澳", "坑口", "寶琳", "調景嶺", "清水灣", "白沙灣"],
  沙田區: ["沙田", "大圍", "馬鞍山", "火炭", "石門", "第一城", "禾輋", "瀝源"],
  大埔區: ["大埔", "大埔墟", "太和", "白石角", "科學園"],
  荃灣區: ["荃灣", "荃灣西", "深井", "馬灣", "汀九", "青龍頭"],
  屯門區: ["屯門", "兆康", "良景", "蝴蝶灣", "黃金海岸", "掃管笏"],
  元朗區: ["元朗", "天水圍", "錦田", "流浮山", "朗屏", "洪水橋"],
};

/**
 * 從地址文字中偵測屬於邊個地區
 * @param {string} address - 場地地址
 * @returns {string|null} - 地區名稱（例如「中西區」）或 null
 */
function detectDistrict(address) {
  if (!address) return null;
  for (const [district, keywords] of Object.entries(HK_DISTRICT_KEYWORDS)) {
    for (const kw of keywords) {
      if (address.includes(kw)) return district;
    }
  }
  return null;
}

/**
 * 檢查用戶所有勳章條件，頒發新勳章
 * 喺關鍵動作（簽到、上堂、評價等）完成後自動觸發
 */
function checkAndAwardBadges(userId) {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  const newBadges = [];

  try {
    // 讀取用戶資料
    const user = db
      .prepare(
        `
      SELECT id, points, points_tier, checkin_streak
      FROM users WHERE id = ?
    `,
      )
      .get(userId);
    if (!user) return newBadges;

    // 讀取已擁有嘅勳章
    const owned = db
      .prepare(
        `
      SELECT badge_id FROM user_badges WHERE user_id = ?
    `,
      )
      .all(userId)
      .map((r) => r.badge_id);
    const ownedSet = new Set(owned);

    // 讀取所有勳章定義
    const allBadges = db
      .prepare("SELECT * FROM badges ORDER BY sort_order")
      .all();

    // 計算關鍵統計
    const stats = {};

    // 總完成課程數（attended bookings）
    const bookingCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM bookings
      WHERE user_id = ? AND status = 'attended'
    `,
      )
      .get(userId);
    stats.total_bookings = bookingCount.count;

    // 已探索類別（distinct categories from attended bookings）
    const categories = db
      .prepare(
        `
      SELECT DISTINCT c.category FROM bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.user_id = ? AND b.status = 'attended'
    `,
      )
      .all(userId);
    stats.categories_count = categories.length;
    stats.categories = categories.map((r) => r.category);

    // 總評價數
    const reviewsCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM points_transactions
      WHERE user_id = ? AND source = 'review'
    `,
      )
      .get(userId);
    stats.reviews_count = reviewsCount.count;

    // 推薦人數
    const referralsCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM points_transactions
      WHERE user_id = ? AND source = 'referral'
    `,
      )
      .get(userId);
    stats.referrals_count = referralsCount.count;

    // 連續簽到
    stats.checkin_streak = user.checkin_streak || 0;

    // 積分等級
    stats.points_tier = user.points_tier || "bronze";

    // 已擁有勳章數
    stats.total_badges = owned.length;

    // 逐一檢查每個勳章條件
    for (const badge of allBadges) {
      if (ownedSet.has(badge.id)) continue; // 已擁有

      let earned = false;

      switch (badge.condition_type) {
        case "total_bookings":
          earned = stats.total_bookings >= parseInt(badge.condition_value);
          break;
        case "categories_count":
          earned = stats.categories_count >= parseInt(badge.condition_value);
          break;
        case "checkin_streak":
          earned = stats.checkin_streak >= parseInt(badge.condition_value);
          break;
        case "reviews_count":
          earned = stats.reviews_count >= parseInt(badge.condition_value);
          break;
        case "referrals_count":
          earned = stats.referrals_count >= parseInt(badge.condition_value);
          break;
        case "points_tier": {
          const tierOrder = { bronze: 0, silver: 1, gold: 2, diamond: 3 };
          const current = tierOrder[stats.points_tier] || 0;
          const required = tierOrder[badge.condition_value] || 0;
          earned = current >= required;
          break;
        }
        case "total_badges":
          earned =
            owned.length + newBadges.length >= parseInt(badge.condition_value);
          break;
        case "district_checkin": {
          // 檢查用戶去過呢個地區未
          if (!stats.districts_visited) {
            // Lazy-load districts from attended bookings
            const visitedRows = db
              .prepare(
                `
              SELECT DISTINCT c.venue_address FROM bookings b
              JOIN classes c ON b.class_id = c.id
              WHERE b.user_id = ? AND b.status = 'attended'
              AND c.venue_address IS NOT NULL AND c.venue_address != ''
            `,
              )
              .all(userId);
            stats.districts_visited = new Set();
            for (const row of visitedRows) {
              const d = detectDistrict(row.venue_address);
              if (d) stats.districts_visited.add(d);
            }
          }
          earned = stats.districts_visited.has(badge.condition_value);
          break;
        }
        default:
          break;
      }

      if (earned) {
        try {
          const badgeId = uuidv4();
          db.prepare(
            `
            INSERT INTO user_badges (id, user_id, badge_id, earned_at)
            VALUES (?, ?, ?, datetime('now'))
          `,
          ).run(badgeId, userId, badge.id);
          // ⛓️ 區塊鏈：記錄勳章頒發
          try {
            writeBlock({
              entityType: "badge_award",
              entityId: badgeId,
              data: {
                user_id: userId,
                badge_id: badge.id,
                badge_name: badge.name,
                badge_category: badge.category,
                condition_type: badge.condition_type,
                condition_value: badge.condition_value,
                awarded_at: new Date().toISOString(),
              },
            });
          } catch (bcErr) {
            console.error("⚠️ Blockchain write failed (badge award):", bcErr.message);
          }

          newBadges.push({
            id: badge.id,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            category: badge.category,
          });
        } catch (e) {
          // 可能 race condition 重複插入
        }
      }
    }
  } catch (err) {
    console.error("勳章檢查錯誤:", err);
  } finally {

  }

  return newBadges;
}

// ===== GET /api/badges — 取所有勳章定義 =====
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const badges = db
      .prepare(
        `
      SELECT * FROM badges ORDER BY sort_order ASC
    `,
      )
      .all();

    // 用戶已擁有嘅勳章
    const owned = db
      .prepare(
        `
      SELECT ub.*, b.name, b.description, b.icon, b.category
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = ?
      ORDER BY b.sort_order ASC
    `,
      )
      .all(req.user.id);

    const ownedSet = new Set(owned.map((r) => r.badge_id));
    const ownedBadges = owned;

    // 合併資料
    const enriched = badges.map((b) => ({
      ...b,
      earned: ownedSet.has(b.id),
      earned_at:
        ownedBadges.find((o) => o.badge_id === b.id)?.earned_at || null,
    }));

    res.json({
      badges: enriched,
      total: badges.length,
      earned: ownedBadges.length,
    });
  } catch (err) {
    console.error("取勳章錯誤:", err);
    res.status(500).json({ error: "無法取得勳章資料" });
  }
});

// ===== GET /api/badges/mine — 取用戶已獲得勳章 =====
router.get("/mine", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const badges = db
      .prepare(
        `
      SELECT ub.*, b.name, b.description, b.icon, b.category, b.sort_order
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = ?
      ORDER BY b.sort_order ASC
    `,
      )
      .all(req.user.id);

    const stats = db.prepare("SELECT COUNT(*) as total FROM badges").get();

    res.json({ badges, total: stats.total, earned: badges.length });
  } catch (err) {
    console.error("取用戶勳章錯誤:", err);
    res.status(500).json({ error: "無法取得勳章" });
  }
});

// ===== POST /api/badges/check — 手動觸發勳章檢查 =====
router.post("/check", authenticateToken, (req, res) => {
  try {
    const newBadges = checkAndAwardBadges(req.user.id);
    res.json({
      newBadges,
      count: newBadges.length,
    });
  } catch (err) {
    console.error("勳章檢查錯誤:", err);
    res.status(500).json({ error: "勳章檢查失敗" });
  }
});

// ===== GET /api/badges/progress — 勳章進度 =====
router.get("/progress", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare(
        `
      SELECT id, points_tier, checkin_streak FROM users WHERE id = ?
    `,
      )
      .get(req.user.id);
    if (!user) {

      return res.status(404).json({ error: "用戶不存在" });
    }

    // 統計數據
    const bookingCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM bookings
      WHERE user_id = ? AND status = 'attended'
    `,
      )
      .get(req.user.id);

    const categories = db
      .prepare(
        `
      SELECT DISTINCT c.category FROM bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.user_id = ? AND b.status = 'attended'
    `,
      )
      .all(req.user.id);

    const reviewsCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM points_transactions
      WHERE user_id = ? AND source = 'review'
    `,
      )
      .get(req.user.id);

    const referralsCount = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM points_transactions
      WHERE user_id = ? AND source = 'referral'
    `,
      )
      .get(req.user.id);

    // 全部類別數
    const allCategories = db
      .prepare(
        `
      SELECT DISTINCT category FROM classes WHERE status = 'active'
    `,
      )
      .all();

    // 已探索地區
    const districtRows = db
      .prepare(
        `
      SELECT DISTINCT c.venue_address FROM bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.user_id = ? AND b.status = 'attended'
      AND c.venue_address IS NOT NULL AND c.venue_address != ''
    `,
      )
      .all(req.user.id);

    const visitedDistricts = new Set();
    for (const row of districtRows) {
      const d = detectDistrict(row.venue_address);
      if (d) visitedDistricts.add(d);
    }

    const ownedBadges = db
      .prepare(
        `
      SELECT badge_id FROM user_badges WHERE user_id = ?
    `,
      )
      .all(req.user.id);

    res.json({
      stats: {
        total_bookings: bookingCount.count,
        categories_explored: categories.length,
        total_categories: allCategories.length,
        categories_list: categories.map((c) => c.category),
        checkin_streak: user.checkin_streak || 0,
        reviews_count: reviewsCount.count,
        referrals_count: referralsCount.count,
        points_tier: user.points_tier || "bronze",
        badges_earned: ownedBadges.length,
        districts_visited: Array.from(visitedDistricts),
        total_districts: 18,
      },
    });
  } catch (err) {
    console.error("取勳章進度錯誤:", err);
    res.status(500).json({ error: "無法取得進度" });
  }
});

// ===== GET /api/badges/profile/:userId — 公開勳章牆（畀其他人睇）=====
router.get("/profile/:userId", (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const badges = db
      .prepare(
        `
      SELECT ub.earned_at, b.name, b.description, b.icon, b.category
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = ?
      ORDER BY b.sort_order ASC
    `,
      )
      .all(req.params.userId);

    const count = badges.length;

    res.json({ badges, count });
  } catch (err) {
    console.error("取公開勳章錯誤:", err);
    res.status(500).json({ error: "無法取得勳章資料" });
  }
});

module.exports = router;
