/**
 * ZenPass — 平台公開資訊（無需登入）
 * GET /api/platform/weather-policy          極端天氣安排（以康文署 LCSD 為藍本）
 * GET /api/platform/weather-warnings        香港天文台即時警告（5 分鐘快取）
 * 2026-10-28
 */
const express = require("express");
const router = express.Router();
const { WEATHER_POLICY, evaluateWeather, buildPolicy, formatLead } = require("../config/weather-policy");
const settings = require("../services/settings-service");
const { getDb } = require("../services/database");

const { fetchWarnings } = require("../services/hko-warnings");

function weatherLeadMinutes() {
  try {
    return settings.num(getDb(), "weather.lead_minutes", WEATHER_POLICY.cutoffs.leadMinutes);
  } catch (e) {
    return WEATHER_POLICY.cutoffs.leadMinutes;
  }
}

// GET /api/platform/config — 前端顯示用嘅公開參數（不含敏感資料）
router.get("/config", (req, res) => {
  try {
    const db = getDb();
    const lead = weatherLeadMinutes();
    res.json({
      success: true,
      config: {
        refund_sla_minutes: settings.num(db, "refund.sla_minutes", 15),
        weather_lead_minutes: lead,
        weather_lead_text: formatLead(lead),
        silver2_discount: settings.num(db, "promo.silver2_value", 40),
        credit_hkd: 10,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取設定失敗" });
  }
});

router.get("/weather-policy", (req, res) => {
  try {
    const db = getDb();
    const lead = weatherLeadMinutes();
    let comp = "";
    try {
      comp = settings.str(db, "weather.compensation_text", "");
    } catch (e) {}
    res.json({ success: true, policy: buildPolicy(lead, comp) });
  } catch (e) {
    res.json({ success: true, policy: WEATHER_POLICY });
  }
});

router.get("/weather-warnings", async (req, res) => {
  const w = await fetchWarnings();
  // 可選：管理員輸入落波時間 + 課堂開始時間 → 即時判斷應否取消
  let advice = null;
  const liftedAt = String(req.query.lifted_at || "").trim();
  const classStart = String(req.query.class_start || "").trim();
  if (liftedAt && classStart) {
    advice = evaluateWeather({
      warningActive: !!w.activity_suspended,
      liftedAt,
      classStart,
      leadMinutes: weatherLeadMinutes(),
    });
  }
  res.json({ success: true, ...w, advice });
});

module.exports = router;
