/**
 * Phase 6.2（A+B）：Pass Breakage 只讀分析 + 提醒名單
 *
 * 設計原則：
 *  - 唔改任何通票狀態、唔寫任何金額（純 SELECT）
 *  - 核銷曲線用現有 pass_redemptions，避免另開流水表造成雙寫
 *  - Breakage（到期未用）同 Forfeiture（no-show／遲取消沒收）分開計
 *  - is_acceptance_test 欄未存在時自動略過（Phase 6.0 之後會自動用返）
 *
 *   GET /api/analytics/breakage-summary
 *   GET /api/analytics/breakage-nudges
 */
const express = require("express");
const router = express.Router();
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (e) {
    return false;
  }
}

function unitValue(pass) {
  // 用實際售價 ÷ 堂數（唔硬編 130/120），冇價就用 130
  const credits = Number(pass.total_credits) || 0;
  const paid = Number(pass.price_paid) || 0;
  if (credits > 0 && paid > 0) return Math.round(paid / credits);
  return 130;
}

router.get("/breakage-summary", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const testCol = hasColumn(db, "user_passes", "is_acceptance_test");
    const notTest = testCol ? " AND COALESCE(is_acceptance_test,0) = 0" : "";

    const passes = db
      .prepare(
        `SELECT id, user_id, total_credits, remaining_credits, price_paid, status,
                expires_at, created_at, family_group_id, pass_type, corporate_id
           FROM user_passes
          WHERE 1=1${notTest}`,
      )
      .all();

    const now = Date.now();
    const skuOf = (p) => {
      if (p.corporate_id) return "corp";
      const t = String(p.pass_type || "").toLowerCase();
      if (t.includes("8") || Number(p.total_credits) >= 8) return "pack_8";
      return "pack_4";
    };

    // 產品別統計
    const bySku = new Map();
    let totalCredits = 0;
    let expiredUnused = 0;
    let expiredRevenue = 0;

    for (const p of passes) {
      const sku = skuOf(p);
      const rec = bySku.get(sku) || { sku, passes: 0, credits: 0, remaining: 0, expired_unused: 0, breakage_hkd: 0 };
      const credits = Number(p.total_credits) || 0;
      const remaining = Number(p.remaining_credits) || 0;
      const unit = unitValue(p);
      const isExpired = p.expires_at && new Date(String(p.expires_at).replace(" ", "T")) <= new Date(now);
      rec.passes += 1;
      rec.credits += credits;
      if (p.status === "active") rec.remaining += remaining;
      if (isExpired && remaining > 0) {
        rec.expired_unused += remaining;
        rec.breakage_hkd += remaining * unit;
        expiredUnused += remaining;
        expiredRevenue += remaining * unit;
      }
      totalCredits += credits;
      bySku.set(sku, rec);
    }

    const productStats = [...bySku.values()].map((r) => {
      const pct = r.credits ? Number(((r.expired_unused / r.credits) * 100).toFixed(2)) : 0;
      return {
        plan_sku: r.sku,
        passes_sold: r.passes,
        total_credits_sold: r.credits,
        expired_unused_credits: r.expired_unused,
        breakage_rate_pct: pct,
        breakage_revenue_hkd: r.breakage_hkd,
        active_remaining_credits: r.remaining,
        health_status: pct > 30 ? "RISK_ALERT" : pct < 10 ? "HIGH_UTILIZATION" : "HEALTHY",
      };
    });

    // Forfeiture：用 bookings（掛 pass 嘅 no-show / 未夠 24h 取消）
    let forfeit = { no_show: 0, late_cancel: 0, credits: 0 };
    try {
      const ns = db
        .prepare(
          `SELECT COUNT(*) n, COALESCE(SUM(COALESCE(units_consumed,1)),0) c
             FROM bookings
            WHERE pass_id IS NOT NULL AND status = 'no_show'`,
        )
        .get();
      const lc = db
        .prepare(
          `SELECT COUNT(*) n, COALESCE(SUM(COALESCE(units_consumed,1)),0) c
             FROM bookings
            WHERE pass_id IS NOT NULL AND status = 'cancelled' AND payment_status = 'paid'`,
        )
        .get();
      forfeit = {
        no_show: ns.n || 0,
        late_cancel: lc.n || 0,
        credits: (ns.c || 0) + (lc.c || 0),
      };
    } catch (e) {}

    // 家庭共享 vs 個人
    const shareMap = new Map();
    for (const p of passes) {
      const key = p.family_group_id ? "family_shared" : "individual";
      const rec = shareMap.get(key) || { ownership_type: key, pass_count: 0, credits_sold: 0, expired_unused: 0 };
      const credits = Number(p.total_credits) || 0;
      const remaining = Number(p.remaining_credits) || 0;
      const isExpired = p.expires_at && new Date(String(p.expires_at).replace(" ", "T")) <= new Date(now);
      rec.pass_count += 1;
      rec.credits_sold += credits;
      if (isExpired && remaining > 0) rec.expired_unused += remaining;
      shareMap.set(key, rec);
    }
    const familyVsIndividual = [...shareMap.values()].map((r) => ({
      ownership_type: r.ownership_type,
      pass_count: r.pass_count,
      breakage_rate_pct: r.credits_sold ? Number(((r.expired_unused / r.credits_sold) * 100).toFixed(2)) : 0,
    }));

    // 核銷曲線：pass_redemptions（唔另建流水表）
    let curve = { d15: 0, d30: 0, d45: 0, d60: 0, total_used: 0 };
    try {
      const rows = db
        .prepare(
          `SELECT pr.credits AS credits,
                  CAST(julianday(pr.created_at) - julianday(up.created_at) AS INTEGER) AS day
             FROM pass_redemptions pr
             JOIN user_passes up ON up.id = pr.pass_id
            WHERE pr.status = 'used'`,
        )
        .all();
      for (const r of rows) {
        const d = Math.max(0, Number(r.day) || 0);
        const c = Number(r.credits) || 1;
        curve.total_used += c;
        if (d <= 15) curve.d15 += c;
        if (d <= 30) curve.d30 += c;
        if (d <= 45) curve.d45 += c;
        if (d <= 60) curve.d60 += c;
      }
    } catch (e) {}

    const pct = (n) => (totalCredits ? Number(((n / totalCredits) * 100).toFixed(1)) : 0);

    return res.json({
      ok: true,
      planning_baseline: { expected_4pack_breakage_band: "15% - 20%", valuation: "每個 pass 用實收 ÷ 堂數" },
      totals: {
        passes: passes.length,
        credits_sold: totalCredits,
        expired_unused_credits: expiredUnused,
        breakage_revenue_hkd: expiredRevenue,
        breakage_rate_pct: totalCredits ? Number(((expiredUnused / totalCredits) * 100).toFixed(2)) : 0,
        forfeiture_credits: forfeit.credits,
        forfeiture_rate_pct: totalCredits ? Number(((forfeit.credits / totalCredits) * 100).toFixed(2)) : 0,
      },
      product_breakage: productStats,
      forfeiture_breakdown: forfeit,
      family_vs_individual: familyVsIndividual,
      utilization_curve_pct: {
        day_15: pct(curve.d15),
        day_30: pct(curve.d30),
        day_45: pct(curve.d45),
        day_60: pct(curve.d60),
      },
      ledger_note: "核銷曲線用 pass_redemptions 計算；未另建 pass_credit_ledger（避免雙寫）",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "BREAKAGE_ANALYSIS_FAILED", message: e.message });
  }
});

