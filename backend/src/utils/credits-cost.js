/**
 * 課程 Credits 成本正規化
 * ----------------------
 * 規則：1 Credit = HK$10。
 * 任何「有價錢但 credits_cost 冇設／設成 0」嘅課程，都會令 Credits 付款變成
 * 免費預約（2026-11-08 booking 9fc05033 就係咁發生）。
 * 所有寫入／計算 credits 成本嘅地方都要經過呢個 helper。
 */

function normalizeCreditsCost(creditsCost, priceHkd) {
  const price = Number(priceHkd) || 0;
  const credits = Number(creditsCost);
  if (Number.isFinite(credits) && credits > 0) return credits;
  if (price > 0) return Math.round(price / 10);
  return 0;
}

/** 1 Credit = HK$10：由價錢計應扣 credits（有價錢最少 1 個） */
function creditsForPrice(priceHkd) {
  const price = Number(priceHkd) || 0;
  if (price <= 0) return 0;
  return Math.max(1, Math.round(price / 10));
}

/**
 * 保證 credits 成本唔會低過價錢（2026-11-12：私人班曾設 credits_cost = 扣堂數，
 * 令 HK$280 私人班用 3 credits（HK$30）就買到）。只會向上調，唔會減。
 */
function atLeastPriceCredits(creditsCost, priceHkd) {
  const byPrice = creditsForPrice(priceHkd);
  const credits = Number(creditsCost) || 0;
  return Math.max(credits, byPrice);
}

module.exports = { normalizeCreditsCost, creditsForPrice, atLeastPriceCredits };
