/**
 * ZenPass 極端天氣安排（以香港康樂及文化事務署 LCSD 安排為藍本）
 * 2026-10-28
 *
 * 原則：決定權留在管理員（人手審查取消），系統只提供一致的判斷依據，
 *       避免「全自動取消」在天文台改掛／落波時差中誤殺可如常舉行的課堂。
 */
const WEATHER_POLICY = {
  source: "參考香港康樂及文化事務署（LCSD）熱帶氣旋及暴雨警告下的安排",
  version: "2026-10-28",
  // 時段分界（24 小時制 HH:MM）
  cutoffs: { day: "10:00", dayResume: "12:00", evening: "15:00", eveningResume: "18:00" },
  rules: [
    { code: "signal_active", text: "八號或以上熱帶氣旋警告／黑色暴雨警告生效期間：所有課堂取消（場地關閉）。" },
    { code: "lifted_before_day", text: "警告於當日 10:00 前取消或除下：12:00 或之後開始的課堂照常舉行。" },
    { code: "lifted_before_evening", text: "警告於當日 15:00 前取消或除下：18:00 或之後開始的課堂照常舉行。" },
    { code: "lifted_after_evening", text: "警告於當日 15:00 後才取消或除下：當日餘下所有課堂取消。" },
  ],
  compensation: "受影響學員可選擇：① 全額退款（經 FPS 退回）或 ② 免費改期／轉為體驗金（Credits），由學員自行選擇。",
  notes: [
    "以香港天文台實際發出／取消警告的時間為準，並以課堂開始時間比較。",
    "如場地另有安排（例如室內場地於黑雨期間仍開放），管理員可按實際情況調整。",
    "教練與學員如有疑問，請以平台發出的WhatsApp／站內通知為準。",
  ],
};

/** "HH:MM" → 分鐘 */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * 判斷某課堂是否應取消
 * @param {{warningActive:boolean, liftedAt?:string, classStart?:string}} o
 * warningActive：查詢時警告是否仍然生效
 * liftedAt：警告取消／除下時間（HH:MM）
 * classStart：課堂開始時間（HH:MM）
 * @returns {{cancel:boolean, code:string, reason:string}}
 */
function evaluateWeather({ warningActive, liftedAt, classStart } = {}) {
  const start = toMinutes(classStart);
  if (warningActive === true) {
    return { cancel: true, code: "signal_active", reason: WEATHER_POLICY.rules[0].text };
  }
  const lifted = toMinutes(liftedAt);
  if (lifted == null || start == null) {
    return {
      cancel: false,
      code: "manual_review",
      reason: "資料不足（缺警告取消時間或課堂時間），請管理員人手判斷。",
    };
  }
  const { cutoffs } = WEATHER_POLICY;
  const dayCut = toMinutes(cutoffs.day);
  const dayResume = toMinutes(cutoffs.dayResume);
  const eveCut = toMinutes(cutoffs.evening);
  const eveResume = toMinutes(cutoffs.eveningResume);

  if (lifted <= dayCut) {
    if (start >= dayResume) {
      return { cancel: false, code: "lifted_before_day", reason: WEATHER_POLICY.rules[1].text };
    }
    return { cancel: true, code: "before_day_resume", reason: "警告於 10:00 前取消，但課堂在 12:00 前開始，建議取消或改期。" };
  }
  if (lifted <= eveCut) {
    if (start >= eveResume) {
      return { cancel: false, code: "lifted_before_evening", reason: WEATHER_POLICY.rules[2].text };
    }
    return { cancel: true, code: "before_evening_resume", reason: "警告於 15:00 前取消，但課堂在 18:00 前開始，建議取消或改期。" };
  }
  return { cancel: true, code: "lifted_after_evening", reason: WEATHER_POLICY.rules[3].text };
}

module.exports = { WEATHER_POLICY, evaluateWeather, toMinutes };
