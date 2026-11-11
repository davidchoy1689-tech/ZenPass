# Stripe Live Key 切換手冊（Phase 2.1-PROD）

## 一、切換前（Test 模式確認）
```bash
cd /var/www/zenpass/backend
node -e "require('dotenv').config({path:'../.env'});const s=require('./src/services/stripe');console.log(s.publicConfig())"
# 預期：mode=test, is_production_mode=false, payments_ready=true(如有 test key)
curl -s http://localhost:3001/api/public/config
```

## 二、設定 Live Key（VPS `.env`，切勿 commit）
```env
STRIPE_MODE=live
STRIPE_LIVE_PK=pk_live_...
STRIPE_LIVE_SK=sk_live_...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_live_...
```
保留 test key 以便回滾：
```env
STRIPE_TEST_PK=pk_test_...
STRIPE_TEST_SK=sk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_test_...
```

## 三、Stripe Dashboard Webhook
- Endpoint：`https://zenpass.hk/api/webhooks/stripe`（canonical）
  - 舊路徑 `/api/payments/stripe/webhook` 仍然有效。
- 事件：`payment_intent.succeeded`、`checkout.session.completed`
- 複製 signing secret（`whsec_live_...`）到 `STRIPE_LIVE_WEBHOOK_SECRET`

## 四、切換
```bash
cd /var/www/zenpass
cp .env .env.bak-live-$(date +%Y%m%d-%H%M%S)
# 編輯 .env 設 STRIPE_MODE=live + 三個 LIVE 變數
pm2 reload zenpass-api
sleep 3
curl -s http://localhost:3001/api/public/config   # 應回 pk_live + is_production_mode true
pm2 logs zenpass-api --lines 30 | grep STRIPE      # 應見 WARNING: RUNNING IN LIVE REAL-MONEY MODE
```

## 五、真錢首單驗證（HK$1 測試建議）
1. 用管理員帳號建立一張 HK$1 測試商品或用 4 堂 Pass（HK$520）小額真付。
2. Stripe Dashboard → Payments 見 succeeded。
3. 檢查：
```bash
sqlite3 -header -column backend/data/zenpass.db "
SELECT payment_intent_id,status,retry_count,created_at FROM payment_fulfillments_queue ORDER BY created_at DESC LIMIT 5;
SELECT id,payment_intent_id,total_credits,remaining_credits FROM user_passes ORDER BY created_at DESC LIMIT 3;"
```
4. 若 queue 有 pending → `POST /api/internal/cron/reconcile-payments`（本機 curl）或等 15 分鐘。

## 六、警報
- 補償失敗達 5 次 → `failed_manual_review`，reconcile 會嘗試發 Telegram（需 `TELEGRAM_BOT_TOKEN`／chat id）。
- 管理台：`GET /api/admin/fulfillments?status=failed_manual_review`，逐筆 `POST /api/admin/fulfillments/:id/retry`。

## 七、回滾（30 秒）
```bash
# .env 改回 STRIPE_MODE=test
pm2 reload zenpass-api
curl -s http://localhost:3001/api/public/config   # pk_test / false
```
只影響新交易；已完成的 live 交易與 Pass 不受影響。

## 八、已知邊界
- 前端 `pass.html` 使用 hosted Checkout；`/api/public/config` 的 PK 供未來 Elements／Apple Pay 直接整合，現時只作模式顯示與防硬編碼。
- Webhook 必須經 Stripe 真實簽名；本機測試要用 `stripe listen` 或 Dashboard 重送。
- `pm2 reload` 後舊 worker 仍可能持有舊 key 數秒；正式切換建議在低流量時段。
