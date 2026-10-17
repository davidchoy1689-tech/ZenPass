/**
 * ZenPass — 積分到期
 *
 * 規則（2026-10-17 David）：**連續 12 個月無任何積分活動，累積積分自動失效**
 *  - 任何賺分／扣分（簽到、上堂、兌換）都會刷新「最後活動時間」
 *  - 到期時寫入一筆 expire 交易（負分）＋ audit，餘額歸零
 */

const { getDb } = require("./database");
const { v4: uuidv4 } = require("uuid");

function getExpiryMonths() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'points.expiry_months'").get();
    const n = parseInt(row && row.value, 10);
    return Number.isFinite(n) && n > 0 ? n : 12;
  } catch (e) {
    return 12;
  }
}

function lastActivityAt(db, userId) {
  const tx = db
    .prepare("SELECT MAX(created_at) AS t FROM points_transactions WHERE user_id = ?")
    .get(userId);
  const u = db.prepare("SELECT last_checkin, created_at FROM users WHERE id = ?").get(userId) || {};
  const times = [tx && tx.t, u.last_checkin, u.created_at].filter(Boolean).sort();
  return times.length ? times[times.length - 1] : null;
}

/** 找出「應該到期」嘅用戶（唔會改 DB） */
function listExpiring({ months } = {}) {
  const db = getDb();
  const m = months || getExpiryMonths();
  const cutoff = new Date(Date.now() - m * 30 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const users = db.prepare("SELECT id, name, points FROM users WHERE COALESCE(points,0) > 0").all();
  return users
    .map((u) => ({ ...u, last_activity: lastActivityAt(db, u.id) }))
    .filter((u) => u.last_activity && u.last_activity < cutoff)
    .map((u) => ({ ...u, months: m, cutoff }));
}

/** 執行到期（回傳處理結果） */
function expireInactivePoints({ months, dryRun = false } = {}) {
  const db = getDb();
  const targets = listExpiring({ months });
  const results = [];

  for (const u of targets) {
    const amount = Number(u.points) || 0;
    if (amount <= 0) continue;
    if (dryRun) {
      results.push({ user_id: u.id, points: amount, skipped: "dry_run" });
      continue;
    }
    try {
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO points_transactions (id, user_id, type, points, balance_after, source, description)
           VALUES (?, ?, 'spend', ?, 0, 'other', ?)`,
        ).run(
          uuidv4(), u.id, amount,
          `⏳ 積分到期（連續 ${u.months} 個月未使用）`,
        );
        db.prepare(
          "UPDATE users SET points = 0, points_tier = 'bronze', points_tier_label = '🥉 銅牌', updated_at = datetime('now') WHERE id = ?",
        ).run(u.id);
      });
      tx();
      try {
        const { writeBlock } = require("./blockchain-audit");
        writeBlock({
          entityType: "points_expiry",
          entityId: u.id,
          data: { points: amount, months: u.months, last_activity: u.last_activity },
        });
      } catch (e) {}
      results.push({ user_id: u.id, points: amount, expired: true });
    } catch (e) {
      results.push({ user_id: u.id, points: amount, error: e.message });
    }
  }
  return { checked: targets.length, results };
}

module.exports = { listExpiring, expireInactivePoints, getExpiryMonths, lastActivityAt };
