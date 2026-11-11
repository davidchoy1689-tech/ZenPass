#!/usr/bin/env bash
# ============================================================================
# 週一真實家庭閉環 — 伺服器端核對腳本（只讀，不寫任何資料）
#
# 用法（在 VPS）：
#   bash zenpass-tester/scripts/family-e2e-check.sh 91234567 98765432 sch_live_verify_001
#
# 參數：<付款人電話> <上課家人電話> [班次ID]
# 環境：DB 預設 /var/www/zenpass/backend/data/zenpass.db，可用 DB_PATH 覆寫
# ============================================================================
set -u
DB="${DB_PATH:-/var/www/zenpass/backend/data/zenpass.db}"
PAYER="${1:-}"
MEMBER="${2:-}"
SCHED="${3:-}"

if [ -z "$PAYER" ] || [ -z "$MEMBER" ]; then
  echo "用法: bash $0 <付款人電話8位> <家人電話8位> [班次ID]"
  exit 2
fi
if [ ! -f "$DB" ]; then
  echo "❌ 找不到 DB: $DB"
  exit 2
fi

norm() { echo "$1" | tr -cd '0-9' | sed 's/^852//'; }
PAYER="$(norm "$PAYER")"
MEMBER="$(norm "$MEMBER")"

q() { sqlite3 -box "$DB" "$1"; }

echo "════════════════════════════════════════════════════════"
echo " ZenPass 家庭閉環核對 · $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo " DB: $DB"
echo " 付款人: $PAYER   家人: $MEMBER   班次: ${SCHED:-（未指定）}"
echo "════════════════════════════════════════════════════════"

echo
echo "① 帳戶與電話狀態（軟閘：PHONE_VERIFY_ENFORCE=0 時只需有號碼）"
q "SELECT id, name, phone, role,
          CASE WHEN phone IS NULL OR phone='' THEN '❌ 缺電話' ELSE '✅ 有電話' END AS phone_ok,
          COALESCE(phone_verified_at,'—') AS phone_verified_at
     FROM users WHERE phone IN ('$PAYER','$MEMBER');"

echo
echo "② 家庭群組與成員"
q "SELECT fg.id AS group_id, fg.group_name, ow.name AS owner, ow.phone AS owner_phone,
          mb.name AS member, mb.phone AS member_phone, fm.relation_title, fm.can_consume_pass
     FROM family_groups fg
     JOIN users ow ON ow.id = fg.owner_user_id
     LEFT JOIN family_members fm ON fm.family_group_id = fg.id
     LEFT JOIN users mb ON mb.id = fm.member_user_id
    WHERE ow.phone = '$PAYER';"

echo
echo "③ 付款人 Pass 資產（實際欄位：total_credits / remaining_credits / price_paid）"
q "SELECT id AS pass_id, pass_type, total_credits, remaining_credits,
          price_paid AS price_paid_hkd, family_group_id, status, expires_at, payment_intent_id
     FROM user_passes
    WHERE owner_user_id = (SELECT id FROM users WHERE phone='$PAYER' LIMIT 1)
    ORDER BY created_at DESC LIMIT 5;"

if [ -n "$SCHED" ]; then
  echo
  echo "④ 班次與預約（實際欄位：schedule_id / user_id / attendance_status）"
  q "SELECT s.id, c.title, s.start_time, s.end_time, s.max_participants, s.enrolled_count,
            s.status, s.booking_open, COALESCE(s.coach_override_id,s.coach_id) AS coach_id
       FROM class_schedules s LEFT JOIN classes c ON c.id=s.class_id
      WHERE s.id='$SCHED';"
  q "SELECT b.id AS booking_id, b.booking_reference, u.name, u.phone,
            b.status, b.payment_type, b.payment_status, b.attendance_status,
            b.units_consumed, COALESCE(b.amount_cents, ROUND(b.amount*100)) AS amount_cents,
            b.fraud_audit_status
       FROM bookings b JOIN users u ON u.id=b.user_id
      WHERE b.schedule_id='$SCHED' AND u.phone IN ('$PAYER','$MEMBER');"

  echo
  echo "⑤ 教練收益（班次級聚合；淨額為整數 cents）"
  q "SELECT id, schedule_id, coach_id, earning_type, payout_month,
            net_amount_cents, clearing_status, COALESCE(bank_tx_id,'—') AS bank_tx_id
       FROM coach_earnings WHERE schedule_id='$SCHED';"

  echo
  echo "⑥ prodtest 隔離檢查（正式報表必須為 0）"
  q "SELECT COUNT(*) AS prodtest_schedules
       FROM class_schedules WHERE id LIKE 'prodtest-%';
     SELECT COUNT(*) AS prodtest_earnings
       FROM coach_earnings WHERE schedule_id LIKE 'prodtest-%';"
fi

echo
echo "⑦ 最近相關審計（audit_log 實際欄位：action_type / entity_id）"
q "SELECT action_type, entity_type, entity_id, description, created_at
     FROM audit_log
    WHERE entity_id IN (SELECT id FROM user_passes WHERE owner_user_id=(SELECT id FROM users WHERE phone='$PAYER' LIMIT 1))
       OR (entity_type='booking' AND entity_id IN (SELECT id FROM bookings WHERE schedule_id='${SCHED:-__none__}'))
    ORDER BY created_at DESC LIMIT 10;"

echo
echo "════════════════════════════════════════════════════════"
echo " 判讀：remaining_credits 應 4→3；attendance_status=present；"
echo "        coach_earnings 淨額 11200 cents（$140 × 80%）；prodtest 全 0。"
echo "════════════════════════════════════════════════════════"
