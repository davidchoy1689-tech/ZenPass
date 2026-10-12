#!/usr/bin/env python3
"""
ZenPass Audit Reconciliation Report
-----------------------------------
Cross-checks the internal financial tables for consistency (IPO-audit oriented):
  C1  Booking four-way split:  platform + venue == amount
  C2  Ledger double-entry:     per reference, sum(debit) == sum(credit)
  C3  Ledger coverage:         every paid/confirmed booking has ledger entries
  C4  Wallet chain:            per user, balance_before == prev balance_after; amount matches delta
  C5  Coach earnings:          gross*commission == net ; paid earnings have payout_id
  C6  Referential integrity:   wallet_tx.source_id / ledger.booking_id exist in bookings

Usage: python3 reconcile-audit.py <path-to-sqlite.db> [--json] [--integrity-only]
Exit code 0 = clean (or advisory-only in --integrity-only), 1 = hard discrepancies.
"""
import sqlite3, sys, json
from collections import defaultdict

TOL = 0.01
# 硬性完整性檢查（--integrity-only 模式下只有呢啲會 block）
HARD = {"C2.double_entry", "C4.wallet_math", "C4.wallet_chain",
        "C5.earning_math", "C5.eaming_paid", "C6.ref"}

# Double-entry ledger 上線日期（commit f0516e24）。
# 呢日之前建立嘅 booking 冇 ledger 屬已知歷史情況（多為測試/seed），
# 只列為 advisory；呢日或之後嘅 booking 冇 ledger 才 block。
LEDGER_GO_LIVE = "2026-10-12"


