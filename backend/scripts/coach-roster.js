#!/usr/bin/env node
/**
 * ZenPass — 教練點名單（WhatsApp 純文字）產生器
 *
 * 用法：node scripts/coach-roster.js --schedule <schedule_id>
 *      node scripts/coach-roster.js --date 2026-11-09   （自動揀該日樂齡/伸展班）
 *
 * 只輸出文字，唔會發送。
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SCHEDULE_ID = arg("--schedule");
const DATE = arg("--date") || "2026-11-09";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "zenpass.db");
const db = new Database(DB_PATH, { readonly: true });

const parseUtc = (s) => {
  const str = String(s);
  return /[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? new Date(str) : new Date(str.replace(" ", "T") + "Z");
};
const hktParts = (s) => {
  const d = new Date(parseUtc(s).getTime() + 8 * 3600e3);
  return {
    date: `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`,
    week: "日一二三四五六"[d.getUTCDay()],
    time: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  };
};

const sched = SCHEDULE_ID
  ? db.prepare(`SELECT cs.*, c.title, c.venue_name, c.venue_address, u.name AS coach_name
                FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
                LEFT JOIN users u ON u.id=c.coach_id WHERE cs.id=?`).get(SCHEDULE_ID)
  : db.prepare(`SELECT cs.*, c.title, c.venue_name, c.venue_address, u.name AS coach_name
                FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
                LEFT JOIN users u ON u.id=c.coach_id
                WHERE cs.start_time LIKE ? AND (c.title LIKE '%樂齡%' OR c.title LIKE '%伸展%')
                ORDER BY cs.start_time LIMIT 1`).get(DATE + "%");

if (!sched) { console.error("找不到班次"); process.exit(1); }

const bcols = new Set(db.prepare("PRAGMA table_info(bookings)").all().map(c => c.name));
const ucols = new Set(db.prepare("PRAGMA table_info(users)").all().map(c => c.name));
const col = (t, c, a, alias) => (t.has(c) ? `${alias}.${c}` : `NULL AS ${a}`);
const rows = db.prepare(`
  SELECT b.id, ${col(bcols, "medical_notes", "medical_notes", "b")},
         ${col(bcols, "emergency_phone", "b_emergency_phone", "b")},
         ${col(bcols, "child_name", "child_name", "b")},
         ${col(bcols, "attendee_type", "attendee_type", "b")},
         u.name, u.phone,
         ${col(ucols, "emergency_name", "emergency_name", "u")},
         ${col(ucols, "emergency_phone", "emergency_phone", "u")}
    FROM bookings b JOIN users u ON u.id=b.user_id
   WHERE b.schedule_id=? AND b.status IN ('confirmed','pending_payment')
   ORDER BY b.created_at ASC`).all(sched.id);

// 同一用戶合併（2 人同行 = 同 user 兩行）
const groups = [];
const map = new Map();
for (const r of rows) {
  const key = r.phone || r.name;
  if (!map.has(key)) { const g = { ...r, seats: 0, notes: [] }; map.set(key, g); groups.push(g); }
  const g = map.get(key);
  g.seats++;
  if (r.medical_notes && !g.notes.includes(r.medical_notes)) g.notes.push(r.medical_notes);
  if (r.child_name) g.child_name = r.child_name;
}

const start = hktParts(sched.start_time);
const end = hktParts(sched.end_time);
const seats = groups.reduce((s, g) => s + g.seats, 0);
const phoneFmt = (p) => {
  const d = String(p || "").replace(/\D/g, "").replace(/^852/, "");
  return d.length === 8 ? `852-${d.slice(0, 4)}-${d.slice(4)}` : (p || "未提供");
};

const out = [];
out.push(`${sched.coach_name || "導師"} 好！🧘‍♀️\n`);
out.push(`以下為 ${start.date}（星期${start.week}）的【學員點名單與課前備註】：\n`);
out.push("━━━━━━━━━━━━━━━━━━━");
out.push("📋 課堂基本資料");
out.push(`• 課程：${sched.title}`);
out.push(`• 日期：${start.date}（星期${start.week}）`);
const arrD = new Date(parseUtc(sched.start_time).getTime() + 8 * 3600e3 - 10 * 60000);
const arrTime = `${String(arrD.getUTCHours()).padStart(2, "0")}:${String(arrD.getUTCMinutes()).padStart(2, "0")}`;
out.push(`• 時間：上午 ${start.time} – ${end.time}（學員預計 ${arrTime} 陸續抵達）`);
out.push(`• 地點：${sched.venue_name}${/活動室/.test(String(sched.venue_address || "")) ? "" : "・活動室"}`);
if (sched.venue_address) out.push(` （${sched.venue_address}，到達後請依大堂水牌指示前往活動室）`);
out.push(`• 出席狀況：共 ${seats} 位學員（上限 ${sched.max_participants} 位）`);
out.push("━━━━━━━━━━━━━━━━━━━\n");
out.push("👥 學員點名單與健康備註\n");

if (!groups.length) {
  out.push("（目前暫無確認預約學員）\n");
} else {
  groups.forEach((g, i) => {
    const display = g.child_name ? `${g.name}（${g.child_name}）` : g.name;
    out.push(`${i + 1}. ${display}（先生／女士）`);
    out.push(` • 電話：${phoneFmt(g.phone)}`);
    out.push(` • 類別：${g.seats >= 2 ? `2 人同行（共 ${g.seats} 位）` : "單人預約"}`);
    out.push(` • 健康備註：${g.notes.length ? g.notes.join("；") : "無特殊舊患備註"}`);
    out.push(` • 緊急聯絡人：${g.emergency_name ? `${g.emergency_name} / ${phoneFmt(g.emergency_phone)}` : (g.b_emergency_phone ? phoneFmt(g.b_emergency_phone) : "未提供")}\n`);
  });
}

out.push("━━━━━━━━━━━━━━━━━━━");
out.push("⚠️ 課堂支援與應變備忘");
out.push("1. 瑜伽墊與裝備：場地已備妥活動室專用墊；已提醒學員自備水樽與小毛巾。");
out.push("2. 動作調整：點名時可針對上述關節舊患學員個別複核活動幅度。");
out.push("3. 突發聯絡：場地／門禁／學員迷路，請即時致電營運支援熱線：9033 5538。");
out.push("\n祝首發開堂順利，辛苦導師！🌿");

console.log(out.join("\n"));
