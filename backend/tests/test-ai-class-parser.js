/**
 * ZenPass — AI 開班：文字解析 tests（純函數，唔需要 DB）
 */
const assert = require("assert");
const { parseClassText, hkToISO } = require("../src/services/ai-class-parser");

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

console.log("🧪 AI 開班解析 tests");
const NOW = "2026-10-20T12:00:00Z"; // 香港時間 20:00

// 1. 典型宣傳單張
const flyer = [
  "芬蘭木柱新手體驗班",
  "日期：10月21日（星期三）",
  "時間：晚上7:00-8:30",
  "地點：觀塘 APM 體育館 3樓",
  "費用：HK$150",
  "名額：12人",
  "查詢：2387 0724",
].join("\n");
const d1 = parseClassText(flyer, { now: NOW });
ok(d1.title === "芬蘭木柱新手體驗班", "抽到課程名稱");
ok(d1.category === "新興運動" && d1.sport_slug === "molkky", "關鍵字 → 分類／運動（芬蘭木柱）");
ok(d1.price_hkd === 150 && d1.credits_cost === 15, "價錢 $150 → 15 credits（1cr = $10）");
ok(d1.max_participants === 12, "名額 12 人");
ok(d1.duration === 90, "時長 90 分鐘（19:00–20:30）");
ok(d1.venue_name === "觀塘 APM 體育館3樓", "抽到地點（OCR 正規化會收窄多餘空格）");
ok(d1.schedules.length === 1, "1 個場次");
ok(d1.schedules[0].start_time === "2026-10-21T11:00:00.000Z", "10/21 19:00 HKT → 11:00Z（UTC 儲存）");
ok(d1.schedules[0].end_time === "2026-10-21T12:30:00.000Z", "結束時間 20:30 HKT → 12:30Z");
ok(d1.needs_review === false && d1.confidence === 4, "資料齊 → 唔需要特別覆核");

// 2. 逢星期幾 → 4 堂
const weekly = ["瑜伽初階班", "逢星期三 7:00pm-8:00pm", "地點：中環 Studio A", "費用：$120", "名額：8"].join("\n");
const d2 = parseClassText(weekly, { now: NOW });
ok(d2.category === "瑜伽", "瑜伽分類");
ok(d2.schedules.length === 4, "逢星期三 → 自動排 4 堂");
ok(d2.schedules[0].start_time === "2026-10-21T11:00:00.000Z", "首堂由下一個星期三開始");
ok(d2.schedules[3].start_time === "2026-11-11T11:00:00.000Z", "第 4 堂 = 3 週後");
ok(d2.schedules.every((s) => s.recurring === "weekly"), "標記為每週重複");

// 3. 下午時間 + 中文數字單位
const pm = ["兒童體適能", "2026年11月2日 15:00 至 16:00", "地點：沙田大會堂", "價錢：200元", "上限：20人"].join("\n");
const d3 = parseClassText(pm, { now: NOW });
ok(d3.category === "兒童體適能", "兒童關鍵字分類");
ok(d3.price_hkd === 200 && d3.credits_cost === 20, "200元 → 20 credits");
ok(d3.schedules[0].start_time === "2026-11-02T07:00:00.000Z", "2026-11-02 15:00 HKT = 07:00Z");

// 4. 資料唔齊 → 需要覆核
const thin = parseClassText("太極班 查詢 1234 5678", { now: NOW });
ok(thin.needs_review === true, "資料不足 → needs_review = true");
ok(thin.schedules.length === 0, "冇日期時間 → 唔會亂排場次");

// 5. 時間工具：跨日／跨午
ok(hkToISO(2026, 10, 21, 19 * 60) === "2026-10-21T11:00:00.000Z", "hkToISO 19:00 HKT → 11:00Z");
const late = parseClassText(["夜跑班", "10月22日 10:00pm-11:30pm", "地點：維園", "費用：$100"].join("\n"), { now: NOW });
ok(late.schedules[0].start_time === "2026-10-22T14:00:00.000Z", "10:00pm → 22:00 HKT = 14:00Z");

// 6. 日期格式：日/月/年（香港慣例）
const fmt = [
  ["21/10 19:00-20:00 木柱班 費用：$150", "2026-10-21T11:00:00.000Z", "21/10 → 10月21日"],
  ["21/10/2026 晚上7:00-8:00 瑜伽班 費用：$120", "2026-10-21T11:00:00.000Z", "21/10/2026 → 日/月/年"],
  ["2026/10/21 15:00-16:00 兒童班 費用：$200", "2026-10-21T07:00:00.000Z", "2026/10/21 → 年/月/日"],
  ["10月21日 19:00-20:30 木柱班 費用：$150", "2026-10-21T11:00:00.000Z", "10月21日 → 月/日"],
  ["5/11 7:00pm-8:00pm 太極班 費用：$100", "2026-11-05T11:00:00.000Z", "含糊 5/11 → 當 11月5日（香港慣例）"],
  ["15-11 19:00-20:00 劍擊班 費用：$180", "2026-11-15T11:00:00.000Z", "15-11 → 11月15日"],
  ["3/11 10:00-11:00 伸展班 費用：$90", "2026-11-03T02:00:00.000Z", "3/11 → 11月3日（唔會當 3月11日）"],
];
for (const [txt, expected, label] of fmt) {
  const d = parseClassText(txt, { now: NOW });
  ok((d.schedules[0] || {}).start_time === expected, label + "（" + (d.schedules[0] || {}).start_time + "）");
}

// 日期唔會被誤判成時間範圍
const noFalseTime = parseClassText("21/10 木柱班 費用：$150", { now: NOW });
ok(noFalseTime.schedules.length === 0, "只有日期冇時間 → 唔會亂作場次");

console.log(fail === 0 ? "\n✅ 全部通過" : "\n❌ " + fail + " 項失敗");
process.exit(fail === 0 ? 0 : 1);
