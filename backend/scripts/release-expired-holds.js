#!/usr/bin/env node
/**
 * ZenPass 過期 Hold 位釋放腳本（2026-11-17 更新）
 *
 * 規則：
 * - 用戶進入付款程序時，該位置會被 hold 住（bookings.hold_until）
 * - hold_until 過期而仍未付款 → 自動取消 booking，釋放名額
 * - 鎖位長度由 platform_settings.booking_hold_minutes 控制（3–120，預設 15）
 * - 已有人聲稱已轉帳（payment_claimed=1）→ 唔會即時取消，等客服核實
 *
 * 註：正常情況下 API 已內置 releaseExpiredHolds()，scheduler 亦會自動收尾；
 *     本腳本保留作獨立／手動補救用途，唔會重複扣名額（條件式 UPDATE 保證）。
 *
 * 排程：可每 5 分鐘執行一次（PM2 cron 或 crontab）
 */
const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, "data", "zenpass.db");

function readHoldMinutes(db) {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'booking_hold_minutes'").get();
    const n = Number(row && row.value);
    if (Number.isFinite(n) && n >= 3 && n <= 120) return Math.floor(n);
  } catch (e) {}
  return 15;
}

function releaseExpiredHolds() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const holdMinutes = readHoldMinutes(db);
  const now = new Date().toISOString();

  // 過期條件：
  // 1) 有 hold_until 且已過 → 以 hold_until 為準
  // 2) 冇 hold_until → created_at + booking_hold_minutes
  // 3) 已聲稱轉帳（payment_claimed=1）→ 寬限 60 分鐘後仍未核實才取消
  const expired = db
    .prepare(
      `SELECT b.id, b.schedule_id, b.booking_reference
         FROM bookings b
        WHERE b.status = 'pending_payment'
          AND b.fps_reference IS NULL
          AND b.payme_reference IS NULL
          AND (
            (COALESCE(b.payment_claimed,0) = 0 AND (
              (b.hold_until IS NOT NULL AND b.hold_until < datetime(?))
              OR (b.hold_until IS NULL AND datetime(b.created_at, '+' || ? || ' minutes') <= datetime(?))
            ))
            OR
            (COALESCE(b.payment_claimed,0) = 1 AND datetime(b.payment_claimed_at) < datetime(?, '-60 minutes'))
          )`,
    )
    .all(now, holdMinutes, now, now);

  if (expired.length === 0) {
    db.close();
    return { released: 0, hold_minutes: holdMinutes, expired: [] };
  }

  console.log(`🔓 發現 ${expired.length} 個過期 hold 位（鎖位 ${holdMinutes} 分鐘），正在釋放...`);

  const cancelStmt = db.prepare(
    `UPDATE bookings SET status = 'cancelled', payment_status = 'cancelled'
      WHERE id = ? AND status = 'pending_payment'`,
  );
  const decrStmt = db.prepare(
    "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?",
  );

  let released = 0;
  const releaseBatch = db.transaction((items) => {
    for (const item of items) {
      if (cancelStmt.run(item.id).changes > 0) {
        if (item.schedule_id) decrStmt.run(item.schedule_id);
        released++;
        console.log(
          `  ✅ 釋放: ${item.booking_reference || item.id} (schedule: ${String(item.schedule_id || "").slice(0, 12)}...)`,
        );
      }
    }
  });

  releaseBatch(expired);

  db.close();
  return { released, hold_minutes: holdMinutes, expired };
}

// ===== 直接執行 =====
if (require.main === module) {
  const result = releaseExpiredHolds();
  console.log(`\n🔓 完成: 釋放 ${result.released} 個 hold 位（鎖位設定 ${result.hold_minutes} 分鐘）`);
}

module.exports = { releaseExpiredHolds, readHoldMinutes };
