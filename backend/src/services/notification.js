/**
 * ZenPass 禪流 - 通知服務 (v2)
 *
 * Channel:
 *   1. in-app — 寫入 notification_logs table，App 內 🔔 icon 顯示
 *   2. browser-push — 透過 Service Worker 推送 (push_subscriptions table)
 *
 * 如需 Telegram/Email，參考 git history 嘅 v1。
 */

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || './data/zenpass.db';

// ── 事件定義 ──────────────────────────────────────────

const EVENT_TEMPLATES = {

  'booking.confirmed': {
    title: '✅ 預約成功',
    message: (data) =>
      `「${data.class_title}」預約成功\n` +
      `📅 ${data.date} ${data.time}\n` +
      `📍 ${data.venue || '待確認'}\n` +
      `教練：${data.coach_name || '—'}`,
    link: '/my-bookings.html'
  },

  'booking.reminder_1h': {
    title: '⏰ 課堂即將開始',
    message: (data) =>
      `仲有 1 小時就上「${data.class_title}」喇！\n` +
      `📅 ${data.date} ${data.time}\n` +
      `📍 ${data.venue || '待確認'}\n` +
      `記得準時到場 🧘`,
    link: '/my-bookings.html'
  },

  'payment.approved': {
    title: '💰 付款已確認',
    message: (data) =>
      `你嘅付款（HK$${data.amount || '—'}）已確認 ✅\n` +
      `「${data.class_title}」預約已生效`,
    link: '/my-bookings.html'
  },

  'payment.rejected': {
    title: '❌ 付款未通過',
    message: (data) =>
      `你嘅付款（HK$${data.amount || '—'}）未獲確認 ❌\n` +
      `原因：${data.reason || '請聯絡管理員'}\n` +
      `預約已被取消，如有疑問請聯絡 ZenPass 客服。`,
    link: '/my-bookings.html'
  },

  'coach.new_booking': {
    title: '📢 新預約',
    message: (data) =>
      `${data.student_name} 已預約你嘅「${data.class_title}」\n` +
      `📅 ${data.date} ${data.time}\n` +
      `💰 HK$${data.amount || '—'}`,
    link: '/coach-dashboard.html'
  },

  'coach.payout_processed': {
    title: '💵 提現已處理',
    message: (data) =>
      `提現 HK$${data.amount} ${data.status === 'approved' ? '✅ 已批准' : '❌ 已駁回'}\n` +
      (data.status === 'approved'
        ? `預計 ${data.eta || '3-5 個工作日'} 內到帳`
        : `原因：${data.reason || '請聯絡管理員'}`),
    link: '/coach-dashboard.html'
  }

};

// ── 事件 → push notification title/message ────────────

function buildPushData(event, title, messageText, link) {
  return JSON.stringify({
    title,
    body: messageText,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: `zenpass-${event}-${Date.now()}`,
    data: { link, event },
    requireInteraction: false,
    vibrate: [200, 100, 200],
    actions: link
      ? [{ action: 'open', title: '查看詳情' }]
      : []
  });
}

// ── 主要 API ──────────────────────────────────────────

/**
 * 發送通知（in-app + 瀏覽器推送）
 *
 * @param {string} event   — 事件名稱
 * @param {object} opts
 * @param {string} opts.recipient  — user_id
 * @param {object} [opts.data]     — 資料
 * @param {string} [opts.title]    — 覆蓋標題
 * @param {string} [opts.message]  — 覆蓋內容
 * @returns {Promise<{id: string, sent: boolean}>}
 */
