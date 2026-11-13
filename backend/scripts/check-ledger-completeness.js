#!/usr/bin/env node
/**
 * 帳務完整性檢查（唯讀，不會寫入任何資料）
 *
 * 用途：每次有新預約之後，確認「已付款 booking」都有對應 ledger 分錄，
 *       避免再出現「對帳時見到未入帳」而要去補帳。
 *
 * 用法：
 *   node backend/scripts/check-ledger-completeness.js            # 預設睇最近 7 日
 *   node backend/scripts/check-ledger-completeness.js --days=30
 *   node backend/scripts/check-ledger-completeness.js --all
 *
 * 離開碼：0 = 全部完整；1 = 有缺漏；2 = 執行錯誤
 */
const { getDb } = require("../src/services/database");
const accounting = require("../src/services/accounting");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const daysArg = args.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Math.max(1, parseInt(daysArg.split("=")[1], 10) || 7) : 7;

function main() {
  const db = getDb();

  // 排除生產測試單（schedule_id 或班名含 PROD-TEST）
  const where = [
    "b.status IN ('confirmed','attended','no_show')",
    "b.amount > 0",
    "COALESCE(b.schedule_id,'') NOT LIKE 'prodtest%'",
    "COALESCE(cl.title,'') NOT LIKE '[PROD-TEST]%'",
  ];
  if (!ALL) where.push(`b.created_at >= datetime('now','-${DAYS} days')`);

  const rows = db
    .prepare(
      `SELECT b.id, b.user_id, b.amount, b.status, b.payment_status, b.created_at
         FROM bookings b
         LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
         LEFT JOIN classes cl ON cl.id = cs.class_id
        WHERE ${where.join(" AND ")}
        ORDER BY b.created_at DESC`,
    )
    .all();

  const missing = [];
  for (const b of rows) {
    const entries = accounting.getEntriesByBooking(b.id);
    if (!entries.some((e) => e.transaction_type === "payment")) missing.push(b);
  }

  console.log("========================================");
  console.log(" ZenPass 帳務完整性檢查（唯讀）");
  console.log(` 範圍：${ALL ? "全部" : `最近 ${DAYS} 日`}`);
  console.log("========================================");
  console.log(`已付款 booking：${rows.length}`);
  console.log(`缺 ledger 分錄：${missing.length}`);

  if (missing.length) {
    console.log("----------------------------------------");
    missing.slice(0, 20).forEach((b) =>
      console.log(` ❌ ${b.id}  $${b.amount}  ${b.status}/${b.payment_status}  ${b.created_at}`),
    );
    if (missing.length > 20) console.log(` … 另有 ${missing.length - 20} 筆`);
    console.log("----------------------------------------");
    console.log("請用 scripts/ledger-reconcile.js 檢查（唔好直接 --backfill 測試單）");
    return 1;
  }

  console.log("✅ 全部已入帳");
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error("檢查失敗：", e.message);
  process.exit(2);
}
