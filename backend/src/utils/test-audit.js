/**
 * 驗收測試帳目過濾（Phase 6.0）
 *
 * is_acceptance_test = 1 嘅紀錄係週一現場驗收產生嘅測試交易：
 * 保留審計足跡，但**唔可以**計入正式出糧／報稅／營運報表。
 *
 * 用法：
 *   const { notTestClause } = require("../utils/test-audit");
 *   const f = notTestClause(db, "ce");           // " AND COALESCE(ce.is_acceptance_test,0)=0"
 *   db.prepare(`SELECT ... FROM coach_earnings ce WHERE ... ${f}`);
 *
 * 未做 Phase 6.0 migration（欄位未存在）時回傳空字串，唔會爆 SQL。
 */

const cache = new WeakMap();

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (e) {
    return false;
  }
}

function columnReady(db) {
  if (!db) return false;
  if (cache.has(db)) return cache.get(db);
  const ready = hasColumn(db, "coach_earnings", "is_acceptance_test");
  cache.set(db, ready);
  return ready;
}

/** @param {string} [alias] 表別名（例如 "ce" 或 "b"） */
function notTestClause(db, alias) {
  if (!columnReady(db)) return "";
  const prefix = alias ? `${alias}.` : "";
  return ` AND COALESCE(${prefix}is_acceptance_test,0) = 0`;
}

function clearCache() {
  // WeakMap 冇 clear，重新載入模組即重建
}

module.exports = { notTestClause, hasColumn, columnReady, clearCache };
