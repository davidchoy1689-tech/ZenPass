/**
 * 管理員通知（站內 DB 為主，Telegram 有設定時同步）
 * 用於訪客預約、人手付款等需要即時跟進嘅事件。
 */
const { getDb } = require("./database");
const { sendNotification } = require("./notification");

const ADMIN_ROLES = ["admin", "super_admin", "platform_manager"];

function adminIds() {
  try {
    const db = getDb();
    return db
      .prepare(`SELECT id FROM users WHERE role IN (${ADMIN_ROLES.map(() => "?").join(",")})`)
      .all(...ADMIN_ROLES)
      .map((r) => r.id);
  } catch (e) {
    console.error("adminIds failed:", e.message);
    return [];
  }
}

function notifyAdmins(type, data) {
  const ids = adminIds();
  for (const id of ids) {
    try {
      sendNotification(type, { recipient: id, data });
    } catch (e) {
      console.error("notifyAdmins failed:", e.message);
    }
  }
  return ids.length;
}

module.exports = { notifyAdmins, adminIds };
