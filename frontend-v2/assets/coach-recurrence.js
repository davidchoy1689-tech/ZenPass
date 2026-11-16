/**
 * coach-recurrence.js — 每週重複開班：日期展開 + 預覽文案（2026-11-17）
 *
 *   CoachRecurrence.expandWeekly("2026-11-18", { mode: "count", count: 4 })
 *   CoachRecurrence.expandWeekly("2026-11-18", { mode: "until", until: "2026-12-16" })
 *   CoachRecurrence.formatPreview(dates)
 */
(function (global) {
  var MAX_WEEKS = 52; // 硬上限：1 年

  function pad(n) { return String(n).padStart(2, "0"); }
  function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseISO(iso) {
    var p = String(iso || "").split("-").map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function addDays(date, n) {
    var x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  /**
   * @param {string} startISO 首堂日期 YYYY-MM-DD
   * @param {{mode?:'count'|'until', count?:number, until?:string}} opt
   * @returns {string[]} 日期（含首堂，最多 52 個）
   */
  function expandWeekly(startISO, opt) {
    opt = opt || {};
    var start = parseISO(startISO);
    if (isNaN(start.getTime())) return [];
    var dates = [];
    var mode = opt.mode || "count";

    if (mode === "until" && opt.until) {
      var until = parseISO(opt.until);
      if (isNaN(until.getTime()) || until < start) return [toISO(start)];
      var cur = start;
      while (cur <= until && dates.length < MAX_WEEKS) {
        dates.push(toISO(cur));
        cur = addDays(cur, 7);
      }
      return dates;
    }

    var count = Math.min(MAX_WEEKS, Math.max(1, Number(opt.count) || 1));
    for (var i = 0; i < count; i++) dates.push(toISO(addDays(start, i * 7)));
    return dates;
  }

  function formatPreview(dates) {
    if (!dates || !dates.length) return "無效日期";
    if (dates.length === 1) return "只開 1 堂：" + dates[0];
    var head = dates.slice(0, 3).join("、");
    return "將開 " + dates.length + " 堂：" + head + (dates.length > 3 ? " …" : "") +
      "（至 " + dates[dates.length - 1] + "）";
  }

  global.CoachRecurrence = {
    expandWeekly: expandWeekly,
    formatPreview: formatPreview,
    parseISO: parseISO,
    toISO: toISO,
    MAX_WEEKS: MAX_WEEKS,
  };
})(window);
