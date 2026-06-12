// ZenPass 課程分類映射 — 用於自動配對相關圖片顏色
var ZENPASS_CATEGORY = {
  // === 核心分類 ===
  瑜伽: { emoji: "🧘", gradient: "linear-gradient(135deg,#667eea,#764ba2)" },
  健身: { emoji: "💪", gradient: "linear-gradient(135deg,#f093fb,#f5576c)" },
  伸展: { emoji: "🤸", gradient: "linear-gradient(135deg,#4facfe,#00f2fe)" },
  冥想: { emoji: "🧠", gradient: "linear-gradient(135deg,#a18cd1,#fbc2eb)" },
  舞蹈: { emoji: "💃", gradient: "linear-gradient(135deg,#ffecd2,#fcb69f)" },
  新興運動: {
    emoji: "🎯",
    gradient: "linear-gradient(135deg,#43e97b,#38f9d7)",
  },

  // === 健身 / 搏擊 ===
  拳擊搏擊: {
    emoji: "🥊",
    gradient: "linear-gradient(135deg,#e74c3c,#c0392b)",
  },
  泰拳搏擊: {
    emoji: "🦵",
    gradient: "linear-gradient(135deg,#d63031,#b71c1c)",
  },
  "TRX 懸吊訓練": {
    emoji: "🏋️",
    gradient: "linear-gradient(135deg,#6c5ce7,#341f97)",
  },
  肌力訓練: {
    emoji: "🏋️",
    gradient: "linear-gradient(135deg,#2c3e50,#2c3e50)",
  },
  心肺訓練: {
    emoji: "🏃",
    gradient: "linear-gradient(135deg,#e17055,#d63031)",
  },

  // === 球類 ===
  乒乓球: { emoji: "🏓", gradient: "linear-gradient(135deg,#00b894,#00cec9)" },
  羽毛球: { emoji: "🏸", gradient: "linear-gradient(135deg,#55efc4,#00b894)" },
  網球: { emoji: "🎾", gradient: "linear-gradient(135deg,#fdcb6e,#e17055)" },
  高爾夫球: {
    emoji: "⛳",
    gradient: "linear-gradient(135deg,#27ae60,#2ecc71)",
  },
  保齡球: { emoji: "🎳", gradient: "linear-gradient(135deg,#636e72,#b2bec3)" },

  // === 藝術 / 舞蹈延伸 ===
  芭蕾塑形: {
    emoji: "🩰",
    gradient: "linear-gradient(135deg,#fd79a8,#e84393)",
  },
  皮拉提斯: {
    emoji: "🤸",
    gradient: "linear-gradient(135deg,#a29bfe,#6c5ce7)",
  },
  空中瑜伽: {
    emoji: "🧘‍♀️",
    gradient: "linear-gradient(135deg,#81ecec,#00cec9)",
  },
  詠春: { emoji: "🥋", gradient: "linear-gradient(135deg,#2d3436,#636e72)" },
  劍擊: { emoji: "🤺", gradient: "linear-gradient(135deg,#dfe6e9,#b2bec3)" },

  // === 戶外 ===
  遠足行山: {
    emoji: "🥾",
    gradient: "linear-gradient(135deg,#00b894,#00a86b)",
  },
  露營戶外: {
    emoji: "🏕️",
    gradient: "linear-gradient(135deg,#2d3436,#0984e3)",
  },
  攀岩: { emoji: "🧗", gradient: "linear-gradient(135deg,#e17055,#d35400)" },
  單車: { emoji: "🚴", gradient: "linear-gradient(135deg,#0984e3,#74b9ff)" },
  溜冰: { emoji: "⛸️", gradient: "linear-gradient(135deg,#a29bfe,#74b9ff)" },
  射箭: { emoji: "🏹", gradient: "linear-gradient(135deg,#6d4c41,#8d6e63)" },

  // === 特別 ===
  水中運動: {
    emoji: "🏊",
    gradient: "linear-gradient(135deg,#0984e3,#006266)",
  },
  太極養生: {
    emoji: "☯️",
    gradient: "linear-gradient(135deg,#00b894,#55efc4)",
  },
  兒童體適能: {
    emoji: "🧒",
    gradient: "linear-gradient(135deg,#fdcb6e,#f39c12)",
  },
  長者體適能: {
    emoji: "👴",
    gradient: "linear-gradient(135deg,#dfe6e9,#b2bec3)",
  },
  產後修復: {
    emoji: "🤰",
    gradient: "linear-gradient(135deg,#fd79a8,#e84393)",
  },
};

// 輔助函數：根據分類取得漸變色
function getCategoryGradient(category) {
  var cfg = ZENPASS_CATEGORY[category];
  return cfg
    ? cfg.gradient
    : "linear-gradient(135deg,var(--orange-100),var(--orange-200))";
}

// 輔助函數：根據分類取得 emoji
function getCategoryEmoji(category) {
  var cfg = ZENPASS_CATEGORY[category];
  return cfg ? cfg.emoji : "🏃";
}

// 輔助函數：根據分類取得完整圖片 HTML
function getCategoryImageHTML(category, sizeStyle) {
  var emoji = getCategoryEmoji(category);
  var gradient = getCategoryGradient(category);
  var style = sizeStyle || "width:100%;height:100%";
  return (
    '<div class="class-card-img" style="background:' +
    gradient +
    ";display:flex;align-items:center;justify-content:center;font-size:32px;" +
    style +
    '">' +
    emoji +
    "</div>"
  );
}
