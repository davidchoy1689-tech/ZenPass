/**
 * ZenPass — Credit 到期預警排程器
 *
 * 每月通知 membership 用戶 credit 即將到期重置。
 * Credits 係月費 Plan 嘅每月配額，每月 1 號歸零（由 corporate-reset.js 處理實際 reset）。
 *
 * 排程：
 * - 每日 check 係咪 25-30 號/31 號，如是則通知所有 active membership 用戶
 * - 通知類型：credit_expiring
 * - 到期前 2 天提醒（即 28-30 號發送）
 */

const { sendNotification } = require("./notification");
const { getDb } = require("./database");

// Plan names for notification messages
const PLAN_NAMES = {
  lite: "輕量 Pass ($299)",
  standard: "標準 Pass ($799)",
  silver: "高階 Pass ($1899)",
  gold: "VIP Pass ($2899)",
};

/**
 * 發送 Credit 到期通知
 * 檢查所有 active membership 用戶，如有剩餘 credits 則發通知
 */
function sendCreditExpiryNotifications({ now = new Date() } = {}) {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 香港時間
    const hk = new Date(now.getTime() + 8 * 3600 * 1000);
    const year = hk.getUTCFullYear();
    const month = hk.getUTCMonth(); // 0-based
    const expiryDateStr = `${month === 11 ? year + 1 : year}-${String(((month + 1) % 12) + 1).padStart(2, "0")}-01`;

    // 本月（HKT）已通知過就唔再發（避免每小時重複）
    const monthStartUtc = new Date(Date.UTC(year, month, 1) - 8 * 3600 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");

    // 尋找所有有 active membership 嘅用戶，而且有剩餘 credits
    const users = db
      .prepare(
        `
      SELECT u.id, u.name, u.email, u.credits, u.membership_type, 
             m.id as membership_id, m.type as plan_type
      FROM users u
      JOIN memberships m ON u.id = m.user_id
      WHERE m.status = 'active'
        AND u.membership_type IS NOT NULL 
        AND u.membership_type != 'none'
        AND u.credits > 0
      GROUP BY u.id
    `,
      )
      .all();

    let notified = 0;
    const today = new Date();

    for (const user of users) {
      try {
        const already = db
          .prepare(
            `SELECT 1 FROM notifications
             WHERE user_id = ? AND type = 'credit_expiring' AND created_at >= ? LIMIT 1`,
          )
          .get(user.id, monthStartUtc);
        if (already) continue;

        const planName = PLAN_NAMES[user.membership_type] || `月費 Plan`;

        sendNotification("credit_expiring", {
          recipient: user.id,
          data: {
            plan_name: planName,
            expiry_date: expiryDateStr,
            remaining_credits: user.credits,
            membership_type: user.membership_type,
          },
        });

        console.log(
          `⏰ [CREDIT EXPIRY] 已通知 ${user.name}（${user.id}）: ${user.credits} cr 將於 ${expiryDateStr} 到期`,
        );
        notified++;
      } catch (notifErr) {
        console.error(
          `⏰ [CREDIT EXPIRY] 通知發送失敗 (user=${user.id}):`,
          notifErr.message,
        );
      }

      // Rate limit: small delay between each
      if (notified % 10 === 0) {
        // Every 10 users, sync
      }
    }

    if (notified > 0) {
      console.log(
        `⏰ [CREDIT EXPIRY] 已完成，共通知 ${notified} 個用戶`,
      );
    }
    return notified;
  } catch (err) {
    console.error("⏰ [CREDIT EXPIRY] Error:", err.message);
    return 0;
  }
}

/**
 * 檢查今日是否係發送到期通知嘅日子
 * 策略：每月 28-31 號（到期前約 1-3 天）
 */
function isExpiryCheckDay(now = new Date()) {
  // 用香港時間判斷「月尾最後 3 日」
  const hk = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = hk.getUTCFullYear();
  const m = hk.getUTCMonth();
  const day = hk.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return day >= lastDay - 2 && day <= lastDay;
}

// ===== Scheduler runner =====
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // every hour

let schedulerTimer = null;

function startCreditScheduler() {
  console.log("⏰ [CREDIT EXPIRY] Credit 到期通知排程器已啟動");

  // Check immediately on startup
  checkAndNotify();

  // Check every hour
  schedulerTimer = setInterval(checkAndNotify, CHECK_INTERVAL_MS);
}

function checkAndNotify() {
  if (isExpiryCheckDay()) {
    const count = sendCreditExpiryNotifications();
    if (count > 0) {
      console.log(`⏰ [CREDIT EXPIRY] 已自動發送 ${count} 個到期通知`);
    }
  }
}

function stopCreditScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  startCreditScheduler,
  stopCreditScheduler,
  sendCreditExpiryNotifications,
  isExpiryCheckDay,
};
