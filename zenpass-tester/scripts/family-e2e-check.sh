#!/usr/bin/env bash
# ============================================================================
# 週一真實家庭閉環 — 伺服器端核對腳本（100% 只讀，絕不寫任何資料）
#
# 用法（在 VPS）：
#   cd /var/www/zenpass
#   bash zenpass-tester/scripts/family-e2e-check.sh 91234567 98765432 <班次ID>
#
# 參數：<付款人電話> <上課家人電話> [班次ID]
# 環境：DB 預設 /var/www/zenpass/backend/data/zenpass.db，可用 DB_PATH 覆寫
#
# 輸出：①–⑦ 七大指標 + 最終 PASS/FAIL 總計（exit code 0 = 全綠）
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

q() { sqlite3 -header -column "$DB" "$1"; }
val() { sqlite3 "$DB" "$1" 2>/dev/null | head -1; }

PASS=0; FAIL=0; TOTAL=0
check() { # check <期望> <實際> <描述>
  TOTAL=$((TOTAL+1))
  if [ "$1" = "$2" ]; then PASS=$((PASS+1)); printf "  ✅ %s（%s）\n" "$3" "$2";
  else FAIL=$((FAIL+1)); printf "  ❌ %s（期望 %s，實際 %s）\n" "$3" "$1" "$2"; fi
}

echo "════════════════════════════════════════════════════════"
echo " ZenPass 家庭閉環核對 · $(TZ=Asia/Hong_Kong date '+%Y-%m-%d %H:%M:%S HKT')"
echo " DB: $DB"
echo " 付款人: $PAYER   家人: $MEMBER   班次: ${SCHED:-（未指定）}"
echo "════════════════════════════════════════════════════════"

echo
echo "① 帳戶與電話狀態"
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
echo "③ 付款人 Pass 資產（total_credits / remaining_credits / price_paid）"
q "SELECT id AS pass_id, pass_type, total_credits, remaining_credits,
          price_paid AS price_paid_hkd, family_group_id, status, expires_at
     FROM user_passes
    WHERE COALESCE(owner_user_id, user_id) = (SELECT id FROM users WHERE phone='$PAYER' LIMIT 1)
    ORDER BY created_at DESC LIMIT 5;"

if [ -n "$SCHED" ]; then
  echo
  echo "④ 班次與預約（schedule_id / user_id / attendance_status）"
  q "SELECT s.id, c.title, s.start_time, s.end_time, s.max_participants, s.enrolled_count,
            s.status, s.booking_open, COALESCE(s.coach_override_id,c.coach_id) AS coach_id
       FROM class_schedules s LEFT JOIN classes c ON c.id=s.class_id
      WHERE s.id='$SCHED';"
  q "SELECT b.id AS booking_id, b.booking_reference, u.name, u.phone,
            b.status, b.payment_type, b.payment_status, b.attendance_status,
            b.units_consumed, b.pass_id, b.secondary_pass_id,
            COALESCE(b.amount_cents, ROUND(b.amount*100)) AS amount_cents,
            b.fraud_audit_status
       FROM bookings b JOIN users u ON u.id=b.user_id
      WHERE b.schedule_id='$SCHED' AND u.phone IN ('$PAYER','$MEMBER');"

  echo
  echo "⑤ 教練收益（班次級；淨額為整數 cents）"
  q "SELECT id, schedule_id, coach_id, COALESCE(earning_type,'primary') AS earning_type,
            COALESCE(enrolled_count,0) AS enrolled, unit_price_cents, gross_amount_cents,
            net_amount_cents, status, COALESCE(clearing_status,'—') AS clearing_status
       FROM coach_earnings WHERE schedule_id='$SCHED';"

  echo
  echo "⑥ prodtest 隔離檢查（正式報表必須為 0）"
  q "SELECT (SELECT COUNT(*) FROM class_schedules WHERE id LIKE 'prodtest-%' AND status<>'cancelled') AS prodtest_schedules,
            (SELECT COUNT(*) FROM coach_earnings WHERE schedule_id LIKE 'prodtest-%' AND status<>'cancelled') AS prodtest_earnings;"
fi

echo
echo "⑦ 最近相關審計（audit_log：action_type / entity_id）"
q "SELECT action_type, entity_type, entity_id, description, created_at
     FROM audit_log
    WHERE entity_id IN (SELECT id FROM user_passes WHERE COALESCE(owner_user_id,user_id)=(SELECT id FROM users WHERE phone='$PAYER' LIMIT 1))
       OR (entity_type='booking' AND entity_id IN (SELECT id FROM bookings WHERE schedule_id='${SCHED:-__none__}'))
    ORDER BY created_at DESC LIMIT 10;"

