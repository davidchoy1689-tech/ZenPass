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
  // 判斷界線：以「課堂開始前 2 小時」為準（2026-10-28 David 定案）
  cutoffs: { leadMinutes: 120 },
  rules: [
    { code: "signal_active", text: "八號或以上熱帶氣旋警告／黑色暴雨警告生效期間：課堂取消（場地關閉）。" },
    { code: "lifted_before_lead", text: "警告於課堂開始前 2 小時或之前取消或除下：該課堂照常舉行。" },
    { code: "within_lead", text: "警告在課堂開始前不足 2 小時仍然生效，或於該 2 小時內才除下：該課堂取消。" },
    { code: "advice_check", text: "如天氣情況特別，學員出門前應先致電／WhatsApp 平台或教練，查詢最新課堂安排。" },
  ],
  compensation:
    "受影響學員可選擇：① 全額退款（經轉數快 FPS 退回）或 ② 免費改期／轉為體驗金（Credits），由學員自行選擇。",
  // 公開條款（weather-policy.html 逐段顯示；亦供客服／學校查閱）
  clauses: [
    {
      h: "一、適用範圍",
      p: "本條款適用於 ZenPass 禪流平台（下稱「平台」）上所有實體課堂、體驗班、恆常班及活動，不論室內或戶外場地，亦不論由平台或合作教練／場地開辦。",
    },
    {
      h: "二、極端天氣之定義",
      p: "指香港天文台發出八號或以上熱帶氣旋警告信號、黑色暴雨警告信號；或場地管理方宣佈暫停開放；或政府宣佈「極端情況」。",
    },
    {
      h: "三、觸發條件及安排（參考康樂及文化事務署安排）",
      p: "1. 八號或以上熱帶氣旋警告／黑色暴雨警告生效期間：所有課堂取消。\n2. 以每堂課的開始時間計算，課堂開始前 2 小時為界線：警告已於該界線前取消或除下，課堂照常舉行。\n3. 警告在課堂開始前不足 2 小時仍然生效，或於該 2 小時內才除下：該課堂取消。\n4. 天文台如預告「即將發出／改發」信號，平台會預先通知學員；最終安排以實際發出／除下時間及平台通知為準。",
    },
    {
      h: "四、平台的處理流程",
      p: "1. 系統會根據天文台即時警告，向平台管理員發出「需要立即跟進」訊號。\n2. 管理員會審視課堂時間、場地狀況、教練安排及天氣走勢後，以人手決定「取消」或「照常舉行」。\n3. 平台不會單憑預告自動取消課堂，以免在天氣快速改善時誤取消可如期舉行的課堂。",
    },
    {
      h: "五、通知方式及時效",
      p: "管理員作出決定後，平台會透過站內通知、WhatsApp（如已提供電話）及／或電郵通知受影響學員；一般會於課堂開始前不少於 2 小時發出，特殊情況除外。學員如見天氣情況特別，出門前應先致電或 WhatsApp 平台（9033 5538）／教練查詢最新安排。",
    },
    {
      h: "六、學員補償",
      p: "因極端天氣而取消的課堂，學員可選擇：① 全額退款（經轉數快 FPS 退回原付款人）；或 ② 免費改期至其他班次／轉為平台體驗金（Credits）。學員可於「我的預約」自行登記退款資料。",
    },
    {
      h: "七、改期安排",
      p: "平台會優先安排原班人馬順延或改期；如未能安排合適時段，學員可按第六條選擇退款。",
    },
    {
      h: "八、例外情況",
      p: "如場地於警告生效期間仍然開放（例如部分室內場地），或教練評估場地及交通情況後認為安全，管理員可決定課堂照常舉行，並即時通知學員。學員如因個人安全考慮不出席，可聯絡客服按個別情況安排改期。",
    },
    {
      h: "九、其他",
      p: "本條款以香港康樂及文化事務署的極端天氣安排為參考藍本，並可因應場地及實際情況調整。如有爭議，平台會按本條款、實際天氣紀錄及已發出的通知紀錄處理。",
    },
  ],
  notes: [
    "以香港天文台實際發出／取消警告的時間為準；每堂課獨立以「開始時間前 2 小時」判斷。",
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
 * 判斷某課堂是否應取消（界線 = 課堂開始前 2 小時）
 * @param {{warningActive:boolean, liftedAt?:string, classStart?:string}} o
 *  - warningActive：查詢時警告是否仍然生效
 *  - liftedAt：警告取消／除下時間（HH:MM）
 *  - classStart：課堂開始時間（HH:MM）
 * @returns {{cancel:boolean, code:string, reason:string, leadMinutes?:number, minutesBetween?:number}}
 */
function evaluateWeather({ warningActive, liftedAt, classStart } = {}) {
  const lead = WEATHER_POLICY.cutoffs.leadMinutes;
  if (warningActive === true) {
    return { cancel: true, code: "signal_active", reason: WEATHER_POLICY.rules[0].text, leadMinutes: lead };
  }
  const start = toMinutes(classStart);
  const lifted = toMinutes(liftedAt);
  if (lifted == null || start == null) {
    return {
      cancel: false,
      code: "manual_review",
      reason: "資料不足（缺警告除下時間或課堂時間），請管理員人手判斷。",
      leadMinutes: lead,
    };
  }
  // 警告除下 → 距課堂開始幾多分鐘（同一日，跨午夜以 24 小時環回處理）
  const gap = ((start - lifted) + 1440) % 1440;
  if (gap >= lead) {
    return {
      cancel: false, code: "lifted_before_lead", reason: WEATHER_POLICY.rules[1].text,
      leadMinutes: lead, minutesBetween: gap,
    };
  }
  return {
    cancel: true, code: "within_lead", reason: WEATHER_POLICY.rules[2].text,
    leadMinutes: lead, minutesBetween: gap,
  };
}

module.exports = { WEATHER_POLICY, evaluateWeather, toMinutes };
