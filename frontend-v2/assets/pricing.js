/**
 * ZenPass 定價（前端唯一入口）
 * 真正嘅來源係後端 GET /api/passes/plans（admin 可改價），呢個模組只做快取＋換算，
 * 避免每個頁面各自寫死 520／960 或者用「單堂 × 4 − 80」呢類舊公式。
 *
 * 用法：
 *   await ZenPassPricing.load();                       // 攞最新 plan（5 分鐘 sessionStorage 快取）
 *   const m = ZenPassPricing.evaluate(160, 1);
 *   m.pass4TotalHkd / m.saving4Hkd / m.worthIt
 */
(function () {
  "use strict";

  const FALLBACK = {
    pack_4: { id: "pack_4", units: 4, priceCents: 52000, validDays: 60 },
    pack_8: { id: "pack_8", units: 8, priceCents: 96000, validDays: 90 },
  };
  const CACHE_KEY = "zp_plans_cache_v1";
  const TTL_MS = 5 * 60 * 1000;

  let state = { ...FALLBACK };
  let loadedAt = 0;

  function applyPlans(plans) {
    if (!Array.isArray(plans)) return;
    const next = { ...FALLBACK };
    for (const p of plans) {
      if (!p || !p.id) continue;
      next[p.id] = {
        id: p.id,
        units: Number(p.units) || next[p.id]?.units || 0,
        priceCents: Number(p.price_cents) || next[p.id]?.priceCents || 0,
        validDays: Number(p.valid_days) || next[p.id]?.validDays || 0,
      };
    }
    state = next;
    loadedAt = Date.now();
  }

  async function load(force) {
    if (!force) {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const c = JSON.parse(raw);
          if (c && Date.now() - c.at < TTL_MS && Array.isArray(c.plans)) {
            applyPlans(c.plans);
            return state;
          }
        }
      } catch (e) {}
    }
    try {
      const res = await fetch("/api/passes/plans", { credentials: "same-origin" });
      const j = await res.json();
      if (j && j.success && Array.isArray(j.plans)) {
        applyPlans(j.plans);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), plans: j.plans })); } catch (e) {}
      }
    } catch (e) {
      /* 離線／API 失敗 → 用 fallback，唔會爆 */
    }
    return state;
  }

  const priceHkd = (key) => Math.round((state[key]?.priceCents || 0) / 100);
  const units = (key) => state[key]?.units || 0;

  /**
   * @param {number} sessionPriceHkd 單堂價（$140 / $160 …；首堂優惠價亦可）
   * @param {number} count 人數（預設 1）
   */
  function evaluate(sessionPriceHkd, count) {
    const unit = Math.max(0, Number(sessionPriceHkd) || 0);
    const qty = Math.max(1, Math.floor(Number(count) || 1));
    const pass4 = priceHkd("pack_4");
    const pass8 = priceHkd("pack_8");
    const u4 = units("pack_4") || 4;
    const u8 = units("pack_8") || 8;
    const saving4 = unit * u4 - pass4;
    const saving8 = unit * u8 - pass8;
    return {
      unitSingleHkd: unit,
      count: qty,
      singleTotalHkd: unit * qty,
      pass4TotalHkd: pass4,
      pass4AvgHkd: u4 ? Math.round(pass4 / u4) : 0,
      pass4Units: u4,
      pass4ValidDays: state.pack_4?.validDays || 60,
      saving4Hkd: Math.max(0, saving4),
      worthIt4: saving4 > 0,
      pass8TotalHkd: pass8,
      pass8AvgHkd: u8 ? Math.round(pass8 / u8) : 0,
      saving8Hkd: Math.max(0, saving8),
      worthIt8: saving8 > 0,
    };
  }

  window.ZenPassPricing = { load, evaluate, priceHkd, units, _state: () => state };
})();
