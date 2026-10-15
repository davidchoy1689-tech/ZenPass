#!/bin/bash
# ZenPass VPS 自身健康監控（純 shell，零 AI 成本）
# 安裝於 VPS cron；取代之前經 gateway/SSH 嘅健康檢查 job。
# 用法: health-monitor.sh [api|supabase]
set -u
LOG=/var/log/zenpass/health-monitor.log
ALERT_TO="${ZENPASS_ALERT_EMAIL:-info.zenpass@gmail.com}"
mkdir -p /var/log/zenpass
ts() { date '+%F %T'; }
alert() {
  echo "$(ts) ALERT: $1" >> "$LOG"
  printf '%s\n' "$1" | mail -s "🚨 ZenPass 系統警報" "$ALERT_TO" 2>/dev/null || true
}
mode="${1:-api}"
case "$mode" in
  api)
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://localhost:3001/api/health)
    if [ "$code" != "200" ]; then alert "API health FAIL: HTTP $code"; fi
    ;;
  supabase)
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 \
      -H 'apikey: sb_publishable_T0-t6qQcqqeIY48ucqzZrg_JvkqYNME' \
      -H 'Accept: application/json' 'https://pqgrkeavopksdttrzdqc.supabase.co/rest/v1/')
    if [ "$code" = "000" ] || { [ "$code" -ge 500 ] 2>/dev/null; }; then
      alert "Supabase ping FAIL: HTTP $code"
    fi
    ;;
  *) echo "usage: $0 [api|supabase]" >&2; exit 2 ;;
esac
exit 0
