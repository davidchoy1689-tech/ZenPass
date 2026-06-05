#!/bin/bash
# ZenPass Frontend Audit Runner — 每日 Cron 使用
# 發現問題會寫 log + 可選 alert channel
# Usage: bash scripts/frontend-check.sh [--alert]

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)
LOG_DIR="${PROJECT_ROOT}/test-reports"
LOG_FILE="${LOG_DIR}/frontend-audit-$(date +%Y%m%d-%H%M).log"
SUMMARY_LOG="${LOG_DIR}/frontend-audit-latest.log"
FAILURE_LOG="${LOG_DIR}/frontend-audit-failures.log"
ALERT="${1:-}"

mkdir -p "$LOG_DIR"

echo "========================================"
echo "  ZenPass Frontend Audit"
echo "  $(date)"
echo "========================================"

# 1. Check server
if ! curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "❌ Server not running" | tee "$LOG_FILE"
  exit 1
fi

# 2. Run Playwright audit
echo "▶️  Running frontend audit..."
set +e
npx playwright test tests/e2e/frontend-audit.spec.js \
  --reporter=list 2>&1 | tee "$LOG_FILE"

EXIT_CODE=$?
set -e

# 3. Save summary
cp "$LOG_FILE" "$SUMMARY_LOG"

# 4. Check for failures
FAILURES=$(grep -c "✘\|FAIL\|❌" "$LOG_FILE" || true)
PASSED=$(grep -c "✓\|✔\|✅\|PASS" "$LOG_FILE" || true)

echo ""
echo "========================================"
echo "📊  Summary: $FAILURES failures, ${PASSED:-0} passed"
echo "========================================"

if [ "$EXIT_CODE" -ne 0 ] || [ "$FAILURES" -gt 0 ]; then
  # Save failure details
  echo "=== FAILURES $(date) ===" >> "$FAILURE_LOG"
  grep "✘\|FAIL\|❌" "$LOG_FILE" >> "$FAILURE_LOG" 2>/dev/null || true
  echo "" >> "$FAILURE_LOG"

  echo "❌ Frontend audit FAILED"
  echo "   詳情: $LOG_FILE"
  exit 1
fi

echo "✅ Frontend audit all passed"
exit 0
