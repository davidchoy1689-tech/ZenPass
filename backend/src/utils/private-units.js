/**
 * 私人時段扣堂規則（David 2026-11-12 拍板：一對一要抽 3 堂）
 *
 *   1 對 1 → 每節扣 3 堂
 *   1 對 2 → 每位扣 2 堂
 *
 * 鐵律：
 *  1) 一律由伺服器計，唔信前端傳入嘅 pass_units_required
 *  2) 舊資料（教練早前設 2 堂）會自動升級到規則值，唔會少收
 *  3) 只會向上調整（Math.max），唔會擅自減教練設定嘅較高堂數
 */

const UNITS_BY_ATTENDEES = { 1: 3, 2: 2 };
const DEFAULT_UNITS = 3;

/** 依「每節最多幾人」回傳應扣堂數 */
function unitsForPrivate(maxAttendees) {
  const n = Math.floor(Number(maxAttendees) || 0);
  return UNITS_BY_ATTENDEES[n] || DEFAULT_UNITS;
}

/** 實際扣堂 = max(規則值, 已儲存值)——保證唔會少收 */
function resolvePrivateUnits(maxAttendees, storedUnits) {
  const rule = unitsForPrivate(maxAttendees);
  const stored = Math.floor(Number(storedUnits) || 0);
  return Math.max(rule, stored);
}

/** 安全檢查欄位存在（舊 DB 未做 lazily migration 時唔會拋錯） */
function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (e) {
    return false;
  }
}

/**
 * 安全讀取班次是否私人（舊 DB 未有 classes.is_private 欄 → 當普通班，唔會誤扣 3 堂）
 * @returns {{isPrivate:number, maxAttendees:number}}
 */
function classIsPrivate(db, classId) {
  try {
    const row = db.prepare("SELECT is_private, max_participants FROM classes WHERE id = ?").get(classId);
    return {
      isPrivate: Number(row && row.is_private) ? 1 : 0,
      maxAttendees: Number(row && row.max_participants) || 1,
    };
  } catch (e) {
    return { isPrivate: 0, maxAttendees: 1 };
  }
}

module.exports = { unitsForPrivate, resolvePrivateUnits, classIsPrivate, hasColumn, UNITS_BY_ATTENDEES, DEFAULT_UNITS };
