#!/bin/bash
# ZenPass Code Quality Check
# ESLint + Prettier validation on HTML/CSS/JS files

FRONTEND_DIR="${1:-frontend}"
OUTPUT_DIR="test-reports/code-quality"
mkdir -p "$OUTPUT_DIR"

echo "🔍 ZenPass Code Quality Check"
echo ""

PASS=0
FAIL=0

# Check ESLint
echo -e "\n--- ESLint ---"
ESLINT_OUT="$OUTPUT_DIR/eslint-results.txt"
npx eslint "$FRONTEND_DIR" --ext .js,.html --no-error-on-unmatched-pattern --format compact 2>/dev/null | tail -20 > "$ESLINT_OUT"
ESLINT_EXIT=$?
if [ "$ESLINT_EXIT" = "0" ]; then
  echo "  ✅ ESLint: No errors"
  ((PASS++))
else
  echo "  ⚠️  ESLint: Found issues (see $ESLINT_OUT)"
  cat "$ESLINT_OUT"
  ((FAIL++))
fi

# Check Prettier
echo -e "\n--- Prettier ---"
PRETTIER_OUT="$OUTPUT_DIR/prettier-results.txt"
npx prettier --check "$FRONTEND_DIR" --loglevel warn 2>/dev/null > "$PRETTIER_OUT"
PRETTIER_EXIT=$?
if [ "$PRETTIER_EXIT" = "0" ]; then
  echo "  ✅ Prettier: All files formatted"
  ((PASS++))
else
  ISSUES=$(wc -l < "$PRETTIER_OUT" 2>/dev/null || echo "0")
  echo "  ⚠️  Prettier: $ISSUES files need formatting (see $PRETTIER_OUT)"
  ((FAIL++))
fi

# Check HTML validity
echo -e "\n--- HTML Validation ---"
HTML_ISSUES=0
for f in "$FRONTEND_DIR"/*.html; do
  [ -f "$f" ] || continue
  # Check for common issues
  if grep -q '<meta charset="UTF-8">' "$f" 2>/dev/null; then
    :
  elif grep -q '<meta charset' "$f" 2>/dev/null; then
    :
  else
    echo "  ⚠️  Missing charset: $f"
    ((HTML_ISSUES++))
  fi
done
if [ "$HTML_ISSUES" = "0" ]; then
  echo "  ✅ HTML: All files have charset declaration"
  ((PASS++))
else
  echo "  ⚠️  HTML: $HTML_ISSUES issues found"
  ((FAIL++))
fi

# Summary
echo ""
echo "─────────────────────────"
echo -e "  ✅ $PASS passed, ⚠️  $FAIL issues"
echo "─────────────────────────"
echo ""
echo "Detailed results: $OUTPUT_DIR/"
exit $FAIL
