/**
 * ZenPass Push Notification Service
 * 使用 Web Push API 發送瀏覽器推送通知
 * 需要設定 VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */
const webpush = require('web-push');
const Database = require('better-sqlite3');
const DB_PATH = process.env.DB_PATH || './data/zenpass.db';

// 初始化 VAPID
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@zenpass.hk';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

/**
 * 發送推送通知給指定用戶
 */
async function sendPushNotification(userId, title, body, data = {}) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log('📵 [PUSH] VAPID keys not configured, skipping push');
    return { sent: 0, error: 'VAPID not configured' };
  }

  try {
    const db = new Database(DB_PATH);
    const subs = db.prepare('SELECT subscription FROM push_subscriptions WHERE user_id = ?').all(userId);
    db.close();

    let sent = 0;
    for (const row of subs) {
      try {
        const sub = JSON.parse(row.subscription);
        await webpush.sendNotification(sub, JSON.stringify({
          title,
          body,
          ...data,
          icon: '/favicon.png',
          badge: '/favicon.png',
        }));
        sent++;
      } catch (err) {
        console.warn(`📵 [PUSH] Failed to send to ${userId}:`, err.message);
      }
    }
    return { sent, total: subs.length };
  } catch (err) {
    console.error('📵 [PUSH] Error:', err.message);
    return { sent: 0, error: err.message };
  }
}

module.exports = { sendPushNotification };
