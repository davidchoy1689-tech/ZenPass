# 子女簽到報平安（Web Push）

## 流程
1. 子女（訪客或會員）完成預約 → 付款頁出現「🔔 開啟簽到通知」
2. 前端：`Notification.requestPermission()` → 用 `sw.js` 訂閱 `PushManager`（VAPID 公鑰由 `GET /api/push/vapid-public-key` 取得）
3. 訂閱寫入：
   - `push_subscriptions`（user_id + endpoint）
   - `bookings.push_subscription`（該用戶仍有效嘅 booking）
4. 導師喺 `coach-checkin.html` 撳簽到 → 後端：
   - 寫 `attended` + `checkin.sponsor_notified` audit
   - 背景 `sendPushNotification(booker_user_id, …)`（service `sponsor-notify.js`）
   - 成功 → audit `checkin.sponsor_push`
   - **冇訂閱／推送失敗 → 照舊回傳預填 `wa.me` 連結**（降級，人手發）
5. `sw.js` 收到 push → 手機鎖屏彈通知；點擊開 `/my-bookings.html`

## API
- `GET /api/push/vapid-public-key` → `{ success, key }`
- `POST /api/push/guest-subscribe` → `{ token, subscription }`（訪客 token，綁定 guest user）
- 會員用原有 `POST /api/notifications/push-subscribe`（JWT）

## 開關
- `SPONSOR_PUSH_ENABLED=0` → 停用 push，只用 wa.me
- 冇 `VAPID_PUBLIC_KEY`／`VAPID_PRIVATE_KEY` → `push.js` 自動 skip（回 wa.me）

## 注意
- iOS 需要 16.4+ 且「加入主畫面」後才支援 Web Push
- 訪客 token 有效期 30 日；過期後要重新開啟
- 一個用戶可有多部裝置訂閱；`push_subscriptions` 逐 endpoint 儲存
- `bookings.push_subscription` 只保留最新一個（方便追溯），實際發送用 `push_subscriptions`

## 測試
- `backend/tests/test-push-subscribe.js`（7）
- `test-sponsor-checkin.js`（14，含報平安 audit）
- `test-coach-checkin-link.js`（22）
