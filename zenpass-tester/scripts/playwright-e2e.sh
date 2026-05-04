#!/bin/bash
# ZenPass Playwright E2E Test Runner (完整版)
# 使用 Playwright 嘅 spec files 跑 booking flow + admin panel
# Usage: bash scripts/playwright-e2e.sh [group]
#   group: booking | admin | all (default)

MODE="${1:-all}"
cd /Users/user/.openclaw/workspace/zenpass-platform/zenpass-tester

echo "========================================"
echo "  ZenPass Playwright E2E (完整用戶流程)"
echo "========================================"
echo ""

# Check server
if ! curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "❌ Server not running on localhost:3001"
  exit 1
fi

# Install Playwright browsers if needed
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
  echo "📦 Installing Playwright browsers..."
  npx playwright install chromium 2>&1 | tail -1
fi

# Run Playwright with spec files
case "$MODE" in
  booking)
    echo "▶️  Running: Booking Flow tests"
    npx playwright test playwright/booking-flow.spec.js --config=playwright.config.js
    ;;
  admin)
    echo "▶️  Running: Admin Panel tests"
    npx playwright test playwright/admin-panel.spec.js --config=playwright.config.js
    ;;
  all)
    echo "▶️  Running: All E2E tests"
    npx playwright test --config=playwright.config.js
    ;;
  *)
    echo "❌ Unknown mode: $MODE (use: booking, admin, all)"
    exit 1
    ;;
esac

EXIT=$?

echo ""
if [ $EXIT -eq 0 ]; then
  echo "✅ Playwright E2E全部通過"
else
  echo "❌ Playwright E2E有失敗，請檢查 test-reports/playwright-report"
fi

exit $EXIT
