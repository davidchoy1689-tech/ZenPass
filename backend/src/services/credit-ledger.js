/**
 * credit-ledger.js — Credits 完整流水賬（2026-10-19，David 要求）
 *
 * 所有 credits 加減（增值、扣堂、退款、迎新、積分兌換、推薦、罰款、管理員調整）
 * 必須經呢個 service，確保：
 *   - users.credits 同流水同步更新
 *   - 每筆有時間、金額（credits）、balance_after、來源、reference、描述
 *   - 可以逐筆對賬（IPO audit 要求）
 */

const { v4: uuidv4 } = require("uuid");

const VALID_TYPES = ["earn", "spend", "refund", "adjust"];

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

/**
 * @param db better-sqlite3 db
 * @param {object} p
 * @param {string} p.userId
 * @param {number} p.credits 正數（earn/refund/adjust+）或負數（spend/adjust-）
 * @param {string} p.type earn|spend|refund|adjust
 * @param {string} [p.source] booking|topup|membership|trial|cancel|referral|points|penalty|admin
 * @param {string} [p.referenceId]
 * @param {string} [p.description]
 * @param {string} [p.actorId] 操作人（admin/system）
 * @param {boolean} [p.allowNegative]
 */
function applyCredits(db, p) {
  const {
    userId,
    type,
    source = null,
    referenceId = null,
    description = null,
    actorId = null,
    allowNegative = false,
  } = p || {};

  if (!userId || !VALID_TYPES.includes(type)) {
    throw new Error("credit-ledger: 參數無效");
  }
  const delta = round1(p.credits);
  if (!delta) {
    const u = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
    return { id: null, balance: round1(u && u.credits), delta: 0, skipped: true };
  }

  const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
  if (!user) throw new Error("credit-ledger: 用戶不存在");

  const current = round1(user.credits || 0);
  const after = round1(current + delta);
  if (after < 0 && !allowNegative) {
    const err = new Error("Credits 不足");
    err.code = "INSUFFICIENT_CREDITS";
    err.current = current;
    err.required = Math.abs(delta);
    throw err;
  }

  db.prepare("UPDATE users SET credits = ?, updated_at = datetime('now') WHERE id = ?").run(after, userId);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO credit_transactions
       (id, user_id, type, credits, balance_after, source, reference_id, description, actor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, type, Math.abs(delta), after, source, referenceId, description, actorId);

  return { id, balance: after, delta, type };
}

/** 讀取流水（給 API 用） */
function listCreditTransactions(db, userId, { limit = 50, offset = 0, type = null } = {}) {
  let sql = `SELECT id, type, credits, balance_after, source, reference_id, description, actor_id, created_at
             FROM credit_transactions WHERE user_id = ?`;
  const params = [userId];
  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  sql += " ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?";
  params.push(Number(limit), Number(offset));
  return db.prepare(sql).all(...params);
}

module.exports = { applyCredits, listCreditTransactions, round1 };
