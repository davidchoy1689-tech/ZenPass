/**
 * Phase 5.3 — 分帳整數精度（Cents Precision）
 *
 * 鐵律：
 *  1) 一律以「分」（cents, integer）計算，杜绝浮點誤差
 *  2) 教練份額無條件向下取整（Math.floor），餘額歸平台
 *  3) 恆等式：coachNetCents + platformFeeCents === totalCents
 *
 * 例：HK$130 → 13000c，教練 10400c（$104）、平台 2600c（$26）
 *     HK$160 → 16000c，教練 12800c（$128）、平台 3200c（$32）
 *     HK$95（85折後 16 捨 5 入）→ 9500c，教練 7600c、平台 1900c
 */

const DEFAULT_RATE = 0.8;

function toCents(hkd) {
  const n = Number(hkd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * 計算單一席位／整個班次嘅分帳
 * @param {number} paidAmountHkd 實付港幣（每席）
 * @param {{enrolled?:number, rate?:number}} opts
 * @returns {{unitCents:number,totalCents:number,coachNetCents:number,platformFeeCents:number,rate:number,enrolled:number}}
 */
function calculateCoachEarning(paidAmountHkd, opts = {}) {
  const enrolled = Math.max(1, Math.floor(Number(opts.enrolled) || 1));
  const rate = Number.isFinite(Number(opts.rate)) && Number(opts.rate) > 0 && Number(opts.rate) <= 1
    ? Number(opts.rate)
    : DEFAULT_RATE;

  const unitCents = toCents(paidAmountHkd);
  const totalCents = unitCents * enrolled;
  const coachNetCents = Math.floor(totalCents * rate);
  const platformFeeCents = totalCents - coachNetCents;

  return { unitCents, totalCents, coachNetCents, platformFeeCents, rate, enrolled };
}

const centsToHkd = (cents) => Math.round(Number(cents) || 0) / 100;

module.exports = { calculateCoachEarning, toCents, centsToHkd, DEFAULT_RATE };