# ============================ 七大指標判定 ============================
echo
echo "════════════════ 七大指標判定 ════════════════"

check 2 "$(val "SELECT COUNT(*) FROM users WHERE phone IN ('$PAYER','$MEMBER')")" "① 兩個帳戶都存在"

check 1 "$(val "SELECT COUNT(*) FROM family_members fm JOIN family_groups fg ON fg.id=fm.family_group_id
                 JOIN users mb ON mb.id=fm.member_user_id JOIN users ow ON ow.id=fg.owner_user_id
                WHERE ow.phone='$PAYER' AND mb.phone='$MEMBER' AND COALESCE(fm.can_consume_pass,1)=1")" \
      "② 家人已入家庭組且可扣堂"

PASS_ROW="$(val "SELECT id || '|' || remaining_credits || '|' || COALESCE(family_group_id,'') || '|' || status
                   FROM user_passes
                  WHERE COALESCE(owner_user_id,user_id)=(SELECT id FROM users WHERE phone='$PAYER' LIMIT 1)
                  ORDER BY created_at DESC LIMIT 1")"
PASS_ID="${PASS_ROW%%|*}"
REST="${PASS_ROW#*|}"; REMAIN="${REST%%|*}"
REST2="${REST#*|}"; FGID="${REST2%%|*}"; PSTATUS="${REST2#*|}"
if [ -n "$PASS_ROW" ] && [ -n "$FGID" ]; then
  check 1 "1" "③ Pass 已綁定家庭群組（$PASS_ID · 餘 $REMAIN 堂 · $PSTATUS）"
else
  check 1 "0" "③ Pass 已綁定家庭群組"
fi

if [ -n "$SCHED" ]; then
  check 1 "$(val "SELECT COUNT(*) FROM bookings b JOIN users u ON u.id=b.user_id
                   WHERE b.schedule_id='$SCHED' AND u.phone='$MEMBER'")" \
        "④ 家人有該班預約紀錄"

  check "present" "$(val "SELECT COALESCE(attendance_status,'') FROM bookings b JOIN users u ON u.id=b.user_id
                            WHERE b.schedule_id='$SCHED' AND u.phone='$MEMBER'
                            ORDER BY b.created_at DESC LIMIT 1")" \
        "⑤ 已點名出席（attendance_status）"

  EARN="$(val "SELECT net_amount_cents FROM coach_earnings WHERE schedule_id='$SCHED' AND COALESCE(earning_type,'primary')='primary' ORDER BY created_at DESC LIMIT 1")"
  if [ -z "$EARN" ]; then
    check "有分錄" "無分錄" "⑥ 教練收益分錄存在"
  else
    # 整數檢查（無浮點）
    if [ "$EARN" = "$(printf '%.0f' "$EARN" 2>/dev/null)" ]; then
      check "整數" "整數" "⑥ 教練收益淨額為整數 cents（$EARN）"
    else
      check "整數" "$EARN" "⑥ 教練收益淨額為整數 cents"
    fi
  fi

  check 0 "$(val "SELECT (SELECT COUNT(*) FROM class_schedules WHERE id LIKE 'prodtest-%' AND status<>'cancelled')
                       + (SELECT COUNT(*) FROM coach_earnings WHERE schedule_id LIKE 'prodtest-%' AND status<>'cancelled')")" \
        "⑦ 無 prodtest 測試資料污染（已作廢者不計）"
else
  echo "  ℹ️  未提供班次 ID → ④–⑦ 略過（只核對帳戶／家庭／Pass）"
fi

echo "───────────────────────────────────────────────"
echo " 總計: ${PASS}/${TOTAL} 通過，${FAIL} 項未達標"
if [ "$FAIL" -eq 0 ] && [ -n "$SCHED" ]; then
  echo " 🎉 家庭閉環全綠 — 可簽核"
elif [ "$FAIL" -eq 0 ]; then
  echo " ✅ 帳戶／家庭／Pass 全綠（未驗班次）"
else
  echo " ⚠️  有項目未達標，請勿簽核，先排查"
fi
echo " 判讀基準：Pass 餘額 4→3；attendance_status=present；"
echo "           coach_earnings 淨額 = 14000 × 80% = 11200 cents；prodtest 全 0。"
echo "════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
