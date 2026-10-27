/**
 * ZenPass — 平台公開資訊（無需登入）
 * GET /api/platform/weather-policy          極端天氣安排（以康文署 LCSD 為藍本）
 * GET /api/platform/weather-warnings        香港天文台即時警告（5 分鐘快取）
 * 2026-10-28
 */
const express = require("express");
const router = express.Router();
const { WEATHER_POLICY, evaluateWeather } = require("../config/weather-policy");

let _warnCache = { at: 0, data: null };

async function fetchHkoWarnings() {
  const now = Date.now();
  if (_warnCache.data && now - _warnCache.at < 5 * 60 * 1000) return _warnCache.data;
  const url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "ZenPass/1.0" } });
    const j = await r.json();
    const details = Array.isArray(j && j.details) ? j.details : [];
    const list = details.map((d) => ({
      code: d.warningStatementCode || "",
      name: d.warningStatement || "",
      type: d.warningType || "",
      issue: d.issueTime || "",
      update: d.updateTime || "",
    }));
    const codes = list.map((x) => x.code);
    const signal8 = codes.some((c) => /^TC(8|9|10)/.test(c));
    const blackRain = codes.includes("WRAINB");
    const data = {
      ok: true,
      checked_at: new Date().toISOString(),
      warnings: list,
      signal_8_or_above: signal8,
      black_rainstorm: blackRain,
      activity_suspended: signal8 || blackRain,
    };
    _warnCache = { at: now, data };
    return data;
  } catch (e) {
    return { ok: false, error: "未能讀取天文台警告（請人手核對天文台網站）", checked_at: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}

router.get("/weather-policy", (req, res) => {
  res.json({ success: true, policy: WEATHER_POLICY });
});

router.get("/weather-warnings", async (req, res) => {
  const w = await fetchHkoWarnings();
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
