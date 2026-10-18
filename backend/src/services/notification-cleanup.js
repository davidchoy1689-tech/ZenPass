/**
 * ZenPass — 通知清理（保留財務相關通知）
 * - 已讀：90 日後刪除
 * - 未讀：180 日後刪除（避免永遠累積）
 * 財務／提現／付款類通知永久保留（IPO 審計需要）。
 */

const { getDb } = require("./database");

const KEEP_TYPES = [
  "payment.approved",
  "payment.rejected",
  "payment.new_fps_payme",
  "booking.refunded",
  "coach.payout_processed",
  "payout.requested",
  "credits.topup_confirmed",
  "credits.topup_request",
  "wallet.mismatch",
];

function cleanupNotifications({ now = new Date(), readDays = 90, unreadDays = 180 } = {}) {
  const db = getDb();
  const toSql = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const readCutoff = toSql(now.getTime() - readDays * 86400000);
  const unreadCutoff = toSql(now.getTime() - unreadDays * 86400000);
  const placeholders = KEEP_TYPES.map(() => "?").join(",");

  const readDeleted = db
    .prepare(
      `DELETE FROM notifications
       WHERE is_read = 1 AND created_at < ? AND type NOT IN (${placeholders})`,
    )
    .run(readCutoff, ...KEEP_TYPES).changes;

  const unreadDeleted = db
    .prepare(
      `DELETE FROM notifications
       WHERE is_read = 0 AND created_at < ? AND type NOT IN (${placeholders})`,
    )
    .run(unreadCutoff, ...KEEP_TYPES).changes;

  return { read_deleted: readDeleted, unread_deleted: unreadDeleted };
}

module.exports = { cleanupNotifications, KEEP_TYPES };
