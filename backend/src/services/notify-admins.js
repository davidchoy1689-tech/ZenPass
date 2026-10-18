/**
 * ZenPass — 通知所有 admin（站內 + 現有 channel）
 * 用於公開查詢表單（學校／企業），避免只有 Telegram 一渠道而漏單。
 */

const { getDb } = require("./database");
const { sendNotification } = require("./notification");

function notifyAdmins(type, data = {}) {
  try {
    const db = getDb();
    const admins = db
      .prepare("SELECT id FROM users WHERE role IN ('admin','super_admin','platform_manager')")
      .all();
    for (const a of admins) {
      sendNotification(type, { recipient: a.id, data });
    }
    return admins.length;
  } catch (e) {
    console.error("⚠️ notifyAdmins failed:", e.message);
    return 0;
  }
}

module.exports = { notifyAdmins };
