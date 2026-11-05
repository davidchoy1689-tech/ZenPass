# FPS Deep Link / QR ＋ 掃碼簽到

## 1. FPS 付款（booking.html 付款頁）
- 動態 **EMVCo／HKICL 版面 QR**：tag 26 `hk.com.hkicl` + FPS 90335538、tag 54 金額、tag 62/05 預約編號、tag 63 CRC16
- QR 由 `/api/qr?text=…` 產生（server-side，無 CDN）
- 一鍵複製：收款電話、金額；另顯示 PayMe／HSBC／中銀 deep link（只會開 App，唔保證預填）
- ⚠️ **上線前必須用真實銀行 App 掃一次**：EMVCo 欄位順序正確，但個別銀行對 merchant name／MCC 有要求；未經實掃唔好當「保證可掃」
- 收款戶口資料仍保留（HSBC 741-293856-838）

## 2. 入場 QR（學員／子女）
- 格式：`zenpass:checkin:{booking_id}:{hmac10}`（HMAC-SHA256，secret = CHECKIN_TOKEN_SECRET / JWT_SECRET）
- 產生：
  - 會員：`GET /api/bookings/:id/qr` → 新增 `qr_secure` 欄位
  - 訪客：`GET /api/guest/booking-qr?token=&booking_id=`
- 顯示：`/api/qr?size=420&text=…`
  - `my-bookings.html`：改用 `qr_secure`（大圖、可長按儲存）
  - `booking.html` 付款頁：訪客即時顯示 QR（id `qrCard`）
- 只含 booking id + 短簽名，唔含姓名／電話

## 3. 教練掃碼（coach-checkin.html）
- Header「📷 掃碼」→ 全螢幕鏡頭（`getUserMedia` environment）
- 解碼：`vendor/jsQR.js`（本地檔，無 CDN）
- 掃到合法 QR：
  1. `navigator.vibrate(100)`
  2. `POST /api/coach/checkin { token, qr, action:'checkin' }`
  3. 綠色橫幅顯示姓名 + 舊患提示
  4. 背景 Web Push／wa.me 報平安
  5. 1.5 秒後繼續掃下一位
- 離線：queue 支援 `{qr}`，上網自動補簽
- 舊有 4 位核銷碼／手動點擊仍然保留

## API 變更
- `GET /api/bookings/:id/qr` → 多回 `qr_secure`
- `GET /api/guest/booking-qr?token=&booking_id=`
- `POST /api/coach/checkin` 接受 `qr`（可代替 `booking_id`）
- `POST /api/push/guest-subscribe`（前一階段）

## 測試
- `backend/tests/test-qr-checkin.js`（10）：HMAC 格式、竄改、跨班、冪等
- 原有 coach 22、sponsor 14、push 7 全部保持綠

## 上線前
1. 用真手機（iOS Safari + Android Chrome）試鏡頭權限與掃碼
2. 用 HSBC／中銀／PayMe 各掃一次 FPS QR，確認金額與備註帶入
3. 長者 QR 大圖模式：建議日後加「自動調高螢幕亮度」
