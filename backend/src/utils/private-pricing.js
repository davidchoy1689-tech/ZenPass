/**
 * 私人時段定價帶（David 2026-11-12 拍板）
 *
 *   • 私人（1 對 1／1 對 2）每節 = 50–60 credits（1 credit = HK$10 → HK$500–600）
 *   • 詳細定價由開班教練自己決定，只需落在平台帶內
 *   • 帶可由 platform_settings 調整，唔使改 code：
 *       pricing.private_credits_min / pricing.private_credits_max
 */

const DEFAULT_MIN_CREDITS = 50;
const DEFAULT_MAX_CREDITS = 60;

function readInt(db, key, fallback) {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
    const n = Number(row && row.value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  } catch (e) {
    return fallback;
  }
}

/** 目前生效嘅定價帶（credits） */
function priceBand(db) {
  const min = readInt(db, "pricing.private_credits_min", DEFAULT_MIN_CREDITS);
  const max = readInt(db, "pricing.private_credits_max", DEFAULT_MAX_CREDITS);
  return { minCredits: Math.min(min, max), maxCredits: Math.max(min, max) };
}

/** 價錢（cents）→ credits（1 credit = HK$10） */
function creditsFromPriceCents(priceCents) {
  const n = Number(priceCents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round(n / 1000));
}

/**
 * 驗證教練輸入嘅定價
 * @returns {{ok:boolean, credits?:number, price_cents?:number, band:object, error?:string}}
 */
function validatePrivatePrice(db, priceCents) {
  const band = priceBand(db);
  const credits = creditsFromPriceCents(priceCents);
  if (!credits || credits < band.minCredits || credits > band.maxCredits) {
    return {
      ok: false,
      band,
      credits,
      error: `私人時段定價必須 HK$${band.minCredits * 10}–${band.maxCredits * 10}（${band.minCredits}–${band.maxCredits} credits）`,
    };
  }
  return { ok: true, band, credits, price_cents: credits * 1000 };
}

module.exports = {
  priceBand,
  validatePrivatePrice,
  creditsFromPriceCents,
  DEFAULT_MIN_CREDITS,
  DEFAULT_MAX_CREDITS,
};
