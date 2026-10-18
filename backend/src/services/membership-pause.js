/**
 * ZenPass — 會籍暫停／自動恢復
 * 注意：暫停日數會順延 end_date，同時同步 users.membership_expires_at
 * （否則會員資格／VIP 判斷會用舊日期而失效）
 */

const { getDb } = require("./database");
const { sendNotification } = require("./notification");

function pauseMembership(userId, membershipId, pauseDays, reason, { now = new Date() } = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const days = Math.min(Math.max(parseInt(pauseDays) || 14, 1), 30);

  const m = db
    .prepare("SELECT * FROM memberships WHERE id = ? AND user_id = ?")
    .get(membershipId, userId);
  if (!m) {
    const err = new Error("會籍不存在");
    err.status = 404;
    throw err;
  }
  if (m.status !== "active") {
    const err = new Error("會籍唔係 active 狀態");
    err.status = 400;
    throw err;
  }
  if (m.paused_until && new Date(m.paused_until) > now) {
    const err = new Error("會籍已經暫停緊");
    err.status = 400;
    throw err;
  }
  if ((m.pause_count || 0) >= 3) {
    const err = new Error("已達到最大暫停次數 (3次)");
    err.status = 400;
    throw err;
  }

  const pausedUntil = new Date(now.getTime() + days * 86400000).toISOString();
  const currentEnd = new Date(m.end_date);
  const newEnd = new Date(currentEnd.getTime() + days * 86400000).toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE memberships SET paused_until = ?, pause_count = COALESCE(pause_count, 0) + 1,
         pause_reason = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(pausedUntil, reason || null, newEnd, membershipId);

    // 同步用戶層級到期日（VIP 判斷、我的頁、會員 API 都用呢個）
    db.prepare(
      "UPDATE users SET membership_expires_at = ? WHERE id = ?",
    ).run(newEnd, userId);
  });
  tx();

  try {
    sendNotification("membership.paused", {
      recipient: userId,
      data: { days, end_date: newEnd.slice(0, 10) },
    });
  } catch (e) {}

  return {
    membership_id: membershipId,
    days,
    paused_until: pausedUntil,
    original_end: m.end_date,
    new_end_date: newEnd,
    pause_count: (m.pause_count || 0) + 1,
  };
}

/** 暫停期滿自動恢復 */
function resumeDueMemberships({ now = new Date() } = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  // paused_until 可能係 ISO（新）或 SQLite 格式（舊）→ 用 JS Date 比較最稳
  const due = db
    .prepare(
      `SELECT id, user_id, type, pause_reason, paused_until FROM memberships
       WHERE paused_until IS NOT NULL AND status = 'active'`,
    )
    .all()
    .filter((m) => {
      const t = new Date(String(m.paused_until).replace(" ", "T"));
      return !isNaN(t) && t <= now;
    });

  for (const m of due) {
    db.prepare(
      "UPDATE memberships SET paused_until = NULL, pause_reason = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(m.id);

    try {
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, description, created_at)
         VALUES (?, 'membership.resume', 'membership', ?, 'system', ?, datetime('now'))`,
      ).run(
        require("crypto").randomUUID(),
        m.id,
        `🔄 暫停期滿自動恢復: ${m.type} (用戶: ${m.user_id})`,
      );
    } catch (e) {}

    try {
      sendNotification("membership.resume", { recipient: m.user_id, data: {} });
    } catch (e) {
      console.error("[PAUSE RESUME] notify error:", e.message);
    }
  }

  return due.length;
}

module.exports = { pauseMembership, resumeDueMemberships };
