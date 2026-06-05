# 🚀 ZenPass 上架 Checklist

> 最後更新：2026-06-06 03:38 HKT
> 每次 session 自動 load，落指令寫「check checklist」我會主動對一次

---

## ✅ 已完成

| Item | Detail | Commit / Note |
|------|--------|---------------|
| GA4 追蹤碼 | G-MKF5N4YLBM | `e03ee537` + `35b78628` — 50+ 頁面 + api.js |
| 服務條款 | terms.html | 690行，完整版 |
| 私隱政策 | privacy.html | 512行，完整版 |
| sitemap.xml | 存在 | — |
| robots.txt | 存在 | — |
| PWA manifest | manifest.json | 完整 branding |
| login.html（含註冊 Tab） | ✅ 完整 | Register + Login + Social login |
| wallet.html | ✅ 完整 | Credits tab + Wallet tab + transaction history |
| profile.html | ✅ Redirect → my.html | 2026-06-05 |
| signup.html | ✅ Redirect → login.html | 2026-06-05 |
| 前端測試 | frontend-audit.spec.js | 31 checks，每日 cron（暫時 disable）|
| backend 測試 | 全部通過 | enrolled_count + points + API integration |

## ⏳ 未完成（等你決定）

| Priority | Item | Status | 需要你 |
|:--------:|------|--------|--------|
| 🔴 | Stripe Live Keys | ❌ 用緊 test key | 俾 live key 我換 |
| 🔴 | Domain + HTTPS | ✅ zenpass.hk + Let's Encrypt | VPS 已 set，HTTP→HTTPS 301 |
| 🟡 | Google Search Console | GA4 已 set，可透過關聯 verified | 如需要再加 meta tag |
| 🟡 | Cookie consent banner | 香港法例未必需要 | 你決定 |
| 🟢 | explore.html broken images | ⚠️ 6張圖 404（舊問題） | 要俾正確 image URL |
| 🟢 | VPS deploy 流程確認 | 🟢 VPS up + Nginx OK | — |
| 🟢 | 正式 Email SMTP | ❌ 用緊 localhost mock | 俾 Gmail App Password |
| 🟢 | WhatsApp notification | ❌ 未 set up | 俾 CallMeBot key |
| 🟢 | Apple / Google OAuth | ❌ 要 client ID | 俾 OAuth credentials |
