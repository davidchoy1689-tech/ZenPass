# 🚀 ZenPass 上架 Checklist

> 最後更新：2026-10-15 23:55 HKT

---

## ✅ 已完成（核心系統）

| Area | Status | Note |
|------|--------|------|
| 前台 v2 | ✅ | explore / class-detail / booking / membership / my / my-bookings / checkin …（frontend-v2，39 頁）|
| 後台 v2 admin | ✅ | 20 個 tab（付款/預約/用戶/教練申請/出糧/報表/企業/商戶/定價/罰則/分析/NPS/優惠/推廣/審計…）|
| 財務核心 | ✅ | 四邊拆賬、ledger double-entry、audit_log；**12 個金融表 DELETE trigger（永久保存）** |
| 付款 | ✅ | Stripe **TEST** 模式 + FPS/PayMe 人手審批 + 15 分鐘 hold 位 |
| 會員/點數 | ✅ | Credits、top-up、Loyalty tier、dynamic pricing、NPS、referral、WELCOME50 |
| 保安 | ✅ | CSRF、JWT(HTTP-only cookie)、rate limit、CSP；已移除 v1 admin backdoor、封 /v1/ |
| CI/CD | ✅ | GitHub Actions → VPS、PM2、Nginx、HTTPS（Let's Encrypt）|
| 排程 | ✅ | no-show / health / supabase（gateway AI）+ VPS 純 shell 後備；每日 backup + 每日對帳 + 每週對數 |
| 備份 | ✅ | 每日 DB backup；**已做還原測試（integrity ok）** |

## 🛡️ 2026-10-15 保安 / 維運（今日完成）

- ✅ 移除 v1 admin `auto-login` 後門（`/v1/admin.html` 曾可任意人登入做 admin）
- ✅ 改 `admin` 密碼（`admin123` → 已換成強密碼）
- ✅ 封 `/v1/` 舊站（410）
- ✅ 修 404 頁 + 33 個舊 URL redirect + `sitemap.xml` / `robots.txt`
- ✅ 申請表（教練/場地）唔再預填帳戶資料
- ✅ 備份還原測試（開得起、71 表、integrity ok）
- ✅ 成本：VPS 純 shell 監控（零 token）

## ⏳ 等你出手（開業阻塞）

| 優先 | 項目 | 需要你俾 |
|:----:|------|---------|
| 🔴 | **Stripe LIVE keys** | `sk_live` / `pk_live` / `whsec_live`（test 已就緒）|
| 🔴 | **舊 GitHub token 輪換** | GitHub 權限（舊 token 曾記錄喺 memory）|
| 🟠 | WhatsApp 通知 | CallMeBot API key |
| 🟠 | **異地備份** | 目的地（S3 / Google Drive / 另一台）|
| 🟠 | 外部 uptime 監控 | UptimeRobot 帳號（VPS 掛機時先收得到警報）|
| 🟡 | fallback 模型 | 另一間 provider API key（DeepSeek 卡都唔怕）|
| 🟢 | SMTP（Gmail 421）| 新 App Password |
| 🟢 | Google / Apple OAuth | Console client id（可選）|

## 🔜 我可以自主做（唔使等）

- API / 架構 / deployment 文檔齊全（IPO 級）
- 核心財務流程測試覆蓋檢視
- 異地備份：可用 GitHub 私有 repo + 加密備份（如果你想用現有 access）
