#!/bin/bash
# trace.log 統計（最近 N 分鐘）→ 一行 JSON，供監控告警用
# 用法：bash trace-stats.sh [分鐘，預設 30]
set -u
MIN="${1:-30}"
LOG="${TRACE_LOG:-/var/www/zenpass/backend/logs/trace.log}"
[ -f "$LOG" ] || { echo '{"total":0,"e5xx":0,"guest_fail":0,"rate_limited":0,"last_ts":null,"error":"no_log"}'; exit 0; }

python3 - "$LOG" "$MIN" <<'PY'
import sys, json, datetime
path, minutes = sys.argv[1], int(sys.argv[2])
cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)
total = e5xx = guest_fail = rl = 0
last_ts = None
with open(path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        ts = d.get("ts")
        if not ts:
            continue
        try:
            t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            continue
        if t < cut:
            continue
        total += 1
        last_ts = ts
        st = int(d.get("status") or 0)
        if st >= 500:
            e5xx += 1
        if d.get("kind") == "guest_booking" and (st == 0 or st >= 400) and not d.get("rate_limited"):
            guest_fail += 1
        if d.get("rate_limited"):
            rl += 1
print(json.dumps({"total": total, "e5xx": e5xx, "guest_fail": guest_fail,
                  "rate_limited": rl, "last_ts": last_ts, "window_min": minutes}))
PY
