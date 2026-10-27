/**
 * ZenPass — 平台公開資訊（無需登入）
 * GET /api/platform/weather-policy          極端天氣安排（以康文署 LCSD 為藍本）
 * GET /api/platform/weather-warnings        香港天文台即時警告（5 分鐘快取）
 * 2026-10-28
 */
const express = require("express");
const router = express.Router();
const { WEATHER_POLICY, evaluateWeather } = require("../config/weather-policy");

const { fetchWarnings } = require("../services/hko-warnings");

router.get("/weather-policy", (req, res) => {
  res.json({ success: true, policy: WEATHER_POLICY });
});

router.get("/weather-warnings", async (req, res) => {
  const w = await fetchWarnings();
  // 可選：管理員輸入落波時間 + 課堂開始時間 → 即時判斷應否取消
  let advice = null;
  const liftedAt = String(req.query.lifted_at || "").trim();
  const classStart = String(req.query.class_start || "").trim();
  if (liftedAt && classStart) {
    advice = evaluateWeather({ warningActive: !!w.activity_suspended, liftedAt, classStart });
  }
  res.json({ success: true, ...w, advice });
});

module.exports = router;
