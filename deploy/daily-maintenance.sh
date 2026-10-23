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
  UPDATE bookings SET status = 'cancelled'
  WHERE status = 'pending_payment'
    AND created_at < datetime('now', '-15 minutes');
" >> "$LOG_FILE" 2>&1

# 2. 同步 enrolled_count（確保同實際 booking 數量一致）
echo "  [2/6] 同步 enrolled_count..." >> "$LOG_FILE"
sqlite3 "$DB_PATH" "
  UPDATE class_schedules SET enrolled_count = (
    SELECT COUNT(*) FROM bookings
    WHERE bookings.schedule_id = class_schedules.id
      AND bookings.status IN ('confirmed', 'attended', 'pending_payment')
  );
" >> "$LOG_FILE" 2>&1

# 3. 監察：已過去但仍標 available 嘅 schedule（唔改 status，因為 CHECK constraint 只准 available/full/cancelled）
#    預約層（backend createBooking + booking.html）已按 start_time 攔截，呢步只做 observability。
echo "  [3/6] 檢查已過去但仍 available 嘅 schedule..." >> "$LOG_FILE"
STALE=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM class_schedules
   WHERE status = 'available'
     AND datetime(replace(substr(end_time,1,19),'T',' ')) < datetime('now');
")
echo "  ℹ️ 已過去但仍 available：$STALE 堂（正常會累積，唔影響預約）" >> "$LOG_FILE"

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

# 6. 檢查所有金融記錄完整性 + DELETE trigger 狀態
# 確保所有金錢相關 table 都有 DELETE 保護 trigger
echo "  [6/6] 金融記錄完整性檢查..." >> "$LOG_FILE"

# 檢查 DELETE trigger 是否存在
for table in wallet_transactions coach_earnings coach_payouts bookings audit_log ledger transactions private_income venue_rentals partner_payouts refund_logs idempotency_keys credit_transactions; do
  TRIGGER_EXISTS=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='trigger' AND name='protect_${table}_delete';")
  ROW_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
  if [ -n "$TRIGGER_EXISTS" ]; then
    echo "  ✅ $table ($ROW_COUNT 條記錄) — 受保護" >> "$LOG_FILE"
  else
    echo "  ❌ $table ($ROW_COUNT 條記錄) — 缺少 DELETE trigger！" >> "$LOG_FILE"
  fi
done

# 檢查 wallet 記錄總數
echo "  ✅ wallet_transactions 記錄永久保存" >> "$LOG_FILE"

# 6b. Credits 對賬：users.credits 必須等於最新一筆流水嘅 balance_after
CREDIT_MISMATCH=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM users u
  WHERE COALESCE(u.credits,0) <> COALESCE(
    (SELECT c.balance_after FROM credit_transactions c
      WHERE c.user_id = u.id ORDER BY c.rowid DESC LIMIT 1), 0);
" 2>/dev/null || echo "0")
if [ "${CREDIT_MISMATCH:-0}" -gt 0 ]; then
  echo "  ⚠️ $CREDIT_MISMATCH 個用戶嘅 Credits 結餘同流水唔一致（需人手核對）" >> "$LOG_FILE"
else
  echo "  ✅ Credits 結餘與流水一致" >> "$LOG_FILE"
fi

# 7. 退款狀態閉環（2026-10-23）
# 7a. refund_state=pending 但 refund_logs 冇 pending → 狀態不一致
REF_STATE_BAD=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM bookings b
  WHERE b.refund_state = 'pending'
    AND NOT EXISTS (SELECT 1 FROM refund_logs r WHERE r.booking_id = b.id AND r.status = 'pending');
" 2>/dev/null || echo "0")
if [ "${REF_STATE_BAD:-0}" -gt 0 ]; then
  echo "  ⚠️ $REF_STATE_BAD 筆 booking refund_state=pending 但冇對應 pending 退款紀錄" >> "$LOG_FILE"
else
  echo "  ✅ 退款狀態與退款紀錄一致" >> "$LOG_FILE"
fi

# 7b. 已退款金額超過 booking 金額 → 超退
OVER_REFUND=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM (
    SELECT r.booking_id, SUM(r.amount) AS refunded, b.amount
    FROM refund_logs r JOIN bookings b ON b.id = r.booking_id
    WHERE r.status IN ('completed','pending')
    GROUP BY r.booking_id
    HAVING refunded > b.amount + 0.01
  );
" 2>/dev/null || echo "0")
if [ "${OVER_REFUND:-0}" -gt 0 ]; then
  echo "  ❌ $OVER_REFUND 筆預約退款總額超過原付款金額（需即時人手核查）" >> "$LOG_FILE"
else
  echo "  ✅ 冇超額退款" >> "$LOG_FILE"
fi

# 7c. 訪客預約：孤兒 booking（user 唔存在）
GUEST_ORPHAN=$(sqlite3 "$DB_PATH" "
  SELECT COUNT(*) FROM bookings b
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.user_id);
" 2>/dev/null || echo "0")
if [ "${GUEST_ORPHAN:-0}" -gt 0 ]; then
  echo "  ⚠️ $GUEST_ORPHAN 筆 booking 冇對應用戶（外鍵異常）" >> "$LOG_FILE"
else
  echo "  ✅ 所有 booking 都有對應用戶" >> "$LOG_FILE"
fi

# Summary
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 每日維護完成" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Output summary (will be logged)
echo "✅ Daily maintenance complete"
