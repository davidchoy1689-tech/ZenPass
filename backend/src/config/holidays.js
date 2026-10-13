/**
 * ZenPass 禪流 — 香港公眾假期（General Holidays）
 * 用途：排班規則「香港公眾假期不開班（休息）」嘅單一資料來源。
 * 注意：政府每年憲報公布，需每年更新。此清單不含「每個星期日」
 *       （星期日係公眾假期，但運動班通常照開，故只列特別假期）。
 * 來源：GovHK General holidays（https://www.gov.hk/en/about/abouthk/holiday/）
 */

const HK_GENERAL_HOLIDAYS = {
  // 2026
  2026: [
    "2026-01-01", // 一月一日
    "2026-02-17", // 農曆年初一
    "2026-02-18", // 農曆年初二
    "2026-02-19", // 農曆年初三
    "2026-04-03", // 耶穌受難節
    "2026-04-04", // 耶穌受難節翌日
    "2026-04-06", // 清明節翌日
    "2026-04-07", // 復活節星期一翌日
    "2026-05-01", // 勞動節
    "2026-05-25", // 佛誕翌日
    "2026-06-19", // 端午節
    "2026-07-01", // 香港特別行政區成立紀念日
    "2026-09-26", // 中秋節翌日
    "2026-10-01", // 國慶日
    "2026-10-19", // 重陽節翌日
    "2026-12-25", // 聖誕節
    "2026-12-26", // 聖誕節後第一個周日
  ],
};

// 當地日期字串 YYYY-MM-DD（用系統本地時區，伺服器為 Asia/Hong_Kong）
function toDateStr(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

// 回傳該日期（Date 或 ISO 字串）是否為香港特別公眾假期
function isPublicHoliday(date) {
  const s = toDateStr(date);
  if (!s) return false;
  return (HK_GENERAL_HOLIDAYS[s.slice(0, 4)] || []).includes(s);
}

module.exports = { HK_GENERAL_HOLIDAYS, isPublicHoliday, toDateStr };
