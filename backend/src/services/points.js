/**
 * ZenPass 禪流 - 積分核心服務
 * 統一處理：等級計算、積分交易寫入、一次性獎勵（防重複發放）
 *
 * 積分（Points）同 Credits 完全分開：
 * - Points = 免費獎勵分，用嚟換禮品／折扣碼
 * - Credits = 課金點數，用嚟預約課堂
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");

// ===== 等級門檻定義 =====
const TIERS = [
  { id: "bronze", label: "🥉 銅牌", minPoints: 0, color: "#CD7F32" },
  { id: "silver", label: "🥈 銀牌", minPoints: 500, color: "#C0C0C0" },
  { id: "gold", label: "🥇 金牌", minPoints: 2000, color: "#FFD700" },
  { id: "diamond", label: "💎 鑽石", minPoints: 5000, color: "#B9F2FF" },
];

// ===== 賺分規則（單一來源；前端文案跟呢度）=====
const EARN_RULES = {
  booking: 50, // 完成一堂（QR 簽到）
  review: 20, // 課後評價
  referral: 100, // 推薦朋友（推薦人）
  checkin: 5, // 每日簽到（另有連續獎勵，於 routes/points.js 處理）
};

/** 計算等級 */
function calcTier(points) {
  let current = TIERS[0];
  let next = TIERS[1];
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (points >= TIERS[i].minPoints) {
      current = TIERS[i];
      next = TIERS[i + 1] || null;
      break;
    }
  }
  return { current, next };
}

/**
 * 寫入積分交易紀錄 + 更新用戶積分（唔做防重複，內部用）
 */
function addPointsTx(userId, type, points, source, description, referenceId) {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  const user = db.prepare("SELECT points FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  const currentPoints = user.points || 0;
  const delta = type === "earn" ? points : -points;
  const newBalance = Math.max(0, currentPoints + delta);
  const tier = calcTier(newBalance);

  const txId = uuidv4();
  db.prepare(
    `
    INSERT INTO points_transactions (id, user_id, type, points, balance_after, source, reference_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    txId,
    userId,
    type,
    points,
    newBalance,
    source,
    referenceId || null,
    description || null,
  );

  db.prepare(
    `
    UPDATE users SET points = ?, points_tier = ?, points_tier_label = ?, updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(newBalance, tier.current.id, tier.current.label, userId);

  return { txId, points: newBalance, tier: tier.current, awarded: type === "earn" ? points : -points };
}

/**
 * 一次性獎勵（同一個 source + reference_id 只會發一次）
 * 用於：完成課堂、課後評價、推薦朋友 —— 避免重複點擊／重送 request 重複加分。
 *
 * @returns {{awarded:number,balance:number,tier:object}|{skipped:true,reason:string}}
 */
function awardPointsOnce(userId, { points, source, referenceId, description }) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  if (!userId || !points || points <= 0) {
    return { skipped: true, reason: "invalid_args" };
  }
  if (!referenceId) {
    return { skipped: true, reason: "missing_reference" };
  }

  return db.transaction(() => {
    const dup = db
      .prepare(
        `SELECT id FROM points_transactions
         WHERE user_id = ? AND type = 'earn' AND source = ? AND reference_id = ?
         LIMIT 1`,
      )
      .get(userId, source, referenceId);
    if (dup) return { skipped: true, reason: "already_awarded" };

    const res = addPointsTx(userId, "earn", points, source, description, referenceId);
    if (!res) return { skipped: true, reason: "user_not_found" };
    return { awarded: points, balance: res.points, tier: res.tier };
  })();
}

module.exports = {
  TIERS,
  EARN_RULES,
  calcTier,
  addPointsTx,
  awardPointsOnce,
};
