/**
 * ZenPass 禪流 — 優惠碼 (promo / coupon) 服務
 *
 * 折扣類型：
 *   - fixed_price    固定價（final = value）
 *   - fixed_discount 減額（final = base - value）
 *   - percent        折扣%（final = base * (1 - value/100)）
 *
 * 所有金額用整數 cents 計算（lib/money），final 唔可以貴過原價、唔可以負數。
 * 兌換會寫入 promo_redemptions（append-only，永久保存，供審計）。
 */

const crypto = require("crypto");
const { toCents, fromCents } = require("../lib/money");

function normalize(code) {
  return String(code || "").trim().toUpperCase();
}

/** 純計算：回 {ok, final_price, discount} */
function computeFinalPrice(basePrice, promo) {
  const baseCents = toCents(basePrice);
  const v = Number(promo.value) || 0;
  let cents;
  if (promo.type === "fixed_price") cents = toCents(v);
  else if (promo.type === "fixed_discount") cents = baseCents - toCents(v);
  else if (promo.type === "percent") cents = Math.round(baseCents * (1 - v / 100));
  else return { ok: false, error: "未知折扣類型" };

  if (cents < 0) cents = 0;
  if (cents > baseCents) cents = baseCents; // 唔可以貴過原價
  return { ok: true, final_price: fromCents(cents), discount: fromCents(baseCents - cents) };
}

/** 驗證優惠碼（唔改狀態）。回 {ok, promo, final_price, discount} 或 {ok:false,error} */
function validatePromo(db, { code, basePrice, classId, userId }) {
  const c = normalize(code);
  if (!c) return { ok: false, error: "請輸入優惠碼" };

  const promo = db.prepare("SELECT * FROM promo_codes WHERE code = ? AND active = 1").get(c);
  if (!promo) return { ok: false, error: "優惠碼無效" };

  const now = new Date();
  if (promo.valid_from && new Date(promo.valid_from) > now) return { ok: false, error: "優惠碼未生效" };
  if (promo.valid_to && new Date(promo.valid_to) < now) return { ok: false, error: "優惠碼已過期" };
  if (promo.class_id && classId) {
    // class_id 可為單一 id，或逗號分隔多個 id（例如 A班,B班）
    const allowed = String(promo.class_id)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(classId))
      return { ok: false, error: "此優惠碼唔適用於此課程" };
  }
  if (promo.max_uses != null && promo.used_count >= promo.max_uses)
    return { ok: false, error: "優惠碼已用完" };
  if (promo.per_user_limit && userId) {
    const used = db
      .prepare("SELECT COUNT(*) c FROM promo_redemptions WHERE code_id = ? AND user_id = ?")
      .get(promo.id, userId).c;
    if (used >= promo.per_user_limit) return { ok: false, error: "你已用過此優惠碼" };
  }

  const price = computeFinalPrice(basePrice, promo);
  if (!price.ok) return price;
  return { ok: true, promo, final_price: price.final_price, discount: price.discount };
}

/** 兌換（原子）：used_count+1 + 寫 redemption。喺 booking transaction 內呼叫。 */
function redeemPromo(db, promoId, userId, bookingId, amount) {
  db.prepare("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?").run(promoId);
  db.prepare(
    "INSERT INTO promo_redemptions (id, code_id, user_id, booking_id, amount, created_at) VALUES (?,?,?,?,?,datetime('now'))",
  ).run(crypto.randomUUID(), promoId, userId || null, bookingId || null, amount != null ? Number(amount) : null);
}

module.exports = { normalize, computeFinalPrice, validatePromo, redeemPromo };
