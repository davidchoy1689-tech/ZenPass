/**
 * ZenPass — 會籍到期檢查／通知
 * - 到期前 7 日通知一次、到期前 1 日再通知一次（每個 end_date 每個 stage 只發一次）
 * - 過期會籍自動標記 expired
 */

const { getDb } = require("./database");
const { sendNotification } = require("./notification");

function hkDateStr(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function checkExpiringMemberships({ now = new Date() } = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const today = hkDateStr(now);
  const plus7 = hkDateStr(new Date(now.getTime() + 7 * 86400000));

  const expiring = db
    .prepare(
      `SELECT m.id, m.user_id, m.end_date, m.type, m.plan_id, u.email, u.name
       FROM memberships m JOIN users u ON m.user_id = u.id
       WHERE m.status = 'active'
         AND date(m.end_date) >= date(?)
         AND date(m.end_date) <= date(?)`,
    )
    .all(today, plus7);

  let notified = 0;
  for (const m of expiring) {
    try {
      const endMs = Date.parse(String(m.end_date).slice(0, 10) + "T00:00:00Z");
      const daysLeft = Number.isFinite(endMs)
        ? Math.ceil((endMs - now.getTime()) / 86400000)
        : null;
      const stage = daysLeft != null && daysLeft <= 1 ? "1d" : "7d";

      const ins = db
        .prepare(
          "INSERT OR IGNORE INTO membership_expiry_notices (membership_id, end_date, stage) VALUES (?, ?, ?)",
        )
        .run(m.id, String(m.end_date).slice(0, 10), stage);
      if (!ins.changes) continue;

      sendNotification("membership.expiring", {
        recipient: m.user_id,
        data: {
          end_date: String(m.end_date).slice(0, 10),
          days_left: daysLeft,
          plan: m.type || m.plan_id,
        },
      });
      notified++;
    } catch (e) {
      console.error("[MEMBERSHIP CHECK] notify error (" + m.id + "):", e.message);
    }
  }

  // 逐個過期會籍處理，順便清 users 層級狀態（避免我的頁顯示已過期會籍為現有會籍）
  const toExpire = db
    .prepare(
      "SELECT id, user_id FROM memberships WHERE status = 'active' AND date(end_date) < date(?)",
    )
    .all(today);

  let expiredCount = 0;
  for (const m of toExpire) {
    db.prepare(
      "UPDATE memberships SET status = 'expired', updated_at = datetime('now') WHERE id = ?",
    ).run(m.id);
    expiredCount++;

    const stillActive = db
      .prepare(
        "SELECT 1 FROM memberships WHERE user_id = ? AND status = 'active' AND date(end_date) >= date(?) LIMIT 1",
      )
      .get(m.user_id, today);
    if (!stillActive) {
      db.prepare(
        "UPDATE users SET membership_type = 'none', membership_expires_at = NULL WHERE id = ?",
      ).run(m.user_id);
    }
  }

  return { expiring: expiring.length, notified, expired: expiredCount };
}

module.exports = { checkExpiringMemberships };
