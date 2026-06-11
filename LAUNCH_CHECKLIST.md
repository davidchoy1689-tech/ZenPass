# 🚀 ZenPass 上架 Checklist

> 最後更新：2026-06-12 01:45 HKT

---

## ✅ 已處理

| Item | Status | Note |
|------|--------|------|
| enrolled_count sync | ✅ 已修復 | 排程器每6小時自動 sync |
| Unit test infrastructure | ✅ 建立 | vitest tests/unit/ 含 health/financial/security |
| GA4 追蹤碼 | ✅ | 已安裝 |
| 服務條款 / 私隱政策 | ✅ | terms.html + privacy.html |
| PWA manifest + Service Worker v5 | ✅ | 更新 caching strategy |
| CORS production domain | ✅ | +zenpass.hk, www.zenpass.hk |
| CSP security headers | ✅ | 啟用 proper CSP（之前完全 disable） |
| CI pipeline | ✅ | .github/workflows/ci.yml |
| 排程器更新 | ✅ | 加入 enrolled_count sync |
| Domain + HTTPS | ✅ | Let's Encrypt cert to Aug 22 2026 |
| 登入系統 | ✅ | login.html + JWT auth |
| Wallet 系統 | ✅ | wallet.html + transactions |

## ⏳ 未完成（等你決定）

| Priority | Item | 需要你俾 |
|:--------:|------|---------|
| 🔴 | Stripe Live Keys | Live 版 sk_xxx / pk_xxx |
| 🔴 | SMTP Email 設定 | Gmail App Password |
| 🟡 | Google OAuth Client ID | Google Cloud Console |
| 🟡 | Apple OAuth Client ID | Apple Developer |
| 🟢 | explore.html 6張圖 404 | 正確 image URL |
| 🟢 | WhatsApp notification | CallMeBot API key |
| 🔴 | VPS deploy sync | Git pull + pm2 restart（你/我 ssh） |
