#!/usr/bin/env python3
"""
ZenPass Audit Reconciliation Report
-----------------------------------
Cross-checks the internal financial tables for consistency (IPO-audit oriented):
  C1  Booking four-way split:  platform + venue == amount ; coach net == expected share
  C2  Ledger double-entry:     per booking/reference, sum(debit) == sum(credit)
  C3  Ledger coverage:         every paid/attended booking has ledger entries
  C4  Wallet chain:            per user, balance_before == prev balance_after; amount matches delta
  C5  Coach earnings:          gross*commission == net ; paid earnings have payout_id
  C6  Referential integrity:   wallet_tx.source_id / ledger.booking_id exist in bookings

Usage: python3 reconcile-audit.py <path-to-sqlite.db> [--json]
Exit code 0 = all clean, 1 = discrepancies found.
"""
import sqlite3, sys, json
from collections import defaultdict

TOL = 0.01

def close(a, b):
    return abs((a or 0) - (b or 0)) <= TOL

def main():
    if len(sys.argv) < 2:
        print("usage: reconcile-audit.py <db> [--json]"); sys.exit(2)
    db_path = sys.argv[1]
    as_json = "--json" in sys.argv
    integrity_only = "--integrity-only" in sys.argv
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    q = lambda s, *a: db.execute(s, a).fetchall()

    findings = []   # (check, severity, message)
    def add(check, sev, msg): findings.append((check, sev, msg))

    def colset(t):
        try:
            return {r[1] for r in db.execute(f"PRAGMA table_info({t})")}
        except Exception:
            return set()

    # ---- C1: four-way split ----
    bc = colset("bookings")
    need = {"amount", "platform_earned_amount", "venue_earned_amount"}
    if bc and not need <= bc:
        add("C1.schema", "warn", f"bookings schema drift：缺少欄位 {sorted(need - bc)}（略過拆賬核對）")
    else:
        has_rate = "platform_commission_rate" in bc
        rate_sel = ",platform_commission_rate" if has_rate else ""
        rows = q(f"SELECT id,amount,status,payment_status,platform_earned_amount,venue_earned_amount{rate_sel} FROM bookings WHERE amount IS NOT NULL AND amount>0")
        for b in rows:
            amt = b["amount"]; rate = b["platform_commission_rate"] if has_rate else None
            plat = b["platform_earned_amount"]; venue = b["venue_earned_amount"]
            split_sum = (plat or 0) + (venue or 0)
            if (plat or 0) == 0 and (venue or 0) == 0:
                add("C1.split", "warn", f"booking {b['id'][:8]} amount={amt} 但平台/場地拆賬都係 0（未計拆賬）")
            elif not close(split_sum, amt):
                add("C1.split", "error", f"booking {b['id'][:8]} amount={amt} ≠ 平台{plat}+場地{venue}={round(split_sum,2)}")
            if rate is not None and (plat or 0) > 0 and not close(plat, amt * rate):
                add("C1.rate", "warn", f"booking {b['id'][:8]} 平台{plat} ≠ amount*rate({round(amt*rate,2)})")

    # ---- C2 + C3: ledger ----
    ledger_rows = q("SELECT booking_id, reference, debit, credit, transaction_type, account_code FROM ledger")
    by_ref = defaultdict(lambda: [0.0, 0.0])
    by_booking = defaultdict(int)
    for r in ledger_rows:
        by_ref[r["reference"]][0] += r["debit"] or 0
        by_ref[r["reference"]][1] += r["credit"] or 0
        by_booking[r["booking_id"]] += 1
    for ref, (d, c) in by_ref.items():
        if not close(d, c):
            add("C2.double_entry", "error", f"ledger reference {ref[:12]} 借貸不平：debit={round(d,2)} credit={round(c,2)}")
    paid = q("SELECT id,amount,status FROM bookings WHERE payment_status='paid' AND status IN ('confirmed','attended','no_show')")
    for b in paid:
        if by_booking.get(b["id"], 0) == 0:
            add("C3.coverage", "error", f"已付款 booking {b['id'][:8]} (amount={b['amount']}) 冇 ledger 記錄（double-entry 缺失）")

    # ---- C4: wallet chain ----
    ws = q("SELECT user_id,type,amount,balance_before,balance_after,created_at,id FROM wallet_transactions ORDER BY user_id,created_at,id")
    prev = {}
    for w in ws:
        u = w["user_id"]
        bb = w["balance_before"]; ba = w["balance_after"]; amt = w["amount"]
        if not (close(ba, bb + amt) or close(ba, bb - amt)):
            add("C4.wallet_math", "error", f"wallet {w['id'][:8]} user {u[:8]} 餘額跳動異常：{bb} → {ba} (amount {amt})")
        if u in prev and not close(bb, prev[u]):
            add("C4.wallet_chain", "warn", f"wallet user {u[:8]} 餘額斷鏈：前次 after={prev[u]} 但 before={bb}")
        prev[u] = ba

    # ---- C5: coach earnings ----
    for e in q("SELECT id,coach_id,gross_amount,commission_rate,net_amount,status,payout_id FROM coach_earnings"):
        exp = (e["gross_amount"] or 0) * (e["commission_rate"] or 0)
        if not close(exp, e["net_amount"] or 0):
            add("C5.earning_math", "error", f"coach_earning {e['id'][:8]} gross*rate={round(exp,2)} ≠ net={e['net_amount']}")
        if e["status"] == "paid" and not e["payout_id"]:
            add("C5.eaming_paid", "error", f"coach_earning {e['id'][:8]} status=paid 但冇 payout_id")

    # ---- C6: referential ----
    ids = {r["id"] for r in q("SELECT id FROM bookings")}
    for w in q("SELECT id,source_type,source_id FROM wallet_transactions WHERE source_type IN ('booking','schedule') AND source_id<>''"):
        if w["source_id"] not in ids and w["source_type"] == "booking":
            add("C6.ref", "warn", f"wallet {w['id'][:8]} source_id {w['source_id'][:8]} 唔存在於 bookings")
    for r in ledger_rows:
        if r["booking_id"] not in ids:
            add("C6.ref", "error", f"ledger 指向唔存在嘅 booking {r['booking_id'][:8]}")

    # ---- summary ----
    counts = {
        "bookings": q("SELECT COUNT(*) c FROM bookings")[0]["c"],
        "ledger": q("SELECT COUNT(*) c FROM ledger")[0]["c"],
        "wallet_transactions": q("SELECT COUNT(*) c FROM wallet_transactions")[0]["c"],
        "coach_earnings": q("SELECT COUNT(*) c FROM coach_earnings")[0]["c"],
        "coach_payouts": q("SELECT COUNT(*) c FROM coach_payouts")[0]["c"],
    }
    errors = [f for f in findings if f[1] == "error"]
    warns = [f for f in findings if f[1] == "warn"]
    HARD = {"C2.double_entry", "C4.wallet_math", "C4.wallet_chain", "C5.earning_math", "C5.eaming_paid", "C6.ref"}
    if integrity_only:
        # 只將「硬性」完整度錯誤當 block（借貸平衡/餘額鏈/算式/引用）；覆蓋率(C1/C3)降為 advisory
        errors = [f for f in findings if f[1] == "error" and f[0] in HARD]
        warns = [f for f in findings if f[1] == "error" and f[0] not in HARD] + [f for f in findings if f[1] == "warn"]

    if as_json:
        print(json.dumps({"counts": counts, "errors": errors, "warnings": warns}, ensure_ascii=False, indent=2))
        sys.exit(1 if errors else 0)

    print("=" * 60)
    print("🧾 ZenPass 對數報告 (Audit Reconciliation)")
    print("=" * 60)
    print("資料表筆數：", " · ".join(f"{k}={v}" for k, v in counts.items()))
    print("-" * 60)
    if not findings:
        print("✅ 全部核對通過，冇發現不一致。")
    else:
        print(f"❌ error={len(errors)}  ⚠️ warning={len(warns)}")
        for check, sev, msg in findings:
            icon = "❌" if sev == "error" else "⚠️"
            print(f"  {icon} [{check}] {msg}")
    print("=" * 60)
    sys.exit(1 if errors else 0)

if __name__ == "__main__":
    main()
