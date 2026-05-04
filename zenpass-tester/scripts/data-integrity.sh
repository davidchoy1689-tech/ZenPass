#!/bin/bash
# ZenPass Data Integrity Check
# Validates all reference numbers and data consistency

BASE="${1:-http://localhost:3001}"

TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@zenpass.hk","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "FAIL: Cannot login"
  exit 1
fi

echo "=== Data Integrity Check ==="
FAIL=0

# Check classes
CLASSES=$(curl -s "$BASE/api/admin/classes" -H "Authorization: Bearer $TOKEN")
echo "Classes: $(echo "$CLASSES" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('classes',[])))" 2>/dev/null)"

echo "$CLASSES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
issues=[]
for c in d.get('classes',[]):
    if not c.get('class_reference','').startswith('CL-'): issues.append(f'Bad class_ref: {c.get(\"class_reference\")}')
    if not c.get('coach_reference','').startswith('US-'): issues.append(f'Bad coach_ref: {c.get(\"coach_reference\")}')
    if c.get('price_hkd',0) <= 0: issues.append(f'Zero/Sell price: {c.get(\"title\")}')
if issues:
    for i in issues: print(f'  ISSUE: {i}')
    sys.exit(1)
else:
    print('  All class references OK')
"

if [ $? -ne 0 ]; then FAIL=1; fi

# Check bookings
BOOKINGS=$(curl -s "$BASE/api/admin/bookings?limit=100" -H "Authorization: Bearer $TOKEN")
echo "Bookings: $(echo "$BOOKINGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null)"

echo "$BOOKINGS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
issues=[]
for b in d.get('bookings',[]):
    if not b.get('booking_reference','').startswith('ZP-'): issues.append(f'Bad booking_ref: {b.get(\"booking_reference\")}')
    if not b.get('user_reference','').startswith('US-'): issues.append(f'Bad user_ref in booking')
    if not b.get('class_reference','').startswith('CL-'): issues.append(f'Bad class_ref in booking')
    valid_pay = ['pending','paid','refunded','failed']
    valid_st = ['confirmed','cancelled','pending_payment','no_show','completed']
    if b.get('payment_status') not in valid_pay: issues.append(f'Bad payment_status: {b.get(\"payment_status\")}')
    if b.get('status') not in valid_st: issues.append(f'Bad status: {b.get(\"status\")}')
    if b.get('amount',0) <= 0: issues.append(f'Zero/Neg amount: {b.get(\"booking_reference\")}')
if issues:
    for i in issues: print(f'  ISSUE: {i}')
    sys.exit(1)
else:
    print('  All booking data OK')
"

if [ $? -ne 0 ]; then FAIL=1; fi

# Check users
USERS=$(curl -s "$BASE/api/admin/users" -H "Authorization: Bearer $TOKEN")
echo "Users: $(echo "$USERS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('users',[])))" 2>/dev/null)"

echo "$USERS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
issues=[]
for u in d.get('users',[]):
    if not u.get('user_reference','').startswith('US-'): issues.append(f'Bad user_ref: {u.get(\"user_reference\")}')
    if not u.get('email'): issues.append(f'No email: {u.get(\"name\")}')
    if not u.get('name'): issues.append(f'No name: {u.get(\"email\")}')
if issues:
    for i in issues: print(f'  ISSUE: {i}')
    sys.exit(1)
else:
    print('  All user data OK')
"

if [ $? -ne 0 ]; then FAIL=1; fi

# Summary
echo ""
if [ "$FAIL" = "0" ]; then
  echo "✅ Data integrity: ALL OK"
else
  echo "❌ Data integrity: ISSUES FOUND"
fi
exit $FAIL
