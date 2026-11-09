# 教練免登入點名 PWA（feature/coach-pwa-checkin）

> ✅ 已合併（main 6202bf66）並部署。

## 為何需要
導師喺體育館單手操作，要 5 秒內點名；唔想裝 app、唔想記密碼；點名要即時反映後台，子女要收到報平安。

## Token 設計
```
token = base64url(`${schedule_id}.${coach_id}.${expires_at}`) + "." + base64url(HMAC-SHA256(payload, SECRET))
```
- Secret：`CHECKIN_TOKEN_SECRET`（未設 fallback `JWT_SECRET`）
- `expires_at`：課堂結束 + 3 小時（Unix 秒）
- 有效窗口：開課前 2 小時 → 課後 3 小時（route 再檢查 schedule 時間，唔止靠 exp）
- Scope：token 只對該 `schedule_id` 有效；帶其他班 booking_id → 404
- 竄改／過期／假簽名 → 403；同一 IP 5 次失敗鎖 15 分鐘

## API
### `GET /api/coach/checkin/roster?token=`
回傳：
- `schedule`: 標題、場地、地址、時間、導師、`total_enrolled`、`attended_count`
- `roster[]`: `booking_id`（群組第一筆）、`booking_ids`、`seats`、`attendee_name`（父母優先）、`is_parent`、`sponsor_name`、`phone_masked`（前 4 + ****）、`phone_tel`、`emergency_*`、`health_notes`、`status`
- 同一 user 同一班（2 人同行）合併為一張卡，一次點名全部座位

### `POST /api/coach/checkin`
```json
{ "token": "...", "booking_id": "bk_001", "action": "checkin" }
```
- `checkin`：只限 `confirmed` + `paid`；更新 `status=attended`、`checked_in_at`、`checkin_method=coach_link`；寫 audit `booking.checked_in`
- 重複點擊：已 attended 的座位跳過，唔會重複通知
- 代報名 + `notify_sponsor_on_checkin=1`：回傳 `sponsor.wa_url`（付款人電話，預填報平安文案），audit `checkin.sponsor_notified` 只寫一次
- `no_show`：標記 `no_show`，寫 audit `booking.no_show`
- 回應：`attended_count`、`total_enrolled`、`sponsor_notified`、`sponsor`

## 前端 `coach-checkin.html`
- Mobile-first、大字（姓名 22px）、高對比、52px 按鈕
- Header：場地／時間、進度條「已到 X / Y」、一鍵致電支援 9033 5538
- 卡：姓名、`👵 子女代報 (付款人)`、`👥 2 人同行`、健康警示紅框、電話脫敏（點擊 `tel:`）
- 樂觀更新 + `navigator.vibrate`
- 離線：`localStorage` 隊列，`online` 事件自動重送；4xx 永久失敗會移除，避免卡死
- PWA：`manifest-coach.json` + `coach-checkin-sw.js`（快取外殼，API 一律走網絡）
- 先用 localStorage 快取名冊即時顯示，再拉最新

## 產生連結
```bash
cd backend
export JWT_SECRET=...        # 或 CHECKIN_TOKEN_SECRET
DB_PATH=./data/zenpass.db node scripts/coach-checkin-link.js \
  --schedule b54b7038-caa2-429e-b7a3-965abb35901a
# stdout: https://zenpass.hk/coach-checkin.html?t=...
# stderr: WhatsApp 文案
```
建議課前 30 分鐘由 cron／scheduler 發送（未接，等 P1 WhatsApp API）。

## 測試
```
node tests/test-coach-checkin-link.js   # 22 ✅
```
覆蓋：名冊脫敏／代報／同行合併、簽到、冪等、報平安只一次、缺席、跨班拒絕、假／過期／竄改 token、scope 隔離。

## UI 實測（390×844，真實 API + 快照 DB）
- 名冊：`陳伯伯 | 👵 子女代報 (陳小姐) | ⚠️ 右膝微創手術，避免深蹲 | 9876 ****`
- 點簽到 → `已到 1 / 1 人`、toast、DB `attended/coach_link`、兩條 audit

## 上線前（首發後）
1. Code review：token scope、rate limit（in-memory，PM2 單 process 可行，多 process 要搬 Redis）
2. `CHECKIN_TOKEN_SECRET` 獨立於 JWT_SECRET
3. 真實教練試用（靜儀導師）＋ iPhone Safari PWA 加主畫面
4. 接 P1：簽到後直接由 Cloud API 發報平安，唔再彈 wa.me
5. 離線隊列加 IndexedDB（大量／長時間離線）
