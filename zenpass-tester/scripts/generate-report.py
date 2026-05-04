#!/usr/bin/env python3
# ZenPass Test Report Generator
# Generates a comprehensive markdown report from test results

import json, subprocess, os, datetime

BASE_URL = os.environ.get("ZENPASS_URL", "http://localhost:3001")

def run(cmd):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return r.stdout.strip(), r.stderr.strip(), r.returncode
    except Exception as e:
        return "", str(e), -1

def get_token():
    import sys
    cmd = (
        'curl -s -X POST "' + BASE_URL + '/api/auth/login" '
        '-H "Content-Type: application/json" '
        '-d \'{"email":"admin@zenpass.hk","password":"admin123"}\' '
        "| python3 -c \"import sys,json; print(json.load(sys.stdin).get('token',''))\""
    )
    out, _, _ = run(cmd)
    return out.strip()

def api_get(endpoint, token):
    out, _, _ = run('curl -s "' + BASE_URL + endpoint + '" -H "Authorization: Bearer ' + token + '"')
    try:
        return json.loads(out)
    except:
        return {}

def generate_report():
    token = get_token()
    report = {
        "timestamp": datetime.datetime.now().isoformat(),
        "health": {},
        "stats": {},
        "integrity": {},
        "frontend": {}
    }
    
    if not token:
        return {"error": "Cannot get token", "server_up": False}
    report["server_up"] = True
    
    # Stats
    stats = api_get("/api/admin/stats", token)
    s = stats.get("stats", stats)
    report["stats"] = {
        "total_users": s.get("total_users", "?"),
        "total_classes": s.get("total_classes", "?"),
        "total_bookings": s.get("total_bookings", "?"),
        "confirmed_bookings": s.get("confirmed_bookings", "?"),
        "pending_payments": s.get("pending_payments", "?"),
        "total_revenue": s.get("total_revenue", "?")
    }
    
    # Users integrity
    users_data = api_get("/api/admin/users", token)
    users = users_data.get("users", [])
    user_issues = []
    for u in users:
        if not u.get("user_reference", "").startswith("US-"):
            user_issues.append("Bad ref: " + u.get('name'))
    report["integrity"]["users"] = {"total": len(users), "issues": user_issues}
    
    # Classes integrity
    classes_data = api_get("/api/admin/classes", token)
    classes = classes_data.get("classes", [])
    class_issues = []
    for c in classes:
        if not c.get("class_reference", "").startswith("CL-"):
            class_issues.append("Bad ref: " + c.get('title'))
        if not c.get("coach_reference", "").startswith("US-"):
            class_issues.append("Bad coach ref: " + c.get('title'))
    report["integrity"]["classes"] = {"total": len(classes), "issues": class_issues}
    
    # Bookings integrity
    bookings_data = api_get("/api/admin/bookings?limit=100", token)
    bookings = bookings_data.get("bookings", [])
    booking_issues = []
    for b in bookings:
        if not b.get("booking_reference", "").startswith("ZP-"):
            booking_issues.append("Bad ref: " + b.get('booking_reference'))
    report["integrity"]["bookings"] = {"total": bookings_data.get("total", len(bookings)), "issues": booking_issues}
    
    return report

def format_report(report):
    if report.get("error"):
        return "## ❌ 測試失敗\n\n**錯誤：** " + report['error'] + "\n"
    
    timestamp = report.get("timestamp", "")
    lines = [
        "# ZenPass 自動化測試報告",
        "**生成時間：** " + timestamp,
        "**伺服器狀態：** " + ('✅ 運行中' if report.get('server_up') else '❌ 離線'),
        "",
        "---",
        "## 📊 系統統計",
        "| 項目 | 數量 |",
        "|------|------|",
    ]
    
    labels = {
        "total_users": "用戶",
        "total_classes": "課程",
        "total_bookings": "總預約",
        "confirmed_bookings": "已確認",
        "pending_payments": "待付款",
        "total_revenue": "總收入"
    }
    for k, v in report.get("stats", {}).items():
        lines.append("| " + labels.get(k, k) + " | " + str(v) + " |")
    
    lines.extend(["", "---", "## ✅ 資料完整性"])
    
    section_labels = {"users": "用戶", "classes": "課程", "bookings": "預約"}
    for section, data in report.get("integrity", {}).items():
        issues = data.get("issues", [])
        status = "✅" if not issues else "❌"
        lines.append("")
        lines.append("### " + status + " " + section_labels.get(section, section.title()) + " (" + str(data.get('total', 0)) + " 項)")
        if issues:
            for i in issues:
                lines.append("- ⚠️ " + i)
        else:
            lines.append("無異常")
    
    return "\n".join(lines) + "\n"

if __name__ == "__main__":
    report = generate_report()
    output = format_report(report)
    print(output)
    
    # Save to file
    os.makedirs("test-reports", exist_ok=True)
    fname = "test-reports/report-" + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + ".md"
    with open(fname, "w") as f:
        f.write(output)
    print("\n報告已儲存至：" + fname)
