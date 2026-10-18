/**
 * ZenPass — 大量空位自動作通知
 * 規則：
 *  - 未來 1 小時至 7 日內、空位 > 50% 嘅課程
 *  - 通知曾報讀同類課程／瀏覽過嘅用戶（每個課程只取最近一個時段）
 *  - 已報名該課程嘅用戶唔會再收到
 *  - 每位用戶每個時段每日最多收一次（vacancy_notices 去重）
 */

const { getDb } = require("./database");
const { sendNotification } = require("./notification");

function hkDate(now) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function notifyLargeVacancies({ now = new Date(), maxRecipientsPerClass = 500 } = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const vacancies = db
    .prepare(
      `SELECT cs.id AS schedule_id, cs.class_id, cs.enrolled_count, cs.max_participants,
              c.title, c.category, cs.start_time
       FROM class_schedules cs
       JOIN classes c ON cs.class_id = c.id
       WHERE cs.start_time > datetime('now', '+1 hour')
         AND cs.start_time < datetime('now', '+7 days')
         AND cs.status = 'available'
         AND cs.max_participants > 0
         AND (cs.max_participants - cs.enrolled_count) > (cs.max_participants * 0.5)
       ORDER BY cs.start_time ASC
       LIMIT 20`,
    )
    .all();

  const dateKey = hkDate(now);
  const seenClasses = new Set();
  let notified = 0;
  let classes = 0;

  for (const v of vacancies) {
    if (seenClasses.has(v.class_id)) continue;
    seenClasses.add(v.class_id);
    classes++;

    const seats = v.max_participants - v.enrolled_count;
    const hasActions = !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_actions'")
      .get();
    const users = hasActions
      ? db
          .prepare(
            `SELECT DISTINCT b.user_id
             FROM bookings b
             JOIN classes c ON b.class_id = c.id
             JOIN users u ON u.id = b.user_id
             WHERE c.category = ?
               AND b.status IN ('confirmed', 'attended')
               AND b.user_id IS NOT NULL
               AND u.role NOT IN ('admin','super_admin','platform_manager','platform_staff','partner_owner','partner_admin','partner_staff','coach')
             UNION
             SELECT DISTINCT ua.user_id
             FROM user_actions ua
             JOIN users u2 ON u2.id = ua.user_id
             WHERE ua.category = ?
               AND ua.action IN ('view_class', 'book_class', 'favorite')
               AND ua.user_id IS NOT NULL
               AND u2.role NOT IN ('admin','super_admin','platform_manager','platform_staff','partner_owner','partner_admin','partner_staff','coach')`,
          )
          .all(v.category, v.category)
      : db
          .prepare(
            `SELECT DISTINCT b.user_id
             FROM bookings b
             JOIN classes c ON b.class_id = c.id
             JOIN users u ON u.id = b.user_id
             WHERE c.category = ?
               AND b.status IN ('confirmed', 'attended')
               AND b.user_id IS NOT NULL
               AND u.role NOT IN ('admin','super_admin','platform_manager','platform_staff','partner_owner','partner_admin','partner_staff','coach')`,
          )
          .all(v.category);

    let sentForClass = 0;
    for (const row of users) {
      if (sentForClass >= maxRecipientsPerClass) break;

      // 已報名此課程（任何有效狀態）→ 唔通知
      const booked = db
        .prepare(
          `SELECT 1 FROM bookings
           WHERE user_id = ? AND class_id = ? AND status IN ('pending_payment','confirmed','attended')
           LIMIT 1`,
        )
        .get(row.user_id, v.class_id);
      if (booked) continue;

      const ins = db
        .prepare(
          "INSERT OR IGNORE INTO vacancy_notices (schedule_id, user_id, sent_date) VALUES (?, ?, ?)",
        )
        .run(v.schedule_id, row.user_id, dateKey);
      if (!ins.changes) continue;

      try {
        sendNotification("class.vacancy", {
          recipient: row.user_id,
          data: {
            class_title: v.title,
            seats,
            message: `📢 名額釋放:「${v.title}」有 ${seats} 個空位，快啲預約啦！`,
          },
        });
        notified++;
        sentForClass++;
      } catch (e) {
        console.error("[VACANCY] notify failed:", e.message);
      }
    }
  }

  return { classes, notified };
}

module.exports = { notifyLargeVacancies };
