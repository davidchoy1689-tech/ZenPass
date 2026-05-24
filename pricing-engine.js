/**
 * ZenPass 定價引擎 — ClassPass 風格定價系統
 * 根據時段動態計算 Credit 消耗
 */

window.ZPricing = (function() {

  // === Time Slot Definitions ===
  // Peak: 平日夜晚 (放工後) — 最高需求，最高定價
  // Standard: 平日日間 — 中等需求
  // Off-peak: 週末全日 — 彈性大，輕微折扣
  var TIME_SLOTS = {
    peak: { weekday: { start: 17, end: 21 } },                    // 平日 17:00-21:00
    standard: { weekday: { start: 9, end: 17 } },                 // 平日 09:00-17:00
    offPeak: { weekday: { start: 6, end: 9 }, weekendAll: true }  // 平日早 + 週末全日
  };

  // === Credit Cost Tiers (based on class price) ===
  // 香港營運成本高，折扣不容過大
  // 離峰折扣上限 ~15%，一般時段接近原價，高峰稍貴
  var CREDIT_COST = {
    basic:   { offPeak: 5, standard: 6, peak: 8 },     // $0-99   e.g. $90→5c=$67(25%off)
    standard:{ offPeak: 7, standard: 9, peak: 12 },    // $100-179 e.g. $120→9c=$121(原價)
    premium: { offPeak: 12, standard: 15, peak: 20 }   // $180+   e.g. $250→15c=$201(20%off)
  };

  // === Determine time slot type ===
  function getTimeSlot(dateStr) {
    var d = new Date(dateStr);
    var hour = d.getHours();
    var day = d.getDay();
    var isWeekend = day === 0 || day === 6;
    
    // Weekend = off-peak (more flexibility for members)
    if (isWeekend) return 'offPeak';
    
    // Weekday peak (evening)
    if (hour >= TIME_SLOTS.peak.weekday.start && hour < TIME_SLOTS.peak.weekday.end) return 'peak';
    
    // Weekday standard (business hours)
    if (hour >= TIME_SLOTS.standard.weekday.start && hour < TIME_SLOTS.standard.weekday.end) return 'standard';
    
    // Weekday early morning = off-peak
    if (hour >= TIME_SLOTS.offPeak.weekday.start && hour < TIME_SLOTS.offPeak.weekday.end) return 'offPeak';
    
    return 'standard'; // fallback
  }

  // === Determine class tier by price ===
  function getTier(priceHkd) {
    if (!priceHkd || priceHkd <= 99) return 'basic';
    if (priceHkd <= 179) return 'standard';
    return 'premium';
  }

  // === Get credits cost for a class at a specific time ===
  function getCreditsCost(priceHkd, startTime) {
    var tier = getTier(priceHkd);
    var slot = getTimeSlot(startTime);
    var costs = CREDIT_COST[tier];
    if (slot === 'peak') return costs.peak;
    if (slot === 'offPeak') return costs.offPeak;
    return costs.standard; // standard time
  }

  // === Get member prices (tighter margins for HK high costs) ===
  function getMemberPrices(priceHkd) {
    return {
      trial: Math.round(priceHkd * 0.85),   // Trial: 15% off (NBF)
      silver: Math.round(priceHkd * 0.8),    // Silver: 20% off
      gold: Math.round(priceHkd * 0.75)      // Gold: 25% off (無限堂數)
    };
  }

  // === Format time slot label ===
  function getTimeLabel(startTime) {
    var slot = getTimeSlot(startTime);
    if (slot === 'peak') return '🔴 高峰時段';
    if (slot === 'offPeak') return '🟢 離峰時段';
    return '🟡 一般時段';
  }

  // === Calculate credits cost with time slot indicator ===
  function getCreditDisplay(priceHkd, startTime) {
    var cost = getCreditsCost(priceHkd, startTime);
    var slot = getTimeSlot(startTime);
    var label = slot === 'peak' ? '🔴 高峰價' : slot === 'offPeak' ? '🟢 離峰價' : '🟡 一般價';
    return {
      cost: cost,
      slot: slot,
      label: label
    };
  }

  return {
    getTimeSlot: getTimeSlot,
    getTier: getTier,
    getCreditsCost: getCreditsCost,
    getMemberPrices: getMemberPrices,
    getTimeLabel: getTimeLabel,
    getCreditDisplay: getCreditDisplay,
    CREDIT_COST: CREDIT_COST
  };

})();
