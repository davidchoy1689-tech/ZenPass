/**
 * ZenPass — 場地評分（代替保證金）
 *
 * 規則（2026-10-17 David 定）：
 *  - 場地準時提供 → 完成租場
 *  - 場地未能提供（venue_failure_200pct）→ 成功率先下降 + 額外扣分
 *  - 分數越低 → 曝光越差：
 *      ≥3.0 正常排序｜2.5–2.9 排到最後｜<2.5 暫停曝光
 */

const { getDb } = require("./database");

function scoreFrom(counts) {
  const completed = Number(counts.completed) || 0;
  const failures = Number(counts.failures) || 0;
  const events = completed + failures;
  const successRate = events === 0 ? 1 : completed / events;
  let score = events === 0 ? 5 : 1 + 4 * successRate;
  score = Math.max(0, Math.min(5, Math.round((score - failures * 0.2) * 10) / 10));
  const band = score >= 4.5 ? "excellent" : score >= 3.5 ? "good" : score >= 3 ? "fair" : "poor";
  const visibility = score >= 3 ? "normal" : score >= 2.5 ? "deprioritised" : "hidden";
  return { score, band, visibility, success_rate: Math.round(successRate * 100), completed, failures, events };
}

function computeVenueRating(venueId) {
  const db = getDb();
  let completed = 0, failures = 0;
  try {
    completed = db
      .prepare("SELECT COUNT(*) AS c FROM venue_rentals WHERE venue_id = ? AND status = 'completed'")
      .get(venueId).c;
  } catch (e) {}
  try {
    failures = db
      .prepare("SELECT COUNT(*) AS c FROM venue_penalties WHERE venue_id = ? AND type = 'venue_failure_200pct'")
      .get(venueId).c;
  } catch (e) {}

  return { venue_id: venueId, ...scoreFrom({ completed, failures }) };
}

module.exports = { computeVenueRating, scoreFrom };
