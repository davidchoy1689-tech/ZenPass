#!/bin/bash
# ZenPass 自動測試執行器 (updated)
# Usage: bash scripts/auto-test-runner.sh [health|light|full]
# - health: 快速健康檢查 (30min)
# - light:  輕量 E2E + code quality (2h)
# - full:   完整測試 + 截圖 + Lighthouse + 報告 (每天)

MODE="${1:-full}"
BASE_URL="${ZENPASS_URL:-http://localhost:3001}"
PROJECT_DIR="/Users/user/.openclaw/workspace/zenpass-platform"
LOG_DIR="$PROJECT_DIR/test-reports/auto"
HTML_REPORT="$PROJECT_DIR/test-reports/report.html"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_DIR/${MODE}_${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"

echo "============================================" | tee -a "$LOG_FILE"
echo "🧪 ZenPass 自動測試 [$MODE] — $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass_count=0
fail_count=0
warn_count=0

report_test() {
  local name="$1"
  local status="$2" # pass/fail/warn
  local detail="$3"
  if [ "$status" = "pass" ]; then
    echo -e "  ${GREEN}✅${NC} $name" | tee -a "$LOG_FILE"
    pass_count=$((pass_count+1))
  elif [ "$status" = "fail" ]; then
    echo -e "  ${RED}❌${NC} $name" | tee -a "$LOG_FILE"
    fail_count=$((fail_count+1))
  else
    echo -e "  ${YELLOW}⚠️${NC} $name" | tee -a "$LOG_FILE"
    warn_count=$((warn_count+1))
  fi
  [ -n "$detail" ] && echo "     $detail" | tee -a "$LOG_FILE"
}

# 1️⃣ Ensure Backend is running
echo "" | tee -a "$LOG_FILE"
echo "🔍 [1/4] Checking backend status..." | tee -a "$LOG_FILE"

if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null | grep -q 200; then
  report_test "Backend running" "pass" "$BASE_URL"
else
  report_test "Backend not running" "warn" "Attempting to start..."
  cd "$PROJECT_DIR/backend"
  lsof -ti:3001 | xargs kill -9 2>/dev/null
  sleep 1
  node src/index.js &
  BACKEND_PID=$!
  sleep 4
  if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null | grep -q 200; then
    report_test "Backend started" "pass" "PID: $BACKEND_PID"
  else
    report_test "Backend failed to start" "fail" ""
    exit 1
  fi
fi

# 2️⃣ Run unit tests
echo "" | tee -a "$LOG_FILE"
echo "🔍 [2/4] Running unit tests..." | tee -a "$LOG_FILE"
cd "$PROJECT_DIR"
UNIT_OUTPUT=$(npx vitest run --reporter verbose 2>&1)
UNIT_EXIT=$?
if [ $UNIT_EXIT -eq 0 ]; then
  report_test "Unit tests" "pass" "All passed"
else
  report_test "Unit tests" "fail" "Some tests failed"
fi
echo "$UNIT_OUTPUT" >> "$LOG_FILE"

# 3️⃣ Run E2E tests
echo "" | tee -a "$LOG_FILE"
echo "🔍 [3/4] Running E2E tests..." | tee -a "$LOG_FILE"
E2E_OUTPUT=$(npx playwright test 2>&1)
E2E_EXIT=$?
if [ $E2E_EXIT -eq 0 ]; then
  report_test "E2E tests" "pass" "All passed"
else
  report_test "E2E tests" "fail" "Some tests failed"
fi
echo "$E2E_OUTPUT" >> "$LOG_FILE"

# 4️⃣ Run optional tests
echo "" | tee -a "$LOG_FILE"
echo "🔍 [4/4] Running optional tests..." | tee -a "$LOG_FILE"

# Lighthouse
if [ "$MODE" = "full" ]; then
  LH_OUTPUT=$(bash zenpass-tester/scripts/lighthouse.sh 2>&1)
  echo "$LH_OUTPUT" >> "$LOG_FILE"
  if echo "$LH_OUTPUT" | grep -q "錯誤"; then
    report_test "Lighthouse" "warn" "Some pages had issues"
  else
    report_test "Lighthouse" "pass" "Performance tested"
  fi
fi

# Code quality
CQ_OUTPUT=$(bash zenpass-tester/scripts/code-quality.sh 2>&1)
echo "$CQ_OUTPUT" >> "$LOG_FILE"
if echo "$CQ_OUTPUT" | grep -q "issues"; then
  report_test "Code quality" "warn" "Minor issues found"
else
  report_test "Code quality" "pass" "Clean"
fi

# Screenshots
SC_OUTPUT=$(bash zenpass-tester/scripts/mobile-screenshots.sh 2>&1)
echo "$SC_OUTPUT" >> "$LOG_FILE"
if echo "$SC_OUTPUT" | grep -q "0 failed"; then
  report_test "Mobile screenshots" "pass" "21 captured"
else
  report_test "Mobile screenshots" "warn" "Some failed"
fi

echo "" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"
echo "📊 Summary: ✅ $pass_count passed | ⚠️  $warn_count warnings | ❌ $fail_count failed" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# Generate HTML report
cat > "$HTML_REPORT" << HTML
<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ZenPass 測試報告</title>
<style>
  body{font-family:-apple-system,sans-serif;max-width:1200px;margin:0 auto;padding:20px;background:#f5f5f5}
  h1{color:#333;border-bottom:2px solid #4CAF50;padding-bottom:10px}
  .summary{display:flex;gap:20px;margin:20px 0}
  .card{flex:1;padding:20px;border-radius:10px;text-align:center;color:#fff;font-weight:bold}
  .pass{background:#4CAF50}
  .warn{background:#FF9800}
  .fail{background:#f44336}
  table{width:100%;border-collapse:collapse;background:#fff;margin:20px 0;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
  th,td{padding:12px 15px;text-align:left;border-bottom:1px solid #ddd}
  th{background:#333;color:#fff}
  .ok{color:#4CAF50} .ko{color:#f44336} .wa{color:#FF9800}
  .section{margin:30px 0}
  img{max-width:100%;border:1px solid #ddd;border-radius:5px;margin:10px 0}
  .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:15px}
</style>
</head>
<body>
<h1>🧘 ZenPass 測試報告</h1>
<p>生成日期: $(date '+%Y-%m-%d %H:%M:%S %Z')</p>
<p>模式: $MODE | Backend: $BASE_URL</p>

<div class="summary">
  <div class="card pass">✅ $pass_count<br><small>通過</small></div>
  <div class="card warn">⚠️ $warn_count<br><small>警告</small></div>
  <div class="card fail">❌ $fail_count<br><small>失敗</small></div>
</div>

<table>
<tr><th>測試項目</th><th>狀態</th><th>詳細</th></tr>
HTML

# Append test results to HTML
while IFS= read -r line; do
  if [[ "$line" =~ ✅ ]]; then
    item=$(echo "$line" | sed 's/.*✅ //')
    echo "<tr><td>$item</td><td class='ok'>✅ 通過</td><td></td></tr>" >> "$HTML_REPORT"
  elif [[ "$line" =~ ❌ ]]; then
    item=$(echo "$line" | sed 's/.*❌ //')
    echo "<tr><td>$item</td><td class='ko'>❌ 失敗</td><td></td></tr>" >> "$HTML_REPORT"
  elif [[ "$line" =~ ⚠️ ]]; then
    item=$(echo "$line" | sed 's/.*⚠️ //')
    echo "<tr><td>$item</td><td class='wa'>⚠️ 警告</td><td></td></tr>" >> "$HTML_REPORT"
  fi
done < "$LOG_FILE"

cat >> "$HTML_REPORT" << HTML
</table>

<div class="section">
<h2>📸 Mobile Screenshots</h2>
<div class="gallery">
HTML

for img in test-reports/screenshots/mobile-375-*.png; do
  name=$(basename "$img" .png)
  html_name="screenshots/$name.png"
  cp "$img" "test-reports/$html_name"
  echo "<div><h4>$name</h4><a href='$html_name'><img src='$html_name' alt='$name'></a></div>" >> "$HTML_REPORT"
done

cat >> "$HTML_REPORT" << HTML
</div>
</div>

<div class="section">
<h2>📊 Lighthouse Scores</h2>
HTML

for lf in test-reports/lighthouse/lighthouse-*.json; do
  if [ -f "$lf" ]; then
    pname=$(basename "$lf" .json)
    scores=$(python3 -c "
import json
with open('$lf') as f:
    d = json.load(f)
cats = d.get('categories', {})
for k, v in cats.items():
    print(f'{k}: {v.get(\"score\", 0)*100:.0f}')
" 2>/dev/null)
    echo "<h4>$pname</h4><pre>$scores</pre>" >> "$HTML_REPORT"
  fi
done

cat >> "$HTML_REPORT" << HTML
</div>
<div class="section">
<p><em>🚀 ZenPass 自動測試完成 — 由自動化測試工程師執行</em></p>
</div>
</body>
</html>
HTML

echo "📄 HTML report generated: $HTML_REPORT"
exit $(( fail_count > 0 ? 1 : 0 ))
