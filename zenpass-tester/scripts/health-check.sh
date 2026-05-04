#!/bin/bash
# ZenPass Health Check - Quick API smoke test
# Usage: bash scripts/health-check.sh [base_url]

BASE="${1:-http://localhost:3001}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASS=0
FAIL=0

check() {
  local label="$1" method="$2" url="$3" expected="${4:-200}"
  local resp
  if [ "$method" = "GET" ]; then
    resp=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$url" 2>/dev/null)
  else
    resp=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$4" "$url" 2>/dev/null)
  fi
  if [ "$resp" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $label ($resp)"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} $label (expected $expected, got $resp)"
    ((FAIL++))
  fi
}

check_noauth() {
  local label="$1" url="$2" expected="${3:-401}"
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$resp" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $label ($resp)"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} $label (expected $expected, got $resp)"
    ((FAIL++))
  fi
}

check_badtoken() {
  local label="$1" url="$2" expected="${3:-403}"
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" "$url" -H "Authorization: Bearer INVALID_TOKEN_HERE" 2>/dev/null)
  if [ "$resp" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $label ($resp)"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} $label (expected $expected, got $resp)"
    ((FAIL++))
  fi
}

echo ""
echo "🔍 ZenPass Health Check"
echo "   Base: $BASE"
echo ""

# Login to get token
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@zenpass.hk","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo -e "  ${RED}✗${NC} Login failed - check server is running"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Login OK (got token)"
((PASS++))

# Auth security
echo -e "\n${YELLOW}--- Auth Security ---${NC}"
check_noauth "No token → 401" "$BASE/api/admin/stats" "401"
check_badtoken "Wrong token → 403" "$BASE/api/admin/stats" "403"

# Dashboard
echo -e "\n${YELLOW}--- Dashboard ---${NC}"
check "Stats" "GET" "$BASE/api/admin/stats"

# Users
echo -e "\n${YELLOW}--- Users ---${NC}"
check "List users" "GET" "$BASE/api/admin/users"

# Classes
echo -e "\n${YELLOW}--- Classes ---${NC}"
check "List classes" "GET" "$BASE/api/admin/classes"

# Bookings
echo -e "\n${YELLOW}--- Bookings ---${NC}"
check "List bookings" "GET" "$BASE/api/admin/bookings?limit=5"

# Pending payments
echo -e "\n${YELLOW}--- Payments ---${NC}"
check "Pending payments" "GET" "$BASE/api/admin/pending-payments"

echo ""
echo -e "─────────────────────────"
echo -e "  ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo -e "─────────────────────────"
echo ""
exit $FAIL
