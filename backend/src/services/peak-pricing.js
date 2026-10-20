/**
 * ZenPass — 高峰時段附加費（feature-flagged，預設關閉）
 *
 * 背景：會籍「標準 Pass」標示 premium_peak 權益，但高峰附加費過去只存在
 * pricing-engine 嘅估算，落單從未實際收費 → 權益無實際作用。
 *
 * 設計：
 *   - 預設 pricing.peak_enabled = 0（完全唔影響現有價格）
 *   - 開啟後：平日 17:00–20:00（HK）課堂 credits 成本 × multiplier（預設 1.15，向上取 0.1）
 *   - 有 premium_peak entitlement（標準 Pass 或以上）→ 豁免
 *   - 所有設定存 platform_settings，可即時調整、可審計
 */
const DEFAULTS = {
  enabled: false,
  multiplier: 1.15,
  days: [1, 2, 3, 4, 5], // 週一至週五
  startHour: 17,
  endHour: 20,
};

function readSetting(db, key, fallback) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
    return r && r.value != null ? r.value : fallback;
  } catch (e) {
    return fallback;
  }
}

function getConfig(db) {
  const enabled = String(readSetting(db, "pricing.peak_enabled", "0")) === "1";
  const multiplier = Number(readSetting(db, "pricing.peak_multiplier", DEFAULTS.multiplier)) || DEFAULTS.multiplier;
  return { ...DEFAULTS, enabled, multiplier };
}

/** 判斷課堂開始時間係咪高峰（以香港時間計算，與資料庫 UTC 儲存無關） */
function isPeakStart(startTime, cfg = DEFAULTS) {
  const d = new Date(startTime);
  if (!d || isNaN(d.getTime())) return false;
  const hk = new Date(d.getTime() + 8 * 3600 * 1000);
  const dow = hk.getUTCDay();
  const hour = hk.getUTCHours();
  return cfg.days.includes(dow) && hour >= cfg.startHour && hour < cfg.endHour;
}

/**
 * 計算實際扣除嘅 credits。
 * @returns {{cost:number, base:number, surcharge:number, peak:boolean, waived:boolean, enabled:boolean}}
 */
function applyPeakSurcharge(db, userId, baseCost, startTime) {
  const cfg = getConfig(db);
  const base = Number(baseCost) || 0;
  const out = { cost: base, base, surcharge: 0, peak: false, waived: false, enabled: cfg.enabled };
  if (!cfg.enabled || !startTime) return out;

  const peak = isPeakStart(startTime, cfg);
  out.peak = peak;
  if (!peak) return out;

  try {
    const { hasEntitlement } = require("./membership-catalog");
    if (hasEntitlement(userId, "premium_peak")) {
      out.waived = true;
      return out;
    }
  } catch (e) {}

  const cost = Math.round(base * cfg.multiplier * 10) / 10;
  out.cost = cost;
  out.surcharge = Math.round((cost - base) * 10) / 10;
  return out;
}

module.exports = { DEFAULTS, getConfig, isPeakStart, applyPeakSurcharge };
