/**
 * 租場定價（2026-10-19）
 *
 * 每小時租金由場地（商戶後台）自行設定，伺服器只認 DB 值。
 * 預設 HK$300/hr — 參考香港瑜伽／舞蹈／活動場地常見區間（約 HK$200–600/hr）。
 */
const DEFAULT_RENTAL_PRICE_PER_HOUR = 300;

function hourlyRateForVenue(venue) {
  const rate = Number(venue && venue.rental_price_per_hour);
  if (Number.isFinite(rate) && rate > 0) return rate;
  return DEFAULT_RENTAL_PRICE_PER_HOUR;
}

/** 按時數計租金（整數港幣，同前端顯示一致） */
function rentalTotal(venue, startTime, endTime) {
  const hours = (new Date(endTime) - new Date(startTime)) / 3600000;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.max(1, Math.round(hourlyRateForVenue(venue) * hours));
}

module.exports = {
  DEFAULT_RENTAL_PRICE_PER_HOUR,
  hourlyRateForVenue,
  rentalTotal,
};
