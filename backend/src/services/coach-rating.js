/**
 * ZenPass — 教練評分（階段 1：只教練自己睇 + 內部參考）
 *
 * 貝氏平滑：避免 1 個負評就毀掉新教練
 *   score = (sum + PRIOR * WEIGHT) / (count + WEIGHT)
 *   PRIOR = 4.5（平台期望值）、WEIGHT = 10（虛擬評價數）
 */

const { getDb } = require("./database");

const PRIOR = 4.5;
const WEIGHT = 10;

function smoothing(count, sum, prior = PRIOR, weight = WEIGHT) {
  const n = Number(count) || 0;
  const s = Number(sum) || 0;
  const score = (s + prior * weight) / (n + weight);
  return {
    count: n,
    raw_avg: n ? Math.round((s / n) * 10) / 10 : 0,
    score: Math.round(score * 10) / 10,
  };
}

function bandOf(score) {
  if (score >= 4.5) return "excellent";
  if (score >= 4.0) return "good";
  if (score >= 3.5) return "fair";
  return "needs_improvement";
}

function computeCoachRating(coachId) {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) c, COALESCE(SUM(rating),0) s FROM coach_ratings WHERE coach_id = ?")
    .get(coachId);
  const base = smoothing(row.c, row.s);
  return { coach_id: coachId, ...base, band: bandOf(base.score), is_public: base.count >= 10 };
}

module.exports = { computeCoachRating, smoothing, bandOf, PRIOR, WEIGHT };
