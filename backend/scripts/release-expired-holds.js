#!/usr/bin/env node
/**
 * ZenPass 過期 Hold 位釋放腳本
 *
 * 規則：
 * - 用戶進入付款程序時，該位置會被 hold 住
 * - 15 分鐘內未完成付款 → 自動取消 booking，釋放名額
 * - 15 分鐘內完成付款 → booking confirmed
 * - 適用於所有付款場景（單次/Credits/會籍）
 *
 * 排程：建議每 5 分鐘執行一次（PM2 cron 或 scheduler.js）
 */

const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "zenpass.db");

function releaseExpiredHolds() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const now = new Date().toISOString();

  // 找出所有過期 15 分鐘的 pending_payment booking
  const expired = db
    .prepare(
      `
      SELECT b.id, b.schedule_id, b.class_id, b.user_id, b.booking_reference
      FROM bookings b
      WHERE b.status = 'pending_payment'
        AND datetime(b.created_at, '+15 minutes') <= datetime(?)
    `
    )
    .all(now);

  if (expired.length === 0) {
    db.close();
    return { released: 0, expired: [] };
  }

  console.log(
    `🔓 發現 ${expired.length} 個過期 hold 位，正在釋放...`
  );

  // 批次取消過期 booking 並釋放名額
  const cancelStmt = db.prepare(
    `UPDATE bookings SET status = 'cancelled', payment_status = 'refunded' WHERE id = ? AND status = 'pending_payment'`
  );

  const decrStmt = db.prepare(
    `UPDATE class_schedules SET enrolled_count = enrolled_count - 1 WHERE id = ? AND enrolled_count > 0`
  );

  const releaseBatch = db.transaction((items) => {
    for (const item of items) {
      const cancelResult = cancelStmt.run(item.id);
      if (cancelResult.changes > 0) {
        decrStmt.run(item.schedule_id);
        console.log(
          `  ✅ 釋放: ${item.booking_reference} (schedule: ${item.schedule_id?.substring(0, 12)}...)`
        );
      }
    }
  });

  releaseBatch(expired);

  db.close();
  return { released: expired.length, expired };
}

// ===== 直接執行 =====
if (require.main === module) {
  const result = releaseExpiredHolds();
  console.log(`\n🔓 完成: 釋放 ${result.released} 個 hold 位`);
}

module.exports = { releaseExpiredHolds };
