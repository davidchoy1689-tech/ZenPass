#!/bin/bash
# ZenPass — PM2 重啟頻率監控（防 Crash Loop）
#
# 每 15 分鐘由 cron 執行：讀 pm2 jlist 的 restart_time，與上次比較。
# delta >= 2 → 寫 /var/log/zenpass/alert.log（Mac 監控會轉 Telegram）＋ optional webhook。
#
# 環境變數（測試用）：
#   PM2_STATE_FILE      預設 /tmp/pm2_last_restarts
#   PM2_ALERT_LOG       預設 /var/log/zenpass/alert.log
#   PM2_STATUS_FILE     預設 /var/log/zenpass/pm2-restart-status.json
#   PM2_RESTART_THRESHOLD 預設 2
#   ALERT_WEBHOOK_URL   選填：POST JSON {"text": "..."}
set -u

PM2_NAME="${PM2_NAME:-zenpass-api}"
STATE="${PM2_STATE_FILE:-/tmp/pm2_last_restarts}"
ALERT_LOG="${PM2_ALERT_LOG:-/var/log/zenpass/alert.log}"
STATUS="${PM2_STATUS_FILE:-/var/log/zenpass/pm2-restart-status.json}"
THRESHOLD="${PM2_RESTART_THRESHOLD:-3}"
WEBHOOK="${ALERT_WEBHOOK_URL:-}"
TS=$(date '+%Y-%m-%d %H:%M:%S')
EPOCH=$(date +%s)

# 讀 restart_time（pm2 不在／未啟動 → 靜靜退出，唔好誤報）
if ! command -v pm2 >/dev/null 2>&1; then
  exit 0
fi
CUR=$(pm2 jlist 2>/dev/null | jq -r --arg n "$PM2_NAME" '.[] | select(.name==$n) | .pm2_env.restart_time' 2>/dev/null | head -1)
case "$CUR" in
  ''|*[!0-9]*) exit 0 ;;
esac

# 第一次跑（或重開機 /tmp 清空）→ 只做 baseline，唔響警報
if [ ! -f "$STATE" ]; then
  echo "$CUR" > "$STATE"
  printf '{"ts":%s,"last":%s,"now":%s,"delta":0,"alert":false}\n' "$EPOCH" "$CUR" "$CUR" > "$STATUS" 2>/dev/null || true
  exit 0
fi

LAST=$(cat "$STATE" 2>/dev/null)
case "$LAST" in
  ''|*[!0-9]*) LAST="$CUR" ;;
esac

DELTA=$((CUR - LAST))
# pm2 重裝／reset 會令數字變細 → 當 baseline 重設，唔誤報
if [ "$DELTA" -lt 0 ]; then
  DELTA=0
  LAST="$CUR"
fi

echo "$CUR" > "$STATE"
printf '{"ts":%s,"last":%s,"now":%s,"delta":%s,"alert":%s}\n' \
  "$EPOCH" "$LAST" "$CUR" "$DELTA" "$([ "$DELTA" -ge "$THRESHOLD" ] && echo true || echo false)" \
  > "$STATUS" 2>/dev/null || true

# 2026-11-14：部署／人手 restart 會令 delta 上升，唔應該當 crash loop。
# 規則：pm2 uptime < 5 分鐘（剛重啟）且 delta < 5 → 視為計劃性重啟，唔報。
UPTIME_MS=$(pm2 jlist 2>/dev/null | jq -r --arg n "$PM2_NAME" '.[] | select(.name==$n) | .pm2_env.pm_uptime' 2>/dev/null | head -1)
UPTIME_S=999999
case "$UPTIME_MS" in
  ''|*[!0-9]*) : ;;
  *) UPTIME_S=$(( (EPOCH * 1000 - UPTIME_MS) / 1000 )) ;;
esac
if [ "$DELTA" -ge "$THRESHOLD" ] && [ "$UPTIME_S" -lt 300 ] && [ "$DELTA" -lt 5 ]; then
  DELTA_NOTE="planned-restart(uptime=${UPTIME_S}s)"
else
  DELTA_NOTE=""
fi

if [ "$DELTA" -ge "$THRESHOLD" ] && [ -z "$DELTA_NOTE" ]; then
  MSG="$TS ALERT $PM2_NAME restarts +$DELTA (last=$LAST now=$CUR) — 可能 crash loop 或 OOM，請查 pm2 logs"
  echo "$MSG" >> "$ALERT_LOG" 2>/dev/null || true
  if [ -n "$WEBHOOK" ]; then
    curl -s -m 8 -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
      --data "{\"text\":$(printf '%s' "$MSG" | jq -Rs .)}" >/dev/null 2>&1 || true
  fi
fi

exit 0
