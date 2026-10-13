/* ZenPass v2 — 香港公眾假期（General Holidays）
 * 排班規則：香港公眾假期不開班（休息）。
 * 清單不含「每個星期日」（星期日運動班照開，只排除特別假期）。
 * 與 backend/src/config/holidays.js 保持同步。
 */
(function () {
  var HK_GENERAL_HOLIDAYS = {
    2026: [
      "2026-01-01",
      "2026-02-17", "2026-02-18", "2026-02-19",
      "2026-04-03", "2026-04-04", "2026-04-06", "2026-04-07",
      "2026-05-01", "2026-05-25", "2026-06-19", "2026-07-01",
      "2026-09-26", "2026-10-01", "2026-10-19",
      "2026-12-25", "2026-12-26",
    ],
  };
  function pad(n) { return String(n).padStart(2, "0"); }
  function dateStr(d) {
    var x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x)) return null;
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  window.HK_GENERAL_HOLIDAYS = HK_GENERAL_HOLIDAYS;
  window.zpIsHoliday = function (date) {
    var s = dateStr(date);
    if (!s) return false;
    var list = HK_GENERAL_HOLIDAYS[s.slice(0, 4)] || [];
    return list.indexOf(s) >= 0;
  };
})();
