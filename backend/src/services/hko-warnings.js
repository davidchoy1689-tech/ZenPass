/**
 * 香港天文台警告資料（開放數據）
 * 5 分鐘快取；失敗時回傳 ok:false，由上層決定降級方式。
 */
let cache = { at: 0, data: null };

function mapWarnings(j) {
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
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    warnings: list,
    codes,
    signal_8_or_above: signal8,
    black_rainstorm: blackRain,
    activity_suspended: signal8 || blackRain,
  };
}

async function fetchWarnings({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < 5 * 60 * 1000) return cache.data;
  const url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "User-Agent": "ZenPass/1.0" } });
    const j = await r.json();
    const data = mapWarnings(j);
    cache = { at: now, data };
    return data;
  } catch (e) {
    return { ok: false, error: "未能讀取天文台警告（請人手核對天文台網站）", checked_at: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchWarnings };
