#!/usr/bin/env bash
# ZenPass — 前端版本切換（blue-green）
# 用法（喺 VPS 以 root 執行）:
#   bash scripts/switch-frontend.sh status      # 睇邊個版本 live
#   bash scripts/switch-frontend.sh promote     # 一鍵升級到 frontend-v2
#   bash scripts/switch-frontend.sh rollback    # 一鍵回滾返 frontend
#
# 原理：nginx root 指向 symlink `frontend-active`；切換 = 重指 symlink + reload。
# 秒級、唔停機、可即時回滾。
set -euo pipefail

ROOT="/var/www/zenpass"
LINK="$ROOT/frontend-active"
V1="$ROOT/frontend"
V2="$ROOT/frontend-v2"

case "${1:-status}" in
  promote)
    [ -d "$V2" ] || { echo "❌ $V2 唔存在（未 deploy v2？）"; exit 1; }
    ln -sfn "$V2" "$LINK"
    nginx -t && systemctl reload nginx
    echo "✅ live → v2 ($(readlink "$LINK"))"
    ;;
  rollback)
    [ -d "$V1" ] || { echo "❌ $V1 唔存在"; exit 1; }
    ln -sfn "$V1" "$LINK"
    nginx -t && systemctl reload nginx
    echo "✅ live → v1 ($(readlink "$LINK"))"
    ;;
  status)
    echo "live: $(readlink "$LINK" 2>/dev/null || echo '(未設定 symlink)')"
    ;;
  *)
    echo "usage: switch-frontend.sh {promote|rollback|status}"; exit 1;;
esac