def close(a, b):
    return abs((a or 0) - (b or 0)) <= TOL


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("usage: reconcile-audit.py <db> [--json] [--integrity-only]")
        sys.exit(2)
    db_path = args[0]
    as_json = "--json" in sys.argv
    integrity_only = "--integrity-only" in sys.argv

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    q = lambda s, *a: db.execute(s, a).fetchall()

    def has_table(t):
        try:
            return db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)
            ).fetchone() is not None
        except Exception:
            return False

    def colset(t):
        try:
            return {r[1] for r in db.execute(f"PRAGMA table_info({t})")}
        except Exception:
            return set()

    findings = []
    def add(check, sev, msg):
        findings.append((check, sev, msg))

    # ---- C1: four-way split ----
    if not has_table("bookings"):
        add("C1.schema", "warn", "bookings 表不存在（略過）")
    else:
        bc = colset("bookings")
        need = {"amount", "platform_earned_amount", "venue_earned_amount"}
        if not need <= bc:
            add("C1.schema", "warn", f"bookings schema drift：缺少欄位 {sorted(need - bc)}（略過拆賬核對）")
        else:
            has_rate = "platform_commission_rate" in bc
            rate_sel = ",platform_commission_rate" if has_rate else ""
            for b in q(f"SELECT id,amount,platform_earned_amount,venue_earned_amount{rate_sel} FROM bookings WHERE amount IS NOT NULL AND amount>0"):
                amt = b["amount"]; rate = b["platform_commission_rate"] if has_rate else None
                plat = b["platform_earned_amount"]; venue = b["venue_earned_amount"]
                ssum = (plat or 0) + (venue or 0)
                if (plat or 0) == 0 and (venue or 0) == 0:
                    add("C1.split", "warn", f"booking {b['id'][:8]} amount={amt} 但平台/場地拆賬都係 0（未計拆賬）")
                elif not close(ssum, amt):
                    add("C1.split", "error", f"booking {b['id'][:8]} amount={amt} ≠ 平台{plat}+場地{venue}={round(ssum,2)}")
                if rate is not None and (plat or 0) > 0 and not close(plat, amt * rate):
                    add("C1.rate", "warn", f"booking {b['id'][:8]} 平台{plat} ≠ amount*rate({round(amt*rate,2)})")

    # ---- C2 + C3: ledger ----
    if not has_table("ledger"):
        add("C2.schema", "warn", "ledger 表不存在（略過）")
    else:
        ledger_rows = q("SELECT booking_id, reference, debit, credit FROM ledger")
        by_ref = defaultdict(lambda: [0.0, 0.0])
        by_booking = defaultdict(int)
        for r in ledger_rows:
            by_ref[r["reference"]][0] += r["debit"] or 0
            by_ref[r["reference"]][1] += r["credit"] or 0
            by_booking[r["booking_id"]] += 1
        for ref, (d, c) in by_ref.items():
            if not close(d, c):
                add("C2.double_entry", "error", f"ledger reference {str(ref)[:12]} 借貸不平：debit={round(d,2)} credit={round(c,2)}")
        if has_table("bookings"):
            for b in q("SELECT id,amount,created_at FROM bookings WHERE payment_status='paid' AND status IN ('confirmed','attended','no_show')"):
                if by_booking.get(b["id"], 0) == 0:
                    created = (b["created_at"] or "")[:10]
                    if created and created < LEDGER_GO_LIVE:
                        add("C3.coverage_legacy", "warn", f"已付款 booking {b['id'][:8]} (amount={b['amount']}, {created}) 冇 ledger（ledger 上線前歷史 booking，已知非生產數據）")
                    else:
                        add("C3.coverage", "error", f"已付款 booking {b['id'][:8]} (amount={b['amount']}) 冇 ledger 記錄（double-entry 缺失）")

    # ---- C4: wallet chain ----
    if not has_table("wallet_transactions"):
        add("C4.schema", "warn", "wallet_transactions 表不存在（略過）")
    else:
        prev = {}
        for w in q("SELECT user_id,amount,balance_before,balance_after,created_at,id FROM wallet_transactions ORDER BY user_id,created_at,id"):
            u = w["user_id"]; bb = w["balance_before"]; ba = w["balance_after"]; amt = w["amount"]
            if not (close(ba, bb + amt) or close(ba, bb - amt)):
                add("C4.wallet_math", "error", f"wallet {w['id'][:8]} user {str(u)[:8]} 餘額跳動異常：{bb} → {ba} (amount {amt})")
            if u in prev and not close(bb, prev[u]):
                add("C4.wallet_chain", "warn", f"wallet user {str(u)[:8]} 餘額斷鏈：前次 after={prev[u]} 但 before={bb}")
            prev[u] = ba

    # ---- C5: coach earnings ----
    if has_table("coach_earnings"):
        for e in q("SELECT id,coach_id,gross_amount,commission_rate,net_amount,status,payout_id FROM coach_earnings"):
            exp = (e["gross_amount"] or 0) * (e["commission_rate"] or 0)
            if not close(exp, e["net_amount"] or 0):
                add("C5.earning_math", "error", f"coach_earning {e['id'][:8]} gross*rate={round(exp,2)} ≠ net={e['net_amount']}")
            if e["status"] == "paid" and not e["payout_id"]:
                add("C5.eaming_paid", "error", f"coach_earning {e['id'][:8]} status=paid 但冇 payout_id")
    else:
        add("C5.schema", "warn", "coach_earnings 表不存在（略過）")

    # ---- C6: referential ----
    if has_table("bookings") and has_table("ledger"):
        ids = {r["id"] for r in q("SELECT id FROM bookings")}
        for r in q("SELECT booking_id FROM ledger"):
            if r["booking_id"] not in ids:
                add("C6.ref", "error", f"ledger 指向唔存在嘅 booking {str(r['booking_id'])[:8]}")
    if has_table("bookings") and has_table("wallet_transactions"):
        ids = {r["id"] for r in q("SELECT id FROM bookings")}
        for w in q("SELECT id,source_type,source_id FROM wallet_transactions WHERE source_type='booking' AND source_id<>''"):
            if w["source_id"] not in ids:
                add("C6.ref", "warn", f"wallet {w['id'][:8]} source_id {str(w['source_id'])[:8]} 唔存在於 bookings")

    # ---- summary ----
    counts = {}
    for t in ["bookings", "ledger", "wallet_transactions", "coach_earnings", "coach_payouts"]:
        counts[t] = q(f"SELECT COUNT(*) c FROM {t}")[0]["c"] if has_table(t) else "n/a"

    if integrity_only:
        errors = [f for f in findings if f[1] == "error" and f[0] in HARD]
        warns = [f for f in findings if (f[1] == "error" and f[0] not in HARD) or f[1] == "warn"]
    else:
        errors = [f for f in findings if f[1] == "error"]
        warns = [f for f in findings if f[1] == "warn"]

    if as_json:
        print(json.dumps({"counts": counts, "errors": errors, "warnings": warns}, ensure_ascii=False, indent=2))
        sys.exit(1 if errors else 0)

    print("=" * 60)
    print("🧾 ZenPass 對數報告 (Audit Reconciliation)" + ("  [integrity-only]" if integrity_only else ""))
    print("=" * 60)
    print("資料表筆數：", " · ".join(f"{k}={v}" for k, v in counts.items()))
    print("-" * 60)
    if not findings:
        print("✅ 全部核對通過，冇發現不一致。")
    else:
        print(f"❌ block={len(errors)}  ⚠️ advisory={len(warns)}")
        for check, sev, msg in findings:
            block = (sev == "error" and (not integrity_only or check in HARD))
            print(f"  {'❌' if block else '⚠️'} [{check}] {msg}")
    print("=" * 60)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