/* ---------- B：提醒名單（只產生，不發送） ---------- */
function waLink(phone, message) {
  const p = String(phone || "").replace(/\D/g, "");
  if (p.length < 8) return null;
  const hk = p.length === 8 ? "852" + p : p;
  return `https://wa.me/${hk}?text=${encodeURIComponent(message)}`;
}

function buildNudges(db) {
  const testCol = hasColumn(db, "user_passes", "is_acceptance_test");
  const notTest = testCol ? " AND COALESCE(up.is_acceptance_test,0) = 0" : "";
  const out = { day7: [], expiry10: [], counts: {} };

  const base = `
    SELECT up.id AS pass_id, up.user_id, up.student_name, up.total_credits, up.remaining_credits,
           up.expires_at, up.created_at, u.name AS user_name, u.phone
      FROM user_passes up
      LEFT JOIN users u ON u.id = up.user_id
     WHERE up.status = 'active'${notTest}`;

  // Day-7：買了 7 日仍未用過任何堂
  try {
    const rows = db
      .prepare(
        `${base}
           AND COALESCE(up.remaining_credits,0) = COALESCE(up.total_credits,0)
           AND julianday('now') - julianday(up.created_at) BETWEEN 7 AND 8`,
      )
      .all();
    out.day7 = rows.map((r) => {
      const name = r.student_name || r.user_name || "你好";
      const msg = `【ZenPass 禪流】${name}，你嘅家庭健康通票（餘 ${r.remaining_credits} 堂）已開通一星期，仲未開始上堂。本週葵青／觀塘有樂齡防跌、肩頸伸展班有位，撳下面預約第一堂：https://zenpass.hk/explore.html`;
      return { ...r, tag: "DAY_7_FIRST_CLASS", wa: waLink(r.phone, msg), message: msg };
    });
  } catch (e) {}

  // 到期前 10 日仍有餘堂
  try {
    const rows = db
      .prepare(
        `${base}
           AND COALESCE(up.remaining_credits,0) > 0
           AND up.expires_at IS NOT NULL
           AND julianday(up.expires_at) - julianday('now') BETWEEN 9.5 AND 10.5`,
      )
      .all();
    out.expiry10 = rows.map((r) => {
      const name = r.student_name || r.user_name || "你好";
      const d = String(r.expires_at).slice(0, 10);
      const msg = `【ZenPass 禪流】${name}，你嘅通票仍有 ${r.remaining_credits} 堂未用，${d} 到期。過期後堂數會失效，建議盡快預約：https://zenpass.hk/explore.html （如已安排，可忽略此訊息）`;
      return { ...r, tag: "EXPIRY_10D", wa: waLink(r.phone, msg), message: msg };
    });
  } catch (e) {}

  out.counts = { day7: out.day7.length, expiry10: out.expiry10.length };
  return out;
}

router.get("/breakage-nudges", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const data = buildNudges(db);
    return res.json({ ok: true, ...data, note: "只產生名單與 wa.me 連結，系統唔會自動發送" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "NUDGE_FAILED", message: e.message });
  }
});

module.exports = router;
module.exports.buildNudges = buildNudges;
module.exports.waLink = waLink;
