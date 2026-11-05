#!/usr/bin/env node
/**
 * ZenPass — WhatsApp 行前通知名冊產生器（只產生清單，唔會發送）
 *
 * 用法：
 *   node scripts/whatsapp-roster.js --schedule <schedule_id> [--json]
 *   node scripts/whatsapp-roster.js --schedule <id> --template "自訂 {name} ..."
 *
 * 特點：
 *  - 由 DB 讀實際班次時間／地點／導師，唔寫死（避免 10:30–11:45 呢類錯時間）
 *  - 同一用戶同一班多個 booking（2 人同行）合併為 1 條訊息，pax = 位數
 *  - payment_status：全部 paid 才當已付款；否則標「待核實」
 *  - 電話自動清洗＋補 852；無效電話會標示，唔會產生假連結
 *  - 輸出 Markdown + 一鍵 wa.me 連結；--json 供其他程式用
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const args = process.argv.slice(2);
const getArg = (k, d = null) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const SCHEDULE_ID = getArg("--schedule");
const AS_JSON = args.includes("--json");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "zenpass.db");

if (!SCHEDULE_ID) {
  console.error("用法：node scripts/whatsapp-roster.js --schedule <schedule_id> [--json]");
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

const info = db
  .prepare(
    `SELECT cs.id, cs.start_time, cs.end_time, cs.max_participants, cs.enrolled_count,
            c.title, c.venue_name, c.venue_address, c.duration,
            u.name AS coach_name
       FROM class_schedules cs
       JOIN classes c ON c.id = cs.class_id
       LEFT JOIN users u ON u.id = c.coach_id
      WHERE cs.id = ?`,
  )
  .get(SCHEDULE_ID);

if (!info) {
  console.error("找不到班次：" + SCHEDULE_ID);
  process.exit(2);
}

// 以 HKT 顯示（DB 可能存 UTC "YYYY-MM-DD HH:mm:ss" 或 ISO）
const parseUtc = (s) => {
  const str = String(s);
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(str)) return new Date(str);
  return new Date(str.replace(" ", "T") + "Z");
};
const hkt = (s) => parseUtc(s).toLocaleString("zh-HK", {
  timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const dateHKT = new Date(parseUtc(info.start_time).getTime() + 8 * 3600e3);
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const dateLabel = `${dateHKT.getUTCFullYear()} 年 ${dateHKT.getUTCMonth() + 1} 月 ${dateHKT.getUTCDate()} 日（星期${WEEK[dateHKT.getUTCDay()]}）`;
const timeLabel = `${String(dateHKT.getUTCHours()).padStart(2, "0")}:${String(dateHKT.getUTCMinutes()).padStart(2, "0")}`;
const endD = new Date(parseUtc(info.end_time).getTime() + 8 * 3600e3);
const endLabel = `${String(endD.getUTCHours()).padStart(2, "0")}:${String(endD.getUTCMinutes()).padStart(2, "0")}`;

const rows = db
  .prepare(
    `SELECT u.id AS user_id, u.name, u.phone,
            COUNT(*) AS pax,
            SUM(b.amount) AS amount,
            SUM(CASE WHEN b.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
            GROUP_CONCAT(b.booking_reference, ' / ') AS refs
       FROM bookings b
       JOIN users u ON u.id = b.user_id
      WHERE b.schedule_id = ?
        AND b.status IN ('confirmed', 'pending_payment', 'pending')
      GROUP BY u.id
      ORDER BY MIN(b.created_at) ASC`,
  )
  .all(SCHEDULE_ID);

function normPhone(raw) {
  let p = String(raw || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
}

function buildMessage(r) {
  const paid = Number(r.paid_count) === Number(r.pax) && Number(r.pax) > 0;
  const pair = Number(r.pax) >= 2;
  const lines = [
    "【ZenPass 課堂提醒】樂齡深層伸展班即將開課 🧘‍♀️",
    "",
    `${r.name} 您好！您已預約下週一的伸展課堂${pair ? `（此通知已包含您預約的 ${r.pax} 位學員名額）` : ""}：`,
    "",
    `📅 日期：${dateLabel}`,
    `⏰ 時間：上午 ${timeLabel} – ${endLabel}（請提早 10 分鐘到場點名）`,
    `📍 地點：${info.venue_name}${info.venue_address ? `・${info.venue_address}` : ""}`,
    `👩‍🏫 導師：${info.coach_name || "教練"}`,
    "",
    "課前小貼士：",
    "1. 請穿著寬鬆舒適運動服飾；現場提供已消毒瑜伽墊，建議自備水樽與小毛巾。",
    "2. 如有膝關節或腰椎舊患，請於課前向導師提出，導師會為您調整動作。",
  ];
  if (!paid) {
    lines.push("", "⚠️ 備註：系統顯示您的 FPS 款項尚在核實中。如已完成轉數快，請直接將付款截圖回傳此訊息即可！");
  }
  lines.push("", "期待見到您！如需交通指引可直接回覆此 WhatsApp 訊息。");
  return { text: lines.join("\n"), paid, pair };
}

const out = rows.map((r) => {
  const phone = normPhone(r.phone);
  const valid = /^[4-9]\d{7}$/.test(phone);
  const full = valid ? "852" + phone : "";
  const { text, paid, pair } = buildMessage(r);
  return {
    name: r.name,
    phone: full,
    valid_phone: valid,
    pax: Number(r.pax),
    paid,
    pair,
    amount: Number(r.amount) || 0,
    refs: r.refs,
    message: text,
    wa_url: valid ? `https://wa.me/${full}?text=${encodeURIComponent(text)}` : null,
  };
});

if (AS_JSON) {
  console.log(JSON.stringify({
    schedule: {
      id: info.id, title: info.title, start: hkt(info.start_time), end: hkt(info.end_time),
      venue: info.venue_name, address: info.venue_address, coach: info.coach_name,
      capacity: info.max_participants, enrolled: info.enrolled_count,
    },
    count: out.length, recipients: out,
  }, null, 2));
  process.exit(0);
}

console.log(`\n### ${dateLabel} ${timeLabel} — ${info.title}`);
console.log(`📍 ${info.venue_name}${info.venue_address ? "・" + info.venue_address : ""}　👩‍🏫 ${info.coach_name || "-"}　名額 ${info.enrolled_count}/${info.max_participants}\n`);

if (!out.length) {
  console.log("⚠️ 目前此班次尚無有效預約記錄（0 位學員），無需發送。");
  process.exit(0);
}

console.log(`共 ${out.length} 位報名人（合共 ${out.reduce((s, x) => s + x.pax, 0)} 個位）；已付款 ${out.filter(x => x.paid).length}、待核實 ${out.filter(x => !x.paid).length}、2 人同行 ${out.filter(x => x.pair).length}\n`);

out.forEach((r, i) => {
  console.log(`#### ${i + 1}. ${r.name} ｜ ${r.pax} 位 ｜ ${r.paid ? "已付款" : "待核實"} ｜ HK$${r.amount} ｜ ${r.refs}`);
  console.log(`- **電話**：\`${r.phone || "無效電話"}\``);
  console.log(`- **一鍵發送**：${r.wa_url ? `[打開 WhatsApp](${r.wa_url})` : "❌ 電話無效，需人手補"}`);
  console.log(`- **文字預覽**：\n> ${r.message.split("\n").join("\n> ")}\n---`);
});
