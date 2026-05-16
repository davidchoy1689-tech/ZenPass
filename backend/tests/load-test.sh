#!/bin/bash
# ZenPass Load Test Script
# 簡單的並發負載測試，測試 /api/health endpoint
#
# 用法：bash backend/tests/load-test.sh
# 自訂參數：CONCURRENT=50 COUNT=200 bash backend/tests/load-test.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"
CONCURRENT="${CONCURRENT:-20}"
COUNT="${COUNT:-100}"
TIMEOUT="${TIMEOUT:-10}"

echo "╔══════════════════════════════════════════════╗"
echo "║  ZenPass Load Test                          ║"
echo "║  ${BASE_URL}/api/health                      ║"
echo "║  Requests: ${COUNT}  |  Concurrent: ${CONCURRENT}     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check server is running
if ! curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "${BASE_URL}/api/health" | grep -q "200"; then
  echo "❌ Server not responding at ${BASE_URL}/api/health"
  echo "   Please start the server: cd backend && node src/index.js"
  exit 1
fi

echo "✅ Server is running"
echo ""

# Create temp directory for results
TMPDIR=$(mktemp -d)
RESULT_FILE="${TMPDIR}/results.txt"
TIMING_FILE="${TMPDIR}/timing.txt"

# Function: send one request and record timing
send_request() {
  local start end duration status
  start=$(perl -MTime::HiRes=time -e 'printf "%.6f\n", time' 2>/dev/null || python3 -c 'import time; print(time.time())' 2>/dev/null || date +%s)
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "${BASE_URL}/api/health" 2>/dev/null || echo "000")
  end=$(perl -MTime::HiRes=time -e 'printf "%.6f\n", time' 2>/dev/null || python3 -c 'import time; print(time.time())' 2>/dev/null || date +%s)

  # Calculate duration in milliseconds
  if command -v python3 &>/dev/null; then
    duration=$(python3 -c "print(int(($end - $start) * 1000))" 2>/dev/null || echo "0")
  elif command -v perl &>/dev/null; then
    duration=$(perl -e "printf '%d', ($end - $start) * 1000" 2>/dev/null || echo "0")
  else
    duration=$(( ($end - $start) * 1000 ))
  fi

  echo "${status} ${duration}" >> "${RESULT_FILE}"
}

echo "🚀 Starting ${COUNT} requests with ${CONCURRENT} concurrent workers..."
echo ""

START_TIME=$(date +%s)

# Launch requests in batches to simulate concurrency
BATCH_SIZE="${CONCURRENT}"
BATCHES=$(( (COUNT + BATCH_SIZE - 1) / BATCH_SIZE ))

for (( batch=0; batch<BATCHES; batch++ )); do
  START=$(( batch * BATCH_SIZE + 1 ))
  END=$(( START + BATCH_SIZE - 1 ))
  if [ "$END" -gt "$COUNT" ]; then
    END=$COUNT
  fi

  # Launch this batch
  JOBS=()
  for (( i=START; i<=END; i++ )); do
    send_request &
    JOBS+=($!)
  done

  # Wait for all jobs in this batch
  for pid in "${JOBS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Progress indicator
  echo "  📊 Batch $((batch+1))/${BATCHES} — $END/${COUNT} requests sent"
done

END_TIME=$(date +%s)
TOTAL_TIME=$(( END_TIME - START_TIME ))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Analyze results
TOTAL_REQ=$(wc -l < "${RESULT_FILE}" | tr -d ' ')
SUCCESS_REQ=$(grep -c "^200 " "${RESULT_FILE}" 2>/dev/null | tr -d '\n' || echo 0)
ERROR_REQ=$(grep -c "^[^2]" "${RESULT_FILE}" 2>/dev/null | tr -d '\n' || echo 0)
[ -z "$SUCCESS_REQ" ] && SUCCESS_REQ=0
[ -z "$ERROR_REQ" ] && ERROR_REQ=0
[ -z "$TOTAL_REQ" ] && TOTAL_REQ=0
SUCCESS_RATE=$(awk "BEGIN {printf \"%.1f\", ($SUCCESS_REQ/$TOTAL_REQ)*100}")

echo "📊 Results:"
echo "   Total Requests:    ${TOTAL_REQ}"
echo "   Successful (200):  ${SUCCESS_REQ} (${SUCCESS_RATE}%)"
echo "   Errors:            ${ERROR_REQ}"
echo "   Total Time:        ${TOTAL_TIME}s"
echo "   Throughput:        $(if [ "$TOTAL_TIME" -gt 0 ]; then echo "scale=1; $TOTAL_REQ/$TOTAL_TIME" | bc 2>/dev/null || echo "$TOTAL_REQ/$TOTAL_TIME"; else echo "N/A"; fi) req/s"
echo ""

# Calculate response time statistics
if [ "$TOTAL_REQ" -gt 0 ]; then
  # Extract response times
  awk '{print $2}' "${RESULT_FILE}" > "${TIMING_FILE}"
  
  # Sort for percentile calculation
  sort -n "${TIMING_FILE}" > "${TIMING_FILE}.sorted"
  
  # Calculate min, max, avg
  if command -v python3 &>/dev/null; then
    python3 -c "
import sys
times = []
with open('${TIMING_FILE}', 'r') as f:
    for line in f:
        line = line.strip()
        if line:
            try:
                times.append(int(line))
            except:
                pass
if not times:
    print('   No timing data')
    sys.exit(0)
times.sort()
n = len(times)
avg = sum(times) / n
p50 = times[n // 2]
p75 = times[int(n * 0.75)]
p90 = times[int(n * 0.9)]
p95 = times[int(n * 0.95)]
p99 = times[int(n * 0.99)]
print(f'   Min:        {min(times)}ms')
print(f'   Max:        {max(times)}ms')
print(f'   Average:    {avg:.1f}ms')
print(f'   Median/P50: {p50}ms')
print(f'   P75:        {p75}ms')
print(f'   P90:        {p90}ms')
print(f'   P95:        {p95}ms')
print(f'   P99:        {p99}ms')
"
  else
    # Fallback to awk-based calculations
    echo "   Min: $(head -1 "${TIMING_FILE}.sorted")ms"
    echo "   Max: $(tail -1 "${TIMING_FILE}.sorted")ms"
    TOTAL_MS=$(awk '{s+=$1} END {print s}' "${TIMING_FILE}")
    AVG_MS=$(awk "BEGIN {printf \"%.1f\", $TOTAL_MS/$TOTAL_REQ}")
    echo "   Average: ${AVG_MS}ms"
    echo "   (Install python3 for detailed percentile stats)"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for errors by type
echo "📋 Error Breakdown:"
if [ "$ERROR_REQ" -gt 0 ]; then
  cut -d' ' -f1 "${RESULT_FILE}" | sort | uniq -c | sort -rn | while read -r count code; do
    case "$code" in
      000) desc="Connection refused/timeout" ;;
      400) desc="Bad request" ;;
      429) desc="Rate limited" ;;
      500) desc="Internal server error" ;;
      502) desc="Bad gateway" ;;
      503) desc="Service unavailable" ;;
      *) desc="Unknown" ;;
    esac
    echo "   $code ($count): $desc"
  done
else
  echo "   ✅ No errors!"
fi

# Cleanup
rm -rf "${TMPDIR}"

echo ""
if [ "$SUCCESS_RATE" = "100.0" ] || [ "$SUCCESS_RATE" = "100" ]; then
  echo "✅ Load test PASSED — all requests successful!"
else
  echo "⚠️  Load test completed with some errors"
fi