async function sendNotification(event, { recipient, data, title: overrideTitle, message: overrideMessage } = {}) {
  if (!recipient) {
    console.warn('⚠️ [通知] 跳過：缺少 recipient');
    return { id: null, sent: false };
  }

  const template = EVENT_TEMPLATES[event];
  if (!template) {
    console.warn(`⚠️ [通知] 跳過：未知事件 "${event}"`);
    return { id: null, sent: false };
  }

  const title   = overrideTitle   || template.title;
  const message = overrideMessage || (typeof template.message === 'function' ? template.message(data || {}) : template.message);
  const link    = template.link || '/';
  const notifId = uuidv4();

  // 1. 寫入 in-app notification_logs
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.prepare(`
      INSERT INTO notification_logs (id, user_id, event, title, message, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(notifId, recipient, event, title, message, data ? JSON.stringify(data) : null);
    db.close();
  } catch (err) {
    console.error('❌ [通知] DB 寫入失敗:', err.message);
    return { id: null, sent: false };
  }

  // 2. 瀏覽器推送 (非阻斷)
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    const subs = db.prepare('SELECT subscription FROM push_subscriptions WHERE user_id = ?').all(recipient);
    db.close();

    const pushData = buildPushData(event, title, message, link);

    // VAPID keys 未設定時 fallback — 只記錄，唔 block 流程
    const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

    if (VAPID_PUBLIC && VAPID_PRIVATE && subs.length > 0) {
      const webpush = require('web-push');
      webpush.setVapidDetails(
        'mailto:info@zenpass.hk',
        VAPID_PUBLIC,
        VAPID_PRIVATE
      );

      for (const sub of subs) {
        try {
          await webpush.sendNotification(JSON.parse(sub.subscription), pushData);
        } catch (pushErr) {
          // 過期 subscription — 自動清理
          if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
            const cleanDb = new Database(DB_PATH);
            cleanDb.prepare('DELETE FROM push_subscriptions WHERE subscription = ?').run(sub.subscription);
            cleanDb.close();
          } else {
            console.warn('⚠️ [通知] 推送失敗:', pushErr.message);
          }
        }
      }
    }
  } catch (err) {
    // push 失敗唔影響 in-app 通知
    console.warn('⚠️ [通知] 推送過程錯誤:', err.message);
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`🔔 [${event}] → ${recipient}: ${title}`);
  }

  return { id: notifId, sent: true };
}

/**
 * 通知標記為已讀
 */
function markAsRead(notifId, userId) {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    const result = db.prepare(`
      UPDATE notification_logs SET is_read = 1 WHERE id = ? AND user_id = ?
    `).run(notifId, userId);
    db.close();
    return result.changes > 0;
  } catch (err) {
    console.error('❌ [通知] 標記已讀失敗:', err.message);
    return false;
  }
}

/**
 * 標記全部已讀
 */
function markAllAsRead(userId) {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    const result = db.prepare(`
      UPDATE notification_logs SET is_read = 1 WHERE user_id = ? AND is_read = 0
    `).run(userId);
    db.close();
    return result.changes;
  } catch (err) {
    console.error('❌ [通知] 全部標記已讀失敗:', err.message);
    return 0;
  }
}

/**
 * 查詢未讀數量
 */
function getUnreadCount(userId) {
  try {
    const db = new Database(DB_PATH);
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM notification_logs WHERE user_id = ? AND is_read = 0
    `).get(userId);
    db.close();
    return row ? row.count : 0;
  } catch (err) {
    return 0;
  }
}

/**
 * 查詢通知列表
 */
function getNotifications(userId, { page = 1, limit = 50, unreadOnly = false } = {}) {
  try {
    const db = new Database(DB_PATH);
    let where = 'WHERE user_id = ?';
    const params = [userId];
    if (unreadOnly) { where += ' AND is_read = 0'; }
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const notifications = db.prepare(`
      SELECT id, event, title, message, data, is_read, created_at
      FROM notification_logs ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM notification_logs ${where}
    `).get(...params);

    db.close();
    return { notifications, total: total.count, page, limit, unread: getUnreadCount(userId) };
  } catch (err) {
    console.error('❌ [通知] 查詢失敗:', err.message);
    return { notifications: [], total: 0, page: 1, limit, unread: 0 };
  }
}

module.exports = {
  sendNotification,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  getNotifications,
  EVENT_TEMPLATES
};
