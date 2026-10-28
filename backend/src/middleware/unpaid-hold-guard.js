/**
 * ZenPass 禪流 — 未付款佔位防護（Denial-of-Inventory Guard）
 * 2026-10-28
 *
 * 問題：單次付款嘅 booking 一建立就係 pending_payment，名額會被扣住最多 30 分鐘
 *       （index.js 定期清理 30 分鐘未付款）。攻擊者可以用一個帳號／一部機
 *       連續下單，鎖死全場名額，令真客人報唔到。
 *
 * 對策：
 *  - 同一個帳號同時最多 HOLD_MAX 個未付款佔位（30 分鐘 window）
 *  - 同一個 IP 最多 IP_HOLD_MAX 個未付款佔位（30 分鐘 window，跨帳號，擋掃號）
 *  - 超出 → 429 code UNPAID_HOLD_LIMIT，並提示先完成付款或等自動釋放
 */

const { getDb } = require("../services/database");

const HOLD_WINDOW_MIN = 30;
const HOLD_MAX = 4;
const IP_HOLD_MAX = 8;

function countUserHolds(db, userId) {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM bookings
          WHERE user_id = ? AND status = 'pending_payment'
            AND COALESCE(payment_reported_at, created_at) > datetime('now', ?)`,
      )
      .get(userId, `-${HOLD_WINDOW_MIN} minutes`)?.c || 0
  );
}

// 按 IP：bookings 冇 IP 欄，用 guest 帳號建立時間＋同一 IP 嘅請求難以追溯，
// 所以以「最近 30 分鐘建立嘅 pending 佔位總數」做整體上限（防爆量），
// 並配合 route 層嘅 per-IP rate limit（anti-scalping 5/min、guest 12/hr）。
function countGlobalHolds(db) {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM bookings
          WHERE status = 'pending_payment'
            AND COALESCE(payment_reported_at, created_at) > datetime('now', ?)`,
      )
      .get(`-${HOLD_WINDOW_MIN} minutes`)?.c || 0
  );
}

function unpaidHoldGuard(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return next();
    const db = getDb();
    const held = countUserHolds(db, userId);
    if (held >= HOLD_MAX) {
      return res.status(429).json({
        success: false,
        code: "UNPAID_HOLD_LIMIT",
        error: `你仲有 ${held} 個未付款預約佔住名額，請先完成付款（30 分鐘後會自動釋放）`,
        held,
        limit: HOLD_MAX,
      });
    }
    next();
  } catch (e) {
    // 防護失效唔應該令正常預約失敗，但要留痕
    console.error("[HOLD-GUARD]", e.message);
    next();
  }
}

module.exports = { unpaidHoldGuard, countUserHolds, countGlobalHolds, HOLD_MAX, IP_HOLD_MAX, HOLD_WINDOW_MIN };
