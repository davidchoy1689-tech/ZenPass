/**
 * ZenPass 禪流 — WhatsApp 行銷自動化服務
 *
 * Mindbody 用 Email（開信率 ~20%）
 * ZenPass 用 WhatsApp（開信率 ~98%）
 *
 * 序列：
 * 1. 歡迎序列 — 註冊後自動發送
 * 2. 挽回序列 — 30日冇上堂
 * 3. 推廣廣播 — Admin 手動觸發
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";
const { sendNotification } = require("./notification");
const logger = require("./logger");

// ===== 1. 歡迎序列 (Welcome Sequence) =====
async function sendWelcomeSequence(userId, userName) {
  const messages = [
    {
      delay_hours: 0,
      title: "🎉 歡迎加入 ZenPass！",
      body: `Hi ${userName}！歡迎加入 ZenPass 禪流 🧘\n\n你而家可以探索超過 20 種運動課程，包括瑜伽、健身、新興運動等。\n\n👉 立即瀏覽課程：${getBaseUrl()}/explore.html`,
    },
    {
      delay_hours: 24,
      title: "🎯 首次預約賺積分",
      body: `Hi ${userName}，記得完成首次預約賺取積分！\n\n📅 每日簽到 +5 分\n🏋️ 完成課堂 +50 分\n👥 推薦朋友 +100 分\n\n👉 去簽到：${getBaseUrl()}/checkin.html`,
    },
    {
      delay_hours: 72,
      title: "💎 解鎖會籍福利",
      body: `Hi ${userName}，升級會籍可以解鎖更多福利！\n\n🏆 銅牌會員：完成 5 堂課\n🥈 銀牌會員：完成 15 堂課\n🥇 金牌會員：完成 30 堂課\n\n👉 查看會籍：${getBaseUrl()}/membership.html`,
    },
  ];

  for (const msg of messages) {
    try {
      await sendNotification("marketing.welcome", {
        user_id: userId,
        data: {
          title: msg.title,
          message: msg.body,
          delay_hours: msg.delay_hours,
        },
      });
      logger.info(
        `📨 Welcome queued for ${userName}: "${msg.title}" (T+${msg.delay_hours}h)`,
      );
    } catch (err) {
      logger.error(`Welcome sequence error for ${userId}:`, err.message);
    }
  }
}

// ===== 2. 挽回序列 (Win-back) — 30 日冇上堂 =====
async function checkWinBackCandidates() {
  try {
    const db = new Database(DB_PATH);
    const candidates = db
      .prepare(
        `
      SELECT u.id, u.name, u.email, u.last_visit,
        (SELECT MAX(b.created_at) FROM bookings b WHERE b.user_id = u.id) as last_booking
      FROM users u
      WHERE u.role != 'admin'
      AND (
        (SELECT MAX(b.created_at) FROM bookings b WHERE b.user_id = u.id) IS NULL
        OR (SELECT MAX(b.created_at) FROM bookings b WHERE b.user_id = u.id) < datetime('now', '-30 days')
      )
      AND (u.last_visit IS NULL OR u.last_visit < datetime('now', '-30 days'))
    `,
      )
      .all();
    db.close();

    for (const user of candidates) {
      const daysSinceActivity = 30;
      if (daysSinceActivity >= 30) {
        const msg = {
          title: "🏃 我哋掛住你！",
          body: `Hi ${user.name}，好耐冇見你嚟運動啦！\n\n我哋準備咗特別優惠俾你，而家預約可以享有折扣 🎁\n\n👉 立即預約：${getBaseUrl()}/explore.html`,
        };
        await sendNotification("marketing.winback", {
          user_id: user.id,
          data: msg,
        });
        logger.info(`📨 Win-back sent to ${user.name} (${user.email})`);
      }
    }
    return candidates.length;
  } catch (err) {
    logger.error("Win-back check error:", err.message);
    return 0;
  }
}

// ===== 3. 推播廣播 (Broadcast) =====
async function sendBroadcast(subject, message, filters = {}) {
  try {
    const db = new Database(DB_PATH);
    let query = "SELECT id, name, email FROM users WHERE 1=1";
    const params = [];

    if (filters.role) {
      query += " AND role = ?";
      params.push(filters.role);
    }
    if (filters.min_credits !== undefined) {
      query += " AND credits >= ?";
      params.push(filters.min_credits);
    }

    const users = db.prepare(query).all(...params);
    db.close();

    let sent = 0;
    for (const user of users) {
      try {
        await sendNotification("marketing.broadcast", {
          user_id: user.id,
          data: { title: subject, message },
        });
        sent++;
      } catch (err) {
        logger.error(`Broadcast send error for ${user.id}:`, err.message);
      }
    }

    logger.info(
      `📨 Broadcast "${subject}" sent to ${sent}/${users.length} users`,
    );
    return { total: users.length, sent };
  } catch (err) {
    logger.error("Broadcast error:", err.message);
    throw err;
  }
}

function getBaseUrl() {
  return process.env.BASE_URL || "https://davidchoy1689-tech.github.io/ZenPass";
}

// ===== 排程檢查（每小時）=====
let winbackInterval = null;

function startMarketingCron() {
  // Win-back check every 6 hours
  winbackInterval = setInterval(
    async () => {
      const count = await checkWinBackCandidates();
      if (count > 0) {
        logger.info(`📨 Win-back: ${count} candidates notified`);
      }
    },
    6 * 60 * 60 * 1000,
  );

  logger.info("📨 Marketing cron started (win-back every 6h)");
  // Run once on start
  checkWinBackCandidates().catch(() => {});
}

function stopMarketingCron() {
  if (winbackInterval) {
    clearInterval(winbackInterval);
    winbackInterval = null;
  }
}

module.exports = {
  sendWelcomeSequence,
  checkWinBackCandidates,
  sendBroadcast,
  startMarketingCron,
  stopMarketingCron,
};
