/**
 * ZenPass — Money helper（Phase 1 / S3）
 *
 * 統一用「整數 cents」做金額運算，避免浮點分毫誤差。
 * 例：toCents(33.33) = 3333 ; fromCents(3333) = 33.33
 */

function toCents(x) {
  return Math.round((Number(x) || 0) * 100);
}

function fromCents(c) {
  return Math.round(Number(c) || 0) / 100;
}

/**
 * 按比率拆賬，**用整數 cents 計算**，餘額歸第二方（venue），
 * 保證 platformCents + venueCents === totalCents（唔會差一分）。
 * @returns {{totalCents:number, platformCents:number, venueCents:number, platform:number, venue:number}}
 */
function splitByRate(amount, rate) {
  const totalCents = toCents(amount);
  const r = Number(rate) || 0;
  const platformCents = Math.round(totalCents * r);
  const venueCents = totalCents - platformCents;
  return {
    totalCents,
    platformCents,
    venueCents,
    platform: fromCents(platformCents),
    venue: fromCents(venueCents),
  };
}

module.exports = { toCents, fromCents, splitByRate };
