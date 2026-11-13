/**
 * Phase 6.1：定價曝光／轉換遙測 + 營收影響摘要
 *
 * 只讀分析，不影響任何交易表。表由 services/migrate-schema.js 以 idempotent 方式建立。
 *
 *   POST /api/analytics/pricing-event         （公開，前端 sendBeacon；有限流）
 *   GET  /api/analytics/revenue-impact-summary（管理員）
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const VALID_EVENTS = new Set(["checkout_view", "checkout_converted"]);
const VALID_SKU = new Set(["single", "pack_4", "pack_8", null]);

// 極簡記憶體限流：每個 IP 每分鐘最多 60 次（遙測用，唔想寫入被濫用）
const RATE = new Map();
function limited(ip) {
  const now = Date.now();
  const k = String(ip || "unknown");
  const rec = RATE.get(k);
  if (!rec || now - rec.at > 60000) {
    RATE.set(k, { at: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > 60;
}

router.post("/pricing-event", (req, res) => {
  try {
    if (limited(req.ip)) return res.status(204).end(); // 靜默丟棄，唔影響使用者
    const b = req.body || {};
    if (!VALID_EVENTS.has(b.event_type)) return res.status(400).json({ error: "INVALID_EVENT_TYPE" });
    const sku = b.selected_sku == null || b.selected_sku === "" ? null : String(b.selected_sku);
    if (!VALID_SKU.has(sku)) return res.status(400).json({ error: "INVALID_SKU" });

    const price = Math.max(0, Math.round(Number(b.session_price_hkd) || 0));
    const db = getDb();
    db.prepare(
      `INSERT INTO pricing_conversion_events
         (id, event_type, class_id, schedule_id, session_price_hkd, pass4_price_hkd,
          shown_saving_hkd, selected_sku, revenue_cents)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      "pe_" + crypto.randomBytes(8).toString("hex"),
      b.event_type,
      b.class_id || null,
      b.schedule_id || null,
      price,
      Math.max(0, Math.round(Number(b.pass4_price_hkd) || 520)),
      Math.max(0, Math.round(Number(b.shown_saving_hkd) || 0)),
      sku,
      Math.max(0, Math.round(Number(b.revenue_cents) || 0)),
    );
    return res.status(204).end();
  } catch (e) {
    // 遙測失敗唔應該影響任何流程
    return res.status(204).end();
  }
});

router.get("/revenue-impact-summary", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));

    const rows = db
      .prepare(
        `SELECT session_price_hkd,
                MAX(shown_saving_hkd) AS advertised_saving_hkd,
                SUM(CASE WHEN event_type='checkout_view' THEN 1 ELSE 0 END) AS views,
                SUM(CASE WHEN event_type='checkout_converted' THEN 1 ELSE 0 END) AS conversions,
                SUM(CASE WHEN event_type='checkout_converted' AND selected_sku='pack_4' THEN 1 ELSE 0 END) AS pass4_sold,
                SUM(CASE WHEN event_type='checkout_converted' AND selected_sku='single' THEN 1 ELSE 0 END) AS single_sold,
                SUM(CASE WHEN event_type='checkout_converted' THEN revenue_cents ELSE 0 END) AS gross_cents
           FROM pricing_conversion_events
          WHERE created_at >= datetime('now', ?)
          GROUP BY session_price_hkd
          ORDER BY session_price_hkd ASC`,
      )
      .all(`-${days} days`);

    const tiers = rows.map((r) => {
      const conv = r.conversions || 0;
      const attach = conv ? Number(((r.pass4_sold / conv) * 100).toFixed(2)) : 0;
      const arpu = conv ? Number(((r.gross_cents || 0) / 100 / conv).toFixed(2)) : 0;
      return {
        session_price_hkd: r.session_price_hkd,
        advertised_saving_hkd: r.advertised_saving_hkd || 0,
        total_views: r.views || 0,
        total_conversions: conv,
        pass4_sold: r.pass4_sold || 0,
        single_sold: r.single_sold || 0,
        pass_attach_rate_pct: attach,
        blended_arpu_hkd: arpu,
        view_to_convert_pct: r.views ? Number(((conv / r.views) * 100).toFixed(2)) : 0,
        break_even_benchmark: r.session_price_hkd === 160 ? (attach >= 10.8 ? "ABOVE" : "BELOW") : "N/A",
      };
    });

    // Pass 核銷率／遞延負債（is_acceptance_test 未必存在 → 用 try/catch 分開查）
    let pass = { active_passes: 0, total_credits_issued: 0, credits_consumed: 0, credits_remaining_liability: 0, utilization_rate_pct: 0, deferred_revenue_hkd: 0, future_coach_payout_reserve_hkd: 0 };
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n,
                  COALESCE(SUM(total_credits),0) AS issued,
                  COALESCE(SUM(remaining_credits),0) AS remaining
             FROM user_passes
            WHERE status = 'active'`,
        )
        .get();
      const issued = row.issued || 0;
      const remaining = row.remaining || 0;
      const used = Math.max(0, issued - remaining);
      pass = {
        active_passes: row.n || 0,
        total_credits_issued: issued,
        credits_consumed: used,
        credits_remaining_liability: remaining,
        utilization_rate_pct: issued ? Number(((used / issued) * 100).toFixed(2)) : 0,
        deferred_revenue_hkd: remaining * 130,
        future_coach_payout_reserve_hkd: remaining * 104,
      };
    } catch (e) {}

    // 真實售出（pass_orders），用嚟對照遙測係咪漏數
    let orders = { pack_4: 0, pack_8: 0, revenue_hkd: 0 };
    try {
      const o = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN plan_id='pack_4' THEN 1 ELSE 0 END),0) AS p4,
                  COALESCE(SUM(CASE WHEN plan_id='pack_8' THEN 1 ELSE 0 END),0) AS p8,
                  COALESCE(SUM(amount_cents),0) AS cents
             FROM pass_purchase_orders
            WHERE status IN ('completed','paid') AND created_at >= datetime('now', ?)`,
        )
        .get(`-${days} days`);
      orders = { pack_4: o.p4 || 0, pack_8: o.p8 || 0, revenue_hkd: Math.round((o.cents || 0) / 100) };
    } catch (e) {}

    return res.json({
      ok: true,
      window_days: days,
      pricing_rule: { fixed_pass4_price_hkd: 520, fixed_avg_per_class_hkd: 130 },
      tier_conversion_breakdown: tiers,
      pass_utilization_and_liability: pass,
      actual_pass_orders: orders,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ANALYTICS_QUERY_FAILED", message: e.message });
  }
});

module.exports = router;
