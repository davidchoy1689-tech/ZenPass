/**
 * ZenPass 禪流 - 推薦引擎
 * 用戶行為追蹤 + 簡單推薦系統
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

/**
 * 確保 user_actions 表存在
 */
function ensureTables() {
  try {
    const db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('view_class','book_class','search','favorite')),
        category TEXT,
        class_id TEXT,
        data TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_actions_user 
      ON user_actions(user_id, created_at DESC);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_actions_category 
      ON user_actions(category, created_at DESC);
    `);
    db.close();
    return true;
  } catch (err) {
    console.error("推薦引擎: 建立 user_actions 表失敗:", err.message);
    return false;
  }
}

// 啟動時確保表存在
ensureTables();

/**
 * 記錄用戶行為
 * @param {string} userId - 用戶 ID
 * @param {string} action - 'view_class' | 'book_class' | 'search' | 'favorite'
 * @param {object} data - { class_id, category, search_query, ... }
 */
function trackUserAction(userId, action, data) {
  if (!userId || !action) return false;

  try {
    var db = new Database(DB_PATH);
    var category = data && data.category ? data.category : null;
    var classId = data && data.class_id ? data.class_id : null;
    var actionData = data ? JSON.stringify(data) : "{}";

    db.prepare(
      "INSERT INTO user_actions (user_id, action, category, class_id, data) VALUES (?, ?, ?, ?, ?)"
    ).run(userId, action, category, classId, actionData);

    db.close();
    return true;
  } catch (err) {
    console.error("推薦引擎: trackUserAction 錯誤:", err.message);
    return false;
  }
}

/**
 * 為用戶獲取推薦課程
 * @param {string} userId - 用戶 ID（可為 null，返回熱門）
 * @param {number} limit - 推薦數量
 */
function getRecommendations(userId, limit) {
  if (!limit) limit = 10;

  try {
    var db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    var excludedClassIds = [];

    if (userId) {
      // 找出用戶 top 3 categories（按瀏覽 + 預約頻率）
      var topCategories = db
        .prepare(
          `
        SELECT category, COUNT(*) as weight
        FROM user_actions
        WHERE user_id = ? AND category IS NOT NULL
          AND action IN ('view_class', 'book_class')
        GROUP BY category
        ORDER BY weight DESC
        LIMIT 3
      `
        )
        .all(userId);

      // 如果無 user_actions，就 fallback 到 bookings
      if (topCategories.length === 0) {
        topCategories = db
          .prepare(
            `
          SELECT c.category, COUNT(*) as weight
          FROM bookings b
          JOIN classes c ON b.class_id = c.id
          WHERE b.user_id = ? AND b.status IN ('confirmed', 'attended')
          GROUP BY c.category
          ORDER BY weight DESC
          LIMIT 3
        `
          )
          .all(userId);
      }

      // 已預約或已瀏覽過的課程排除
      var viewedOrBooked = db
        .prepare(
          `
        SELECT class_id FROM user_actions
        WHERE user_id = ? AND class_id IS NOT NULL
        UNION
        SELECT class_id FROM bookings
        WHERE user_id = ? AND status NOT IN ('cancelled')
      `
        )
        .all(userId, userId);

      excludedClassIds = viewedOrBooked
        .map(function (r) {
          return r.class_id;
        })
        .filter(function (id) {
          return id !== null;
        });

      // 如果有 top categories，推薦相關課程
      if (topCategories.length > 0) {
        var catList = topCategories.map(function (r) {
          return r.category;
        });
        var placeholders = catList.map(function () {
          return "?";
        });
        var params = catList.slice();

        if (excludedClassIds.length > 0) {
          var excludePlaceholders = excludedClassIds.map(function () {
            return "?";
          });
          params = params.concat(excludedClassIds);

          var recommendations = db
            .prepare(
              `
            SELECT c.*, u.name as coach_name,
              (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as booking_count,
              (SELECT COUNT(*) FROM class_schedules cs
               WHERE cs.class_id = c.id AND cs.start_time > datetime('now') AND cs.status = 'available'
              ) as upcoming_sessions
            FROM classes c
            JOIN users u ON c.coach_id = u.id
            WHERE c.status = 'active'
              AND c.category IN (${placeholders.join(",")})
              AND c.id NOT IN (${excludePlaceholders.join(",")})
            ORDER BY booking_count DESC
            LIMIT ?
          `
            )
            .all.apply(null, params.concat([limit]));
          db.close();
          return recommendations;
        } else {
          var recommendations = db
            .prepare(
              `
            SELECT c.*, u.name as coach_name,
              (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as booking_count,
              (SELECT COUNT(*) FROM class_schedules cs
               WHERE cs.class_id = c.id AND cs.start_time > datetime('now') AND cs.status = 'available'
              ) as upcoming_sessions
            FROM classes c
            JOIN users u ON c.coach_id = u.id
            WHERE c.status = 'active'
              AND c.category IN (${placeholders.join(",")})
            ORDER BY booking_count DESC
            LIMIT ?
          `
            )
            .all.apply(null, params.concat([limit]));
          db.close();
          return recommendations;
        }
      }

      db.close();
    }

    // Fallback: return popular by category
    return getPopularByCategory(limit);
  } catch (err) {
    console.error("推薦引擎: getRecommendations 錯誤:", err.message);
    return [];
  }
}

/**
 * 根據類別獲取熱門課程（用於未登入用戶）
 * @param {number} limit - 最多返回數量
 */
function getPopularByCategory(limit) {
  if (!limit) limit = 20;

  try {
    var db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    var popular = db
      .prepare(
        `
      SELECT c.*, u.name as coach_name,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as booking_count,
        (SELECT COUNT(*) FROM class_schedules cs
         WHERE cs.class_id = c.id AND cs.start_time > datetime('now') AND cs.status = 'available'
        ) as upcoming_sessions
      FROM classes c
      JOIN users u ON c.coach_id = u.id
      WHERE c.status = 'active'
      ORDER BY booking_count DESC
      LIMIT ?
    `
      )
      .all(limit);

    db.close();
    return popular;
  } catch (err) {
    console.error("推薦引擎: getPopularByCategory 錯誤:", err.message);
    return [];
  }
}

module.exports = {
  trackUserAction,
  getRecommendations,
  getPopularByCategory,
};
