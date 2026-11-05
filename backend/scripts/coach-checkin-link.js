#!/usr/bin/env node
/**
 * 產生教練免登入點名連結（課前 30 分鐘人手／cron 發送）
 * 用法：node scripts/coach-checkin-link.js --schedule <id> [--base https://zenpass.hk]
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { sign } = require("../src/services/coach-checkin-token");

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SID = arg("--schedule");
const BASE = arg("--base", "https://zenpass.hk");
if (!SID) { console.error("用法：node scripts/coach-checkin-link.js --schedule <id>"); process.exit(1); }

const db = new Database(process.env.DB_PATH || path.join(__dirname, "..", "data", "zenpass.db"), { readonly: true });
const s = db
  .prepare(
    `SELECT cs.id, cs.end_time, c.title, c.coach_id, u.name coach_name, u.phone coach_phone
       FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
       LEFT JOIN users u ON u.id=c.coach_id WHERE cs.id=?`,
  )
  .get(SID);
if (!s) { console.error("找不到班次"); process.exit(2); }

const parseUtc = (x) => {
  const str = String(x);
  return /[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? new Date(str) : new Date(str.replace(" ", "T") + "Z");
};
const exp = Math.floor(parseUtc(s.end_time).getTime() / 1000) + 3 * 3600; // 課後 3 小時
const token = sign({ scheduleId: s.id, coachId: s.coach_id, expiresAt: exp });
const url = `${BASE}/coach-checkin.html?t=${encodeURIComponent(token)}`;

console.log(url);
console.error(`# ${s.title} · ${s.coach_name || ""} · 有效至 ${new Date(exp * 1000).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`);
console.error(`# WhatsApp 文案：\n${s.coach_name || "導師"} 你好！今日點名連結（免登入）：\n${url}\n請用手機打開，逐位撳「點名簽到」即可。`);
