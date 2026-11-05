# P1 + P2 開發計劃（feature/p1-p2-automation）

> ⚠️ 此分支**唔會 merge、唔會部署**，等 11/09 首發完結後再評審。
> 生產 `main` 與 VPS 完全未受影響。

## P1：WhatsApp Cloud API

### 環境變數（未設定時所有功能自動 no-op）
```
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=v21.0          # 選填
WHATSAPP_ERROR_LOG=/var/log/zenpass/whatsapp-error.log
```

### 元件
| 檔案 | 作用 |
|---|---|
| `src/services/whatsapp-cloud.js` | `sendTextMessage` / `sendTemplateMessage` / `sendInteractiveButtons`；429/5xx/網絡錯誤 exponential backoff（3 次）；失敗寫 log |
| `src/routes/whatsapp-webhook.js` | `GET /api/webhook/whatsapp`（hub.challenge）；`POST`（raw body + `X-Hub-Signature-256` 驗簽） |
| `src/index.js` | webhook 掛載喺 `express.json()` **之前**，確保拿到 raw body |

### 行為
- 文字含「交通／地點／地址」→ 回 `/traffic` 內容
- 含「關節／膝頭／腰／痛」→ 回 `/health` 內容
- 含「報名／幾錢」→ 回報名連結
- 圖片 → 找該電話最新 `pending_payment`/`confirmed` booking：
  - `receipt_image = wa:<media_id>`、`receipt_media_id`、`fps_receipt_received=1`、`payment_reported_at`
  - 寫 `audit_log: payment.receipt_received`
  - 回覆「已轉交客服核實」
- 同一 `message.id` 只處理一次（`audit_log` 去重）
- 冇設定 env → `503 WHATSAPP_NOT_CONFIGURED`，唔會 throw

### 未做（要等正式帳號）
- Template 審批、24 小時客服窗口以外的 template 參數
- 媒體下載（media id → 實際圖）與後台縮圖
- 自動回覆與人工客服的交接（human takeover）

## P2：拼團引擎

### Migration
`migrations/20261109_add_pooling_engine.sql`
- `class_schedules`: `min_threshold` (4)、`pooling_deadline`、`pooling_status`、`preauth_status`
- `bookings`: `fps_receipt_received`、`receipt_media_id`
（SQLite 冇 `ADD COLUMN IF NOT EXISTS`，runner 要忽略 duplicate column）

### 狀態機
```
none → pooling → succeeded | failed
```
- `startPooling(db, scheduleId, {minThreshold, deadline})`
- `processPooling(db, {now, notify})`：
  - `people >= threshold` → `succeeded`；`pending_payment` bookings → `confirmed`；audit `pooling.succeeded`
  - 過 `pooling_deadline` 仍未夠 → `failed`；bookings `cancelled`（`cancel_reason=pooling_failed`）；`enrolled_count=0`；audit `pooling.failed`
  - 通知失敗唔會 rollback 狀態（會 log）
- Scheduler：`POOLING_ENABLED=1` 才每 15 分鐘跑（預設關）

### 未做（要支付網關）
- Pre-auth `authorized → captured / released`（Stripe / Adyen）
- 退款／改期券自動發放
- 前端正式列表頁（今次只有 mock）

## 測試
```
cd backend
node tests/test-whatsapp-cloud-mock.js   # 17 ✅
node tests/test-pooling-engine.js        # 18 ✅
```
全部用 in-memory DB / mock fetch，**冇網絡、冇生產 DB**。

## Mock UI
`frontend-v2/dev/pooling-mock.html?have=3&need=4`（只係靜態示範進度條，冇接 API）

## 上線前檢查（首發後）
1. Meta App 審批 + 號碼驗證
2. 用 test number 跑一輪 webhook 驗簽
3. Migration 喺 staging DB 跑（先 backup）
4. `POOLING_ENABLED` 預設關 → 灰度開一個場地
5. Code review：`whatsapp-webhook.js` raw body 掛載次序、`pooling` 名額與 refund 流程
