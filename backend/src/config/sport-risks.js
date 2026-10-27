/**
 * 具體運動固有風險披露（Volenti 抗辯用）— 2026-10-28
 * 法律背景：香港《管制免責條款條例》(Cap. 71) 第 7 條——不得藉合約條款卸除
 * 因疏忽引致人身傷亡的責任。因此平台必須證明學員／家長「充分知情下自願承擔
 * 該運動的固有風險」，而非單靠一句「概不負責」。
 *
 * 每項運動列出：固有風險（inherent risks）同安全提示。報名時逐項顯示並存證。
 */
const RISK_VERSION = "risk-v1-2026-10";

const SPORT_RISKS = {
  molkky: {
    label: "芬蘭木柱（Mölkky）",
    risks: [
      "投擲木棒涉及肩膊、手腕重複用力，可能引致肌肉勞損",
      "木棒落地反彈或隊友走位時，可能造成輕微碰撞、挫傷",
      "在草地／地膠上走動可能滑倒、足踝扭傷",
    ],
    tips: ["請穿室內防滑運動鞋", "投擲區前方不得站人", "聽從教練指示輪流投擲"],
  },
  "floor-curling": {
    label: "地板冰壺（Floor Curling）",
    risks: [
      "推壺動作涉及腰背及膝關節扭轉，可能引致勞損",
      "地面滑行時重心不穩，可能跌倒、膝部或手腕挫傷",
      "蹲跪動作對膝關節有壓力",
    ],
    tips: ["請穿防滑運動鞋", "保持賽道暢通", "如膝部不適請先告知教練"],
  },
  cornhole: {
    label: "布袋球（Cornhole）",
    risks: ["投擲動作可能引致肩膊勞損", "走近板前取球時可能被絆倒"],
    tips: ["投擲線後方等候", "取球時注意地面"],
  },
  "air-storm": {
    label: "穿雲箭（Air Storm）",
    risks: ["發射動作需較大上肢力量，可能引致肩肘勞損", "箭枝回彈可能擊中面部或眼睛"],
    tips: ["必須配戴護目鏡（如提供）", "禁止向人發射", "只在教練指示方向發射"],
  },
  "nordic-walking": {
    label: "北歐式健走",
    risks: ["長時間步行對膝踝關節有負荷", "路面不平或天氣炎熱可能引致中暑、跌倒"],
    tips: ["穿著合適運動鞋", "補充足夠水分", "量力而為，不適即停"],
  },
  roundnet: {
    label: "圓網球（Roundnet）",
    risks: ["撲救動作涉及急停、跳躍，可能引致足踝扭傷或肌肉拉傷", "近距離擊球可能被球擊中"],
    tips: ["熱身足夠方可比賽", "留意隊友位置", "場地四周需留有安全距離"],
  },
  rouliqiu: {
    label: "柔力球",
    risks: ["揮拍動作可能引致肩肘勞損", "接球時可能被球拍或球擊中"],
    tips: ["循序漸進練習", "與其他學員保持距離"],
  },
  "flexi-bar": {
    label: "Flexi-Bar",
    risks: ["震動訓練對肩頸、腰背有負荷", "姿勢錯誤可能引致肌肉酸痛或拉傷"],
    tips: ["初學由低強度開始", "如有頸腰傷患請先諮詢醫生意見"],
  },
  stretch: {
    label: "身心伸展",
    risks: ["伸展過度可能引致肌肉拉傷", "關節活動受限者可能感到不適"],
    tips: ["不應感到劇痛", "有舊患請預先告知教練"],
  },
  climbing: {
    label: "攀石／抱石（Climbing / Bouldering）",
    risks: [
      "離地攀爬存在跌落風險，可能引致骨折、韌帶撕裂",
      "落墊姿勢錯誤可能扭傷足踝",
      "上肢及手指肌腱負荷大，可能引致勞損",
    ],
    tips: ["必須穿攀石鞋", "落墊時雙腳著地、屈膝卸力", "遵守場地安全守則及教練指示"],
  },
  "roller-skating": {
    label: "滾軸溜冰（Roller Skating）",
    risks: ["跌倒風險較高，可能引致手腕、尾龍骨或頭部受傷", "場地濕滑或他人碰撞可能造成意外"],
    tips: ["必須配戴頭盔、護腕、護膝、護肘", "初學需扶手或教練協助", "禁止高速追逐"],
  },
  "kids-fitness": {
    label: "兒童體適能",
    risks: ["跑跳及器械活動可能引致跌倒、擦傷或輕微扭傷", "兒童专注力有限，需成人陪同留意"],
    tips: ["穿著運動服及防滑鞋", "家長／監護人須在場或指定接送安排", "如有哮喘／心臟病史請預先告知"],
  },
};

const ALIASES = {
  molkky: ["木柱", "molkky", "moelkkyla"],
  "floor-curling": ["冰壺", "curling"],
  cornhole: ["布袋球", "cornhole"],
  "air-storm": ["穿雲箭", "air storm", "airstorm"],
  "nordic-walking": ["健走", "nordic"],
  roundnet: ["圓網球", "roundnet"],
  rouliqiu: ["柔力球", "rouliqiu"],
  "flexi-bar": ["flexi", "flexibar"],
  stretch: ["伸展", "瑜伽", "yoga", "stretch"],
  climbing: ["攀石", "抱石", "climbing", "boulder"],
  "roller-skating": ["滾軸", "溜冰", "roller", "skating"],
  "kids-fitness": ["兒童", "體適能", "kids", "fitness"],
};

function riskProfile(sportSlug, category, title) {
  const hay = [sportSlug, category, title].filter(Boolean).join(" ").toLowerCase();
  const hit = Object.keys(SPORT_RISKS).find((k) =>
    (ALIASES[k] || [k]).some((a) => hay.includes(String(a).toLowerCase())),
  );
  if (hit) return { key: hit, version: RISK_VERSION, ...SPORT_RISKS[hit] };
  return {
    key: "general",
    version: RISK_VERSION,
    label: category || "體育活動",
    risks: ["體育活動本身存在跌倒、碰撞、肌肉拉傷等固有風險", "個人身體狀況可能影響參與安全"],
    tips: ["穿著合適運動服裝及鞋履", "如有傷患或長期病患請預先告知教練"],
  };
}

module.exports = { RISK_VERSION, SPORT_RISKS, riskProfile };
