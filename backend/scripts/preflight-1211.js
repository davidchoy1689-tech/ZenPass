#!/usr/bin/env node
/**
 * 12/11 廣播前 Preflight（只讀，不會發送）
 * 用法：node scripts/preflight-1211.js
 * 退出碼：0 = 可以進行廣播；1 = 有阻礙（例如 0 人報名）
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "zenpass.db");
const db = new Database(DB_PATH, { readonly: true });

const S1 = "b54b7038-caa2-429e-b7a3-965abb35901a"; // 12/12 10:30
const S2 = "69770fe1-7970-4fb5-8be2-8960167dfa88"; // 12/16 10:30

const norm = (p) => String(p || "").replace(/\D/g, "").replace(/^852/, "").replace(/^0/, "");
const rows = db
  .prepare(
    `SELECT b.user_id, u.name, u.phone, COUNT(*) pax,
            SUM(CASE WHEN b.payment_status='paid' THEN 1 ELSE 0 END) paid,
            SUM(b.amount) amount
       FROM bookings b JOIN users u ON u.id=b.user_id
      WHERE b.schedule_id=? AND b.status IN ('confirmed','pending_payment')
      GROUP BY b.user_id ORDER BY MIN(b.created_at)`,
  )
  .all(S1);
const s1 = db.prepare("SELECT max_participants,enrolled_count FROM class_schedules WHERE id=?").get(S1);
const s2 = db.prepare("SELECT max_participants,enrolled_count FROM class_schedules WHERE id=?").get(S2);
const seats = rows.reduce((s, r) => s + Number(r.pax), 0);
const pairs = rows.filter((r) => Number(r.pax) > 1).length;
const unpaid = rows.filter((r) => Number(r.paid) < Number(r.pax)).length;
const badPhone = rows.filter((r) => !/^[4-9]\d{7}$/.test(norm(r.phone)));
const remaining2 = s2 ? Number(s2.max_participants) - Number(s2.enrolled_count) : 0;

const fail = [];
const warn = [];
if (!s1) {
  console.log("❌ 找不到 12/12 班次 — DB_PATH 可能指錯（本機 dev DB 冇正式班次）");
  process.exit(1);
}
console.log("\n🔎 12/12 首發 — 12/11 廣播 Preflight\n");
console.log(`班次：${s1 ? s1.enrolled_count : "?"}/${s1 ? s1.max_participants : "?"} 位`);
console.log(`報名：${rows.length} 位報名人 / ${seats} 個位｜2 人同行 ${pairs} 組｜待核實 ${unpaid} 位`);
console.log(`12/16 順延目標：尚餘 ${remaining2} 位`);

if (!rows.length) fail.push("12/12 班 0 人報名 — 廣播會 0 人收到，改發招生：docs/ops/promo-1109.md（第二波 12/11 10:30／第三波 19:00；連結 https://zenpass.hk/c/ching-yee）");
if (badPhone.length) fail.push(`有 ${badPhone.length} 個無效電話：${badPhone.map((r) => r.name || r.user_id).join("、")}`);
if (unpaid > 0) warn.push(`${unpaid} 位待核實付款 — 文案會自動加 FPS 補件句`);
if (remaining2 < 1) warn.push("12/16 已滿 — 改期功能將無目標班次");
if (remaining2 > 0 && remaining2 < 2) warn.push("12/16 只剩 1 位 — 2 人同行改期會失敗");

for (const w of warn) console.log("⚠️ " + w);
for (const f of fail) console.log("❌ " + f);
if (!fail.length && !warn.length) console.log("✅ 全部通過，可以發送");
else if (!fail.length) console.log("✅ 可發送（有提醒，請留意）");

console.log("\n下一步：node scripts/whatsapp-roster.js --schedule " + S1);
console.log("後台：admin-ops.html → 📅 預約管理（改期／加位）\n");
process.exit(fail.length ? 1 : 0);
