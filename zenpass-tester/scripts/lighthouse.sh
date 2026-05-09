#!/bin/bash
# ZenPass Lighthouse 性能測試
# Usage: bash scripts/lighthouse.sh [url] [output-dir]

BASE_URL="${1:-http://localhost:3001}"
OUTPUT_DIR="${2:-test-reports/lighthouse}"
mkdir -p "$OUTPUT_DIR"

echo "🔦 Lighthouse 性能測試"
echo "   Base: $BASE_URL"
echo ""

PAGES=(
  "$BASE_URL/"
  "$BASE_URL/courses.html"
  "$BASE_URL/explore.html"
  "$BASE_URL/membership.html"
  "$BASE_URL/login.html"
  "$BASE_URL/admin.html"
)

for page in "${PAGES[@]}"; do
  name=$(echo "$page" | sed 's|.*/||' | sed 's|\.html$||')
  [ -z "$name" ] && name="index"
  fname="$OUTPUT_DIR/lighthouse-$name.json"
  
  echo "  Testing: $page"
  npx lighthouse "$page" \
    --output=json \
    --output-path="$fname" \
    --chrome-flags="--headless --no-sandbox --disable-gpu" \
    --quiet \
    --throttling-method=provided \
    2>/dev/null
  
  if [ -f "$fname" ]; then
    SCORE=$(python3 -c "
import json
with open('$fname') as f:
    d = json.load(f)
cats = d.get('categories', {})
print(f'  Performance: {cats.get(\"performance\",{}).get(\"score\",0)*100:.0f}')
print(f'  Accessibility: {cats.get(\"accessibility\",{}).get(\"score\",0)*100:.0f}')
print(f'  Best Practices: {cats.get(\"best-practices\",{}).get(\"score\",0)*100:.0f}')
print(f'  SEO: {cats.get(\"seo\",{}).get(\"score\",0)*100:.0f}')
" 2>/dev/null)
    echo -e "  ✅ 已完成  $SCORE"
  else
    echo -e "  ⚠️  Lighthouse 失敗 (可能需要 GUI 環境)"
  fi
  echo ""
done

echo "📊 報告位置: $OUTPUT_DIR/"
