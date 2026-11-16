/**
 * tz.js — 業務時區（Asia/Hong_Kong）時間工具（2026-11-17）
 *
 * 原則：
 *  - DB 一律存 UTC instant（ISO 字串，帶 Z）
 *  - 業務日曆日／牆鐘時間一律用 HK 計算，唔靠伺服器或瀏覽器 TZ
 *  - 系列平移用「本地日曆日差」，唔用 ms/86400000
 */
const HK_TZ = "Asia/Hong_Kong";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 由 DB 時間字串（帶 Z / offset / 無時區）→ Date（無時區當 UTC） */
function parseDbTime(v) {
  const raw = String(v || "");
  if (!raw) return null;
  const d = /[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? new Date(raw) : new Date(raw.replace(" ", "T") + "Z");
  return isNaN(d) ? null : d;
}

/** 指定時區嘅 Y-M-D 與 HH:MM */
function partsInTimeZone(date, timeZone) {
  const zone = timeZone || HK_TZ;
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const o = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` };
}

/** UTC instant → HK 本地 date/time */
function localPartsOf(date, timeZone) {
  return partsInTimeZone(date, timeZone || HK_TZ);
}

/** YYYY-MM-DD + N 個日曆日（純日期運算） */
function addDaysISO(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 兩個本地日期之間差幾多日曆日 */
function isoDayDelta(fromISO, toISO) {
  const [y1, m1, d1] = String(fromISO).split("-").map(Number);
  const [y2, m2, d2] = String(toISO).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * 本地日期 + 牆鐘 → UTC Date
 * 目前只支援固定 +08:00 嘅 Asia/Hong_Kong（冇 DST）。
 * 其他時區要改用 luxon / Temporal。
 */
function zonedLocalToUtc(dateISO, hhmm, timeZone) {
  const zone = timeZone || HK_TZ;
  if (zone !== HK_TZ) {
    const err = new Error(`此版本只支援 ${HK_TZ} 系列時區`);
    err.status = 409;
    err.code = "TZ_UNSUPPORTED";
    throw err;
  }
  const ms = Date.parse(`${dateISO}T${hhmm}:00+08:00`);
  return isNaN(ms) ? null : new Date(ms);
}

module.exports = {
  HK_TZ,
  pad2,
  parseDbTime,
  partsInTimeZone,
  localPartsOf,
  addDaysISO,
  isoDayDelta,
  zonedLocalToUtc,
};
