/**
 * stripe-orders.js — Stripe 付款完成後自動入賬（點數包 / 會籍）
 * ---------------------------------------------------------------------------
 * 為什麼要獨立成 service：
 *   同一段入賬邏輯要由兩個入口呼叫 ——
 *     1) 前端回跳 complete-checkout（用戶關頁前的即時確認）
 *     2) Stripe webhook checkout.session.completed（可靠來源）
 *   重複實作必然 drift，所以收斂於此。
 *
 * 安全規則（IPO audit 級）：
 *   - 只接受 Stripe 回報 payment_status === 'paid'
 *   - 金額必須等於後端價目（唔信前端、唔信 metadata 金額）
 *   - metadata.user_id 必須存在，且唔可以跨用戶
 *   - 以 session.id 作 reference 做唯一性檢查 → 同一 session 只入賬一次
 *   - 全部寫入喺同一個 DB transaction
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const creditLedger = require("./credit-ledger");
const { writeBlock } = require("./blockchain-audit");

const PASS_PACKS = {
  starter: { id: "starter", name: "新手體驗 Pack", amount_hkd: 600, credits: 50, bonus: 0, classes: 5 },
  popular: { id: "popular", name: "熱門超值 Pack", amount_hkd: 1080, credits: 100, bonus: 10, classes: 10 },
  pro: { id: "pro", name: "運動達人 Pack", amount_hkd: 1920, credits: 200, bonus: 0, classes: 20 },
};

function resolvePack(id) {
  return PASS_PACKS[String(id || "")] || null;
}

/** 已入賬？以 reference（Stripe session id）查 */
function alreadyGranted(db, sessionId) {
  const a = db.prepare("SELECT id FROM credit_topup_orders WHERE reference = ? AND status='confirmed'").get(sessionId);
  if (a) return true;
  const b = db.prepare("SELECT id FROM membership_orders WHERE reference = ? AND status='confirmed'").get(sessionId);
  return !!b;
}

/**
 * 點數包入賬
 * @param {object} session Stripe checkout session（需 metadata.pack_id / user_id, amount_total）
 */
function grantCreditsPack(session) {
  const db = getDb();
  const meta = session.metadata || {};
  const pack = resolvePack(meta.pack_id);
  const userId = String(meta.user_id || "");
  const sessionId = String(session.id || "");

  if (!pack) return { ok: false, error: "INVALID_PACK" };
  if (!userId) return { ok: false, error: "MISSING_USER" };
  if (session.payment_status !== "paid") return { ok: false, error: "NOT_PAID" };
  if (Number(session.amount_total) !== pack.amount_hkd * 100) {
    return { ok: false, error: "AMOUNT_MISMATCH", expected: pack.amount_hkd * 100, got: session.amount_total };
  }
  if (alreadyGranted(db, sessionId)) return { ok: true, already: true };

  const total = pack.credits + pack.bonus;
  const orderId = uuidv4();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO credit_topup_orders
         (id, user_id, amount_hkd, original_amount_hkd, discount_percent, credits, bonus_credits, method, reference, status, note, confirmed_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'stripe', ?, 'confirmed', ?, datetime('now'))`,
    ).run(orderId, userId, pack.amount_hkd, pack.amount_hkd, pack.credits, pack.bonus, sessionId, `stripe:${pack.id} ${pack.name}`);

    creditLedger.applyCredits(db, {
      userId,
      credits: total,
      type: "earn",
      source: "topup",
      referenceId: orderId,
      description: `${pack.name}（Stripe ${sessionId}）`,
      actorId: userId,
    });

    db.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, payment_method, description)
       VALUES (?, ?, 'credits_topup', ?, 'stripe', ?)`,
    ).run(uuidv4(), userId, pack.amount_hkd, `${pack.name}：${total} Credits（${sessionId}）`);
  });
  tx();

  try {
    writeBlock({ entityType: "credit_topup", entityId: orderId, data: { user_id: userId, pack: pack.id, amount: pack.amount_hkd, credits: total, stripe_session: sessionId } });
  } catch (e) {}

  try {
    const { sendNotification } = require("./notification");
    sendNotification("credits.topup_confirmed", { recipient: userId, data: { amount: pack.amount_hkd, credits: total } });
  } catch (e) {}

  return { ok: true, order_id: orderId, credits: total };
}

/**
 * 會籍入賬（重用 admin confirm 同一套寫入）
 */
function grantMembership(session) {
  const db = getDb();
  const meta = session.metadata || {};
  const userId = String(meta.user_id || "");
  const planKey = String(meta.plan_key || "");
  const sessionId = String(session.id || "");

  if (!userId || !planKey) return { ok: false, error: "MISSING_META" };
  if (session.payment_status !== "paid") return { ok: false, error: "NOT_PAID" };
  if (alreadyGranted(db, sessionId)) return { ok: true, already: true };

  // 訂單必須存在（建立 session 時已寫入 pending 單）
  const order = db.prepare("SELECT * FROM membership_orders WHERE reference = ? ORDER BY created_at DESC LIMIT 1").get(sessionId);
  if (!order) return { ok: false, error: "ORDER_NOT_FOUND" };
  if (order.status !== "pending") return { ok: true, already: true };
  if (Number(session.amount_total) !== Number(order.price_hkd) * 100) {
    return { ok: false, error: "AMOUNT_MISMATCH", expected: Number(order.price_hkd) * 100, got: session.amount_total };
  }

  const { computeMembershipPeriod } = require("../routes/membership-orders");
  const period = computeMembershipPeriod(db, order.user_id, order.duration_days, new Date());
  const membershipId = uuidv4();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO memberships (id, user_id, type, price_hkd, credits_granted, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(membershipId, order.user_id, order.plan_key, order.price_hkd, order.credits_granted, period.start.toISOString(), period.end.toISOString());

    db.prepare("UPDATE users SET membership_type = ?, membership_expires_at = ? WHERE id = ?")
      .run(order.plan_key, period.end.toISOString(), order.user_id);

    creditLedger.applyCredits(db, {
      userId: order.user_id,
      credits: Number(order.credits_granted) || 0,
      type: "earn",
      source: "membership",
      referenceId: order.id,
      description: `會籍 ${order.plan_key} 贈送 Credits（Stripe）`,
      actorId: userId,
    });

    db.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, payment_method, description)
       VALUES (?, ?, 'membership', ?, 'stripe', ?)`,
    ).run(uuidv4(), order.user_id, order.price_hkd, `會籍 ${order.plan_key}（${sessionId}）`);

    db.prepare(
      `UPDATE membership_orders SET status='confirmed', admin_id=?, confirmed_at=datetime('now'), note=?
       WHERE id=? AND status='pending'`,
    ).run(userId, "Stripe 自動確認", order.id);
  });
  tx();

  return { ok: true, membership_id: membershipId };
}

module.exports = { PASS_PACKS, resolvePack, grantCreditsPack, grantMembership, alreadyGranted };
