#!/usr/bin/env bash
# ============================================================================
# run-family-acceptance.sh — VPS 一鍵跑「家庭閉環驗收」（方案 A）
#
# 用法（VPS）：
#   cd /var/www/zenpass
#   bash zenpass-tester/scripts/run-family-acceptance.sh                # 自動揀班次
#   bash zenpass-tester/scripts/run-family-acceptance.sh --dry-run      # 只計劃，唔寫
#   bash zenpass-tester/scripts/run-family-acceptance.sh --schedule <id>
#   bash zenpass-tester/scripts/run-family-acceptance.sh --rollback     # 作廢上次驗收
#
# 環境：DB_PATH 預設 /var/www/zenpass/backend/data/zenpass.db
# 說明：全部寫入標記 is_acceptance_test=1；教練錢包即時沖回（金錢零影響），
#       可用 --keep-financials 保留入帳。
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export DB_PATH="${DB_PATH:-$ROOT/backend/data/zenpass.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ 找不到 DB: $DB_PATH"
  exit 2
fi

echo "▶ ZenPass 家庭閉環驗收 · DB=$DB_PATH"
node zenpass-tester/scripts/run-family-acceptance-flow.js --db "$DB_PATH" "$@"
