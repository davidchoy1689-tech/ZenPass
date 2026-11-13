#!/usr/bin/env node
/**
 * Phase 6.2 B：通票防過期提醒名單（只產生，唔會發送）
 *
 * 用法：
 *   node backend/scripts/breakage-nudges.js            # 顯示名單 + wa.me 連結
 *   node backend/scripts/breakage-nudges.js --csv      # 出 CSV（Excel 可直接開）
 *   node backend/scripts/breakage-nudges.js --json     # 出 JSON（供其他程式用）
 *
 * 兩類名單：
 *   DAY_7_FIRST_CLASS — 買了 7 日仍未上第一堂
 *   EXPIRY_10D        — 10 日內到期但仍有餘堂
 */
const path = require("path");
const { getDb } = require(path.join(__dirname, "..", "src", "services", "database"));
const { buildNudges } = require(path.join(__dirname, "..", "src", "routes", "breakage-analytics"));

const args = process.argv.slice(2);
const AS_CSV = args.includes("--csv");
const AS_JSON = args.includes("--json");

const db = getDb();
const data = buildNudges(db);
const rows = [...data.day7, ...data.expiry10];

if (AS_JSON) {
  console.log(JSON.stringify({ ok: true, exported_at: new Date().toISOString(), ...data }, null, 2));
  process.exit(0);
}

if (AS_CSV) {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["類型", "姓名", "電話", "餘堂", "到期日", "wa.me 連結", "訊息"];
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.tag,
        r.student_name || r.user_name || "",
        r.phone || "",
        r.remaining_credits,
        String(r.expires_at || "").slice(0, 10),
        r.wa || "(電話無效)",
        r.message,
      ]
        .map(esc)
        .join(","),
    );
  }
  // BOM 讓 Excel 正確顯示中文
  process.stdout.write("\uFEFF" + lines.join("\r\n") + "\r\n");
  process.exit(0);
}

console.log("========================================");
console.log(" 通票防過期提醒名單（只產生，唔會發送）");
console.log(` ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`);
console.log("========================================");
console.log(`Day-7 未開課：${data.counts.day7} 位`);
console.log(`10 日內到期：${data.counts.expiry10} 位`);
if (!rows.length) {
  console.log("（暫時冇需要提醒嘅通票）");
  process.exit(0);
}
rows.forEach((r, i) => {
  console.log("----------------------------------------");
  console.log(`${i + 1}. [${r.tag}] ${r.student_name || r.user_name || "—"}  ${r.phone || "（無電話）"}`);
  console.log(`   餘 ${r.remaining_credits} 堂 · 到期 ${String(r.expires_at || "").slice(0, 10) || "—"}`);
  console.log(`   ${r.wa || "⚠️ 電話無效，無法產生連結"}`);
});
console.log("----------------------------------------");
console.log("提示：撳連結會打開 WhatsApp，訊息已預填，需要你自己撳「發送」。");
