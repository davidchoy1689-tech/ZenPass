#!/bin/bash
# ZenPass API Quick Smoke Test
# 快速檢查所有關鍵 endpoints 是否正常運作
# Usage: bash test-smoke.sh [base_url]

BASE="${1:-http://localhost:3001}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

test_endpoint() {
    local desc="$1" method="$2" path="$3" expected="$4" data="$5"
    local full_url="${BASE}${path}"
    
    if [ "$method" = "GET" ]; then
        local resp=$(curl -s -o /dev/null -w "%{http_code}" "$full_url" -H "Authorization: Bearer demo_token_admin" 2>/dev/null)
    else
        local resp=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$full_url" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer demo_token_admin" \
            -d "$data" 2>/dev/null)
    fi
    
    if [ "$resp" = "$expected" ]; then
        green "  ✅ $desc ($resp)"
        PASS=$((PASS+1))
    else
        red "  ❌ $desc (expected $expected, got $resp)"
        FAIL=$((FAIL+1))
    fi
}

bold "🧪 ZenPass API Smoke Test"
echo "Base: $BASE"
echo ""

# Health
bold "── Health ──"
test_endpoint "GET /api/health" GET "/api/health" "200"

# Auth
AUTH_CHECK=$(curl -s "http://localhost:3001/api/auth/me" | grep -c "需要登入")
if [ "$AUTH_CHECK" -ge 1 ]; then
    green "  ✅ GET /api/auth/me rejects unauthenticated"
    PASS=$((PASS+1))
else
    red "  ❌ GET /api/auth/me does not reject"
    FAIL=$((FAIL+1))
fi
bold "── Auth ──"
# auth/me returns 200 w/ error message (not 401) - skip status check
test_endpoint "POST /api/auth/register (bad body)" POST "/api/auth/register" "400" '{}'

# Classes
bold "── Classes ──"
test_endpoint "GET /api/classes" GET "/api/classes" "200"
test_endpoint "GET /api/classes/categories" GET "/api/classes/categories" "200"

# Bookings
bold "── Bookings ──"
test_endpoint "POST /api/bookings (bad body)" POST "/api/bookings" "400" '{}'
test_endpoint "POST /api/bookings (bad UUID)" POST "/api/bookings" "400" \
  '{"schedule_id":"bad","class_id":"bad","payment_type":"single"}'

# Memberships
bold "── Memberships ──"
test_endpoint "GET /api/memberships/plans" GET "/api/memberships/plans" "200"

# Admin
bold "── Admin ──"
test_endpoint "GET /api/admin/bookings" GET "/api/admin/bookings" "200"

# Security
bold "── Security ──"
HEADERS=$(curl -s -D - "$BASE/api/health" 2>/dev/null)
echo "$HEADERS" | grep -q "X-Frame-Options: SAMEORIGIN" && green "  ✅ X-Frame-Options: SAMEORIGIN" && PASS=$((PASS+1)) || red "  ❌ X-Frame-Options missing"
echo "$HEADERS" | grep -q "X-Content-Type-Options: nosniff" && green "  ✅ X-Content-Type-Options: nosniff" && PASS=$((PASS+1)) || red "  ❌ X-Content-Type-Options missing"

# CORS block
CORS_TEST=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health" -H "Origin: https://evil.com" 2>/dev/null)
CORS_HEADER=$(curl -s -D - "$BASE/api/health" -H "Origin: https://evil.com" 2>/dev/null | grep -i "access-control-allow-origin")
if [ -z "$CORS_HEADER" ]; then
    green "  ✅ CORS blocks evil origin"
    PASS=$((PASS+1))
else
    red "  ❌ CORS allows evil origin: $CORS_HEADER"
    FAIL=$((FAIL+1))
fi

echo ""
bold "═══════════════════════════════"
bold "結果：$PASS passed / $FAIL failed"
if [ $FAIL -eq 0 ]; then
    green "🎉 全部通過！"
else
    red "❌ 有 $FAIL 個測試失敗"
    exit 1
fi
