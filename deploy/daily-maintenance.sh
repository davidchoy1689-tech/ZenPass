#!/bin/bash
# ZenPass 每日凌晨維護腳本 (00:00 HKT)
# 確保第二日課堂資料準確無誤

set -e

DB_PATH="/var/www/zenpass/backend/data/zenpass.db"
LOG_FILE="/var/log/zenpass/daily-maintenance.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] 🚀 ZenPass 每日維護開始" >> "$LOG_FILE"

# 1. 釋放過期 Hold 位（pending_payment 超過 15 分鐘）
echo "  [1/6] 清理過期 hold 位..." >> "$LOG_FILE"
sqlite3 "$DB_PATH" "
  UPDATE bookings SET status = 'cancelled', updated_at = datetime('now')
  WHERE status = 'pending_payment'
    AND created_at < datetime('now', '-15 minutes');
" 2>&1 >> "$LOG_FILE"

# 2. 同步 enrolled_count（確保同實際 booking 數量一致）
echo "  [2/6] 同步 enrolled_count..." >> "$LOG_FILE"
sqlite3 "$DB_PATH" "
  UPDATE class_schedules SET enrolled_count = (
    SELECT COUNT(*) FROM bookings
    WHERE bookings.schedule_id = class_schedules.id
      AND bookings.status IN ('confirmed', 'attended', 'pending_payment')
  );
" 2>&1 >> "$LOG_FILE"

# 3. 檢查並清理已過去但未完成嘅 schedule
echo "  [3/6] 清理過期未完成 schedule..." >> "$LOG_FILE"
sqlite3 "$DB_PATH" "
  UPDATE class_schedules SET status = 'completed'
  WHERE status IS NULL AND end_time < datetime('now');
" 2>&1 >> "$LOG_FILE"

# 4. 驗證 pricing_config 完整性
echo "  [4/6] 驗證定價設定..." >> "$LOG_FILE"
MISSING=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM (
    SELECT 'plan_lite_price' AS k UNION SELECT 'plan_standard_price'
    UNION SELECT 'plan_silver_price' UNION SELECT 'plan_gold_price'
    UNION SELECT 'plan_lite_credits' UNION SELECT 'plan_standard_credits'
    UNION SELECT 'plan_silver_credits' UNION SELECT 'plan_gold_credits'
    UNION SELECT 'credit_cost_basic' UNION SELECT 'credit_cost_standard'
    UNION SELECT 'credit_cost_premium'
  ) AS required_keys
  WHERE required_keys.k NOT IN (SELECT key FROM pricing_config);
")
if [ "$MISSING" -gt 0 ]; then
  echo "  ⚠️ 缺少 $MISSING 個定價設定，請檢查" >> "$LOG_FILE"
else
  echo "  ✅ 定價設定完整" >> "$LOG_FILE"
fi

# 5. 核對 booking 數量同 enrolled_count 一致
echo "  [5/6] 核對 booking 一致性..." >> "$LOG_FILE"
MISMATCHES=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM class_schedules cs
  WHERE cs.enrolled_count != (
    SELECT COUNT(*) FROM bookings b
    WHERE b.schedule_id = cs.id
      AND b.status IN ('confirmed', 'attended', 'pending_payment')
  );
")
if [ "$MISMATCHES" -gt 0 ]; then
  echo "  ⚠️ $MISMATCHES 個 schedule enrolled_count 唔一致（已修復）" >> "$LOG_FILE"
fi

# 6. 清理過期 wallet hold (如有)
echo "  [6/6] 清理過期交易記錄..." >> "$LOG_FILE"
sqlite3 "$DB_PATH" "
  DELETE FROM wallet_transactions
  WHERE status = 'pending'
    AND created_at < datetime('now', '-7 days');
" 2>&1 >> "$LOG_FILE"

# Summary
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 每日維護完成" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Output summary (will be logged)
echo "✅ Daily maintenance complete"
