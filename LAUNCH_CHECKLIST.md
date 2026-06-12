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

## ✅ 已處理（更新 @ 2026-06-12）

| Item | Status | Note |
|------|--------|------|
| SMTP Email | ✅ 已設定（需檢查 Gmail App Password） | info.zenpass@gmail.com — 但 Gmail SMTP 暫時 reject
| Stripe Test Keys | ✅ 已設定 | sk_test_* 已在 .env
| VPS deploy sync | ✅ GitHub Actions auto-deploy
| VPS 系統監控 | ✅ 新裝 — PM2 restart / disk / error log 自動 alert | 每 5 分鐘，email alert
| gh-pages 同步 | ✅ 已更新到最新 frontend
| gitignore + cleanup | ✅ test-results 唔再 tracking

## ⏳ 未完成（等你決定）

| Priority | Item | 需要你俾 |
|:--------:|------|---------|
| 🟡 | Stripe Live Keys | Live 版 sk_xxx / pk_xxx（test 已就緒）|
| 🔴 | SMTP Email — Gmail 421 錯誤 | Gmail App Password 可能過期，要 regenerate |
| 🟡 | Google OAuth Client ID | Google Cloud Console |
| 🟡 | Apple OAuth Client ID | Apple Developer |
| 🟢 | explore.html 6張圖 404 | 正確 image URL |
| 🟢 | WhatsApp notification | CallMeBot API key |
| 🟢 | Telegram Bot Token | 用嚟收 system alert（而家靠 email alert） |
