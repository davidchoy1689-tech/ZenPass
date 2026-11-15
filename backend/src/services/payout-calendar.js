/**
 * payout-calendar.js — 教練出糧日（單一來源）
 *
 * 規則（2026-11-15 David 指示）：每月 7 號 FPS 出糧；遇週六／日順延至下一個工作天。
 * 全部用 UTC 計算（香港無夏令時間，等於 HKT）。
 */
const PAYOUT_DAY = 7;
const WD = ["日", "一", "二", "三", "四", "五", "六"];

/** 由「某月帳目」計下一次出糧日：YYYY-MM → { date, label, weekday, shifted } */
function nextPayoutForMonth(month) {
  let y, m;
  const mm = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (mm) {
    y = Number(mm[1]);
    m = Number(mm[2]);
  } else {
    const hk = new Date(Date.now() + 8 * 3600e3);
    y = hk.getUTCFullYear();
    m = hk.getUTCMonth() + 1;
  }
  const py = m === 12 ? y + 1 : y;
  const pm = m === 12 ? 1 : m + 1;
  const d = new Date(Date.UTC(py, pm - 1, PAYOUT_DAY));
  let shifted = false;
  if (d.getUTCDay() === 6) {
    d.setUTCDate(PAYOUT_DAY + 2);
    shifted = true;
  } else if (d.getUTCDay() === 0) {
    d.setUTCDate(PAYOUT_DAY + 1);
    shifted = true;
  }
  const iso = d.toISOString().slice(0, 10);
  const label = `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, "0")}月${String(d.getUTCDate()).padStart(2, "0")}日（週${WD[d.getUTCDay()]}）`;
  return { date: iso, label, weekday: WD[d.getUTCDay()], shifted, payout_day: PAYOUT_DAY };
}

const RULE_TEXT = `每月 ${PAYOUT_DAY} 號 FPS 出糧；遇週六／日順延至下一個工作天`;

module.exports = { PAYOUT_DAY, RULE_TEXT, nextPayoutForMonth };
