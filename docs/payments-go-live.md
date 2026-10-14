# ZenPass 收款上線清單（Go-Live Payments）

> 現況（2026-10-15）：Stripe 使用 **TEST 模式**（`sk_test_…`）；FPS／PayMe 為**人手核實**（admin 付款核實）。以下為切換到「真實收款」步驟。

## 1. Stripe（信用卡）
- [ ] 將 VPS `backend/.env` 換成 **Live keys**：
  - `STRIPE_SECRET_KEY=sk_live_…`
  - `STRIPE_PUBLISHABLE_KEY=pk_live_…`
  - `STRIPE_WEBHOOK_SECRET=whsec_…`（Live webhook）
- [ ] Stripe Dashboard → Webhooks 新增 endpoint：
  `https://zenpass.hk/api/payments/stripe/webhook`
  訂閱事件：`checkout.session.completed`、`payment_intent.succeeded`
- [ ] `pm2 restart zenpass-api --update-env`
- [ ] 用 Live 卡 **真付一次小額** 驗證：付款 → 自動確認 booking + ledger 入帳
- 已接好：`POST /payments/stripe/create-checkout`（hosted Checkout，redirect 去 Stripe）、`/stripe/webhook`（簽名驗證）、`/stripe/confirm-payment`
- 付款後返回頁：`/my-bookings.html`（成功）／`/booking.html`（取消）

## 2. FPS 轉數快（人手）
- 收款：**9033 5538（HSBC，ZenPass）**
- 流程：用戶轉帳 → 輸入 FPS 參考號 → booking 轉 `pending_payment` → **admin「付款核實」確認** → booking 確認
- 自動化：FPS 無 merchant API（需經 PSP，如 Adyen / Stripe 不直接支援 FPS）→ 維持人手，或日後接 PSP

## 3. PayMe（人手）
- 收款：**9492 5828**
- 同上，人手核實

## 4. 其他
- `PUBLIC_BASE_URL=https://zenpass.hk`（email 連結用）
- nginx CSP 目前**未含** `js.stripe.com`：hosted Checkout（跳去 stripe.com）**不受影響**；若要用 Stripe Elements（本站內嵌卡表單）需加 CSP
- 退款：`processRefund` 已接（ledger 有退款分錄）

## ✅ 已具備
- 四邊拆賬 ledger、兩階段 hold、PaymentIntent、booking timeline、每日對帳（皆 v2.1）
- 付款核實（admin v2）、付款/出糧對帳
