#!/bin/bash
# ZenPass 自動測試執行器
# Usage: bash scripts/auto-test-runner.sh [health|light|full]
# - health: 快速健康檢查 (30min)
# - light:  輕量 E2E + code quality (2h)
# - full:   完整測試 + 截圖 + Lighthouse + 報告 (每天)

MODE="${1:-health}"
BASE_URL="${ZENPASS_URL:-http://localhost:3001}"
PROJECT_DIR="/Users/user/.openclaw/workspace/zenpass-platform"
LOG_DIR="$PROJECT_DIR/test-reports/auto"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_DIR/${MODE}_${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"

echo "============================================" | tee -a "$LOG_FILE"
echo "🧪 ZenPass 自動測試 [$MODE] — $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# 1️⃣ 確保 Backend 運行中
echo "" | tee -a "$LOG_FILE"
echo "🔍 [1/3] 檢查 Backend 狀態..." | tee -a "$LOG_FILE"

if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null | grep -q 200; then
  echo "   ✅ Backend 已在運行 ($BASE_URL)" | tee -a "$LOG_FILE"
else
  echo "   ⚠️  Backend 未啟動，嘗試啟動..." | tee -a "$LOG_FILE"
  cd "$PROJECT_DIR/backend"
  # Kill any stale node process on port 3001
  lsof -ti:3001 | xargs kill -9 2>/dev/null
  sleep 1
  node src/index.js &
  BACKEND_PID=$!
  sleep 4
  if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null | grep -q 200; then
    echo "   ✅ Backend 啟動成功 (PID: $BACKEND_PID)" | tee -a "$LOG_FILE"
  else
    echo "   ❌ Backend 啟動失敗！終止測試" | tee -a "$LOG_FILE"
    exit 1
  fi
fi

# 2️⃣ 執行對應測試
echo "" | tee -a "$LOG_FILE"
echo "🔍 [2/3] 執行測試..." | tee -a "$LOG_FILE"

FAIL_COUNT=0

case "$MODE" in
  health)
    echo "   → 健康檢查 + Data Integrity" | tee -a "$LOG_FILE"
    cd "$PROJECT_DIR"
    bash zenpass-tester/scripts/health-check.sh "$BASE_URL" 2>&1 | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    bash zenpass-tester/scripts/data-integrity.sh "$BASE_URL" 2>&1 | tee -a "$LOG_FILE"
    FAIL_COUNT=$(grep -c "✗" "$LOG_FILE" 2>/dev/null || echo 0)
    # sanitize
    FAIL_COUNT=$((FAIL_COUNT + 0))
    ;;

  light)
    echo "   → 輕量 E2E + Code Quality" | tee -a "$LOG_FILE"
    cd "$PROJECT_DIR"
    bash zenpass-tester/scripts/e2e-test.sh light 2>&1 | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    bash zenpass-tester/scripts/code-quality.sh 2>&1 | tee -a "$LOG_FILE"
    FAIL_COUNT=$(grep -c "✗\|FAIL\|error" "$LOG_FILE" 2>/dev/null || echo 0)
    FAIL_COUNT=$((FAIL_COUNT + 0))
    ;;

  full)
    echo "   → 完整測試 (All tests + Screenshots + Lighthouse + Report)" | tee -a "$LOG_FILE"
    cd "$PROJECT_DIR"
    
    # 完整 E2E
    bash zenpass-tester/scripts/e2e-test.sh full 2>&1 | tee -a "$LOG_FILE"
    
    # 資料完整性
    echo "" | tee -a "$LOG_FILE"
    bash zenpass-tester/scripts/data-integrity.sh "$BASE_URL" 2>&1 | tee -a "$LOG_FILE"
    
    # Code Quality
    echo "" | tee -a "$LOG_FILE"
    bash zenpass-tester/scripts/code-quality.sh 2>&1 | tee -a "$LOG_FILE"
    
    # Mobile Screenshots (視覺回歸)
    echo "" | tee -a "$LOG_FILE"
    bash zenpass-tester/scripts/mobile-screenshots.sh 2>&1 | tee -a "$LOG_FILE"
    
    # Lighthouse 性能測試
    echo "" | tee -a "$LOG_FILE"
    bash zenpass-tester/scripts/lighthouse.sh 2>&1 | tee -a "$LOG_FILE"
    
    # Unit tests
    echo "" | tee -a "$LOG_FILE"
    cd "$PROJECT_DIR"
    npx vitest run --reporter verbose 2>&1 | tee -a "$LOG_FILE"
    
    # 生成報告
    echo "" | tee -a "$LOG_FILE"
    python3 zenpass-tester/scripts/generate-report.py 2>&1 | tee -a "$LOG_FILE"
    
    FAIL_COUNT=$(grep -c "✗\|FAIL\|error\|tests failed" "$LOG_FILE" 2>/dev/null || echo 0)
    FAIL_COUNT=$((FAIL_COUNT + 0))
    ;;

  *)
    echo "   ❌ 未知模式: $MODE (可選: health|light|full)" | tee -a "$LOG_FILE"
    exit 1
    ;;
esac

# 3️⃣ 總結
echo "" | tee -a "$LOG_FILE"
echo "🔍 [3/3] 測試完成" | tee -a "$LOG_FILE"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "   ⚠️  發現 $FAIL_COUNT 個問題！詳情見: $LOG_FILE" | tee -a "$LOG_FILE"
  echo "   ❌ 需要檢查" | tee -a "$LOG_FILE"
else
  echo "   ✅ 全部測試通過" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "📄 Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# 輸出結果摘要
echo "===RESULT==="
echo "Mode: $MODE"
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Fails: $FAIL_COUNT"
echo "Log: $LOG_FILE"
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "Status: FAIL"
else
  echo "Status: PASS"
fi
echo "===RESULT_END==="

exit $((FAIL_COUNT))
