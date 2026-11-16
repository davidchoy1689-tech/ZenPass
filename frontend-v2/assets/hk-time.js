/**
 * hk-time.js — ZenPass 業務時區（Asia/Hong_Kong，固定 +08:00）
 *
 * 原則：
 *  - DB 存 UTC instant（ISO 帶 Z）
 *  - DB 讀出嚟嘅 "YYYY-MM-DD HH:mm:ss"（冇時區）一律當 UTC
 *  - 顯示／輸入全部用 HK 牆鐘，唔靠瀏覽器 TZ
 *
 * 用法：
 *   HkTime.dateOf(x.start_time)   → "2026-11-25"
 *   HkTime.timeOf(x.start_time)   → "12:00"
 *   HkTime.fmtShort(x.start_time) → "11月25日(週二) 12:00"
 *   HkTime.localToIso("2026-11-25","12:00") → "2026-11-25T04:00:00.000Z"
 */
(function (global) {
  var TZ = "Asia/Hong_Kong";

  // 同 new Date() 一樣：解讀失敗回 Invalid Date（唔回 null），令現有 isNaN(d) 檢查照work
  function parse(v) {
    if (v instanceof Date) return v;
    var raw = String(v == null ? "" : v).trim();
    if (!raw) return new Date(NaN);
    return /[zZ]$|[+-]\d\d:?\d\d$/.test(raw)
      ? new Date(raw)
      : new Date(raw.replace(" ", "T") + "Z"); // 冇時區 → 當 UTC（同 DB 一致）
  }

  function parts(v) {
    var d = parse(v);
    if (!d) return { date: "", time: "" };
    var f = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    var o = {};
    f.formatToParts(d).forEach(function (p) {
      if (p.type !== "literal") o[p.type] = p.value;
    });
    return { date: o.year + "-" + o.month + "-" + o.day, time: o.hour + ":" + o.minute };
  }

  function dateOf(v) { return parts(v).date; }
  function timeOf(v) { return parts(v).time; }
  function today() { return parts(new Date()).date; }

  function localToIso(dateISO, hhmm) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO))) return null;
    var t = String(hhmm || "").slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(t)) return null;
    var ms = Date.parse(dateISO + "T" + t + ":00+08:00");
    return isNaN(ms) ? null : new Date(ms).toISOString();
  }

  function fmtShort(v) {
    var d = parse(v);
    if (!d) return String(v == null ? "" : v);
    return new Intl.DateTimeFormat("zh-HK", {
      timeZone: TZ,
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }

  global.HkTime = {
    TZ: TZ,
    parse: parse,
    parts: parts,
    dateOf: dateOf,
    timeOf: timeOf,
    today: today,
    localToIso: localToIso,
    fmtShort: fmtShort,
  };
})(typeof window !== "undefined" ? window : globalThis);
