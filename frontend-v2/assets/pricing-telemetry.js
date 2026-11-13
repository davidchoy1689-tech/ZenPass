/**
 * Phase 6.1 定價遙測（前端）
 * - 零阻塞：sendBeacon，唔會卡住結帳
 * - 去重：同一 session + 同一 schedule 只記一次 checkout_view（避免改數量／返回再入重複計）
 * - 失敗完全靜默，唔影響任何流程
 */
(function () {
  "use strict";

  const ENDPOINT = "/api/analytics/pricing-event";
  const SEEN_KEY = "zp_pricing_seen_v1";

  function seenSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function markSeen(key) {
    try {
      const s = seenSet(); s.add(key);
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-50)));
    } catch (e) {}
  }

  function send(payload) {
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch (e) {}
  }

  const Telemetry = {
    /** 結帳頁曝光（分母）。同 session 同 schedule 只記一次。 */
    view({ classId, scheduleId, sessionPrice, pass4Price, saving }) {
      const key = "v:" + (scheduleId || classId || "na") + ":" + sessionPrice;
      if (seenSet().has(key)) return;
      markSeen(key);
      send({
        event_type: "checkout_view",
        class_id: classId || null,
        schedule_id: scheduleId || null,
        session_price_hkd: Number(sessionPrice) || 0,
        pass4_price_hkd: Number(pass4Price) || 520,
        shown_saving_hkd: Math.max(0, Number(saving) || 0),
      });
    },
    /** 實際轉換（分子）。 */
    convert({ classId, scheduleId, sessionPrice, selectedSku, revenueCents }) {
      send({
        event_type: "checkout_converted",
        class_id: classId || null,
        schedule_id: scheduleId || null,
        session_price_hkd: Number(sessionPrice) || 0,
        selected_sku: selectedSku || "single",
        revenue_cents: Math.max(0, Math.round(Number(revenueCents) || 0)),
      });
    },
  };

  window.ZenPassTelemetry = Telemetry;
})();
