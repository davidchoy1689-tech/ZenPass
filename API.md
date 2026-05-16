# ZenPass 禪流 API 文件

**Base URL:** `http://localhost:3001/api`（生產環境請替換為實際域名）

## 📖 目錄

- [認證說明](#-認證說明)
- [回應格式](#-回應格式)
- [🏥 Health](#-health)
- [🔐 Auth 認證](#-auth-認證)
- [👤 Users 用戶](#-users-用戶)
- [📚 Classes 課程](#-classes-課程)
- [📅 Bookings 預約](#-bookings-預約)
- [🧑‍🏫 Coach 教練](#-coach-教練)
- [💰 Coach Earnings 教練收入](#-coach-earnings-教練收入)
- [👑 Admin 管理員](#-admin-管理員)
- [🎯 Points 積分](#-points-積分)
- [🏅 Badges 勳章](#-badges-勳章)
- [🔔 Notifications 通知](#-notifications-通知)
- [⏳ Waitlist 候補名單](#-waitlist-候補名單)
- [💳 Memberships 會籍](#-memberships-會籍)
- [🔗 Referral 推薦計劃](#-referral-推薦計劃)
- [📋 CRM 客戶管理](#-crm-客戶管理)
- [💳 Payments 付款](#-payments-付款)

---

## 🔑 認證說明

所有需要認證的請求必須在 Header 攜帶 JWT token：

```
Authorization: Bearer <token>
```

### Auth 層級說明

| 層級 | Middleware | 說明 |
|------|-----------|------|
| `無` | 不需要 token | 公開 API，任何人可存取 |
| `optionalAuth` | 可選 token | 未登入仍可存取，登入後會附帶用戶資訊 |
| `authenticateToken` | 必須 token | 需要有效 JWT token |
| `requireCoach` | token + 教練身份 | 必須是已驗證的教練 |
| `requireAdmin` | token + 管理員身份 | 必須是管理員（role = admin） |

---

## 📦 回應格式

### 成功回應

```json
{
  "success": true,
  "data": { ... },
  "meta": { "pagination": { ... } }
}
```

### 錯誤回應

```json
{
  "success": false,
  "error": "錯誤訊息",
  "details": { ... }
}
```

### 舊格式（部分 endpoint 向後兼容）

```json
{
  "classes": [...],
  "pagination": { ... }
}
```

---

## 🏥 Health

### `GET /api/health` — 健康檢查

- **Auth:** 無

**成功回應 (200):**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "name": "ZenPass 禪流 API",
    "time": "2026-05-16T12:00:00.000Z",
    "uptime": 3600,
    "uptime_human": "1h 0m 0s",
    "database": {
      "connected": true,
      "tables": 27,
      "bookings": 27,
      "users": 17
    },
    "memory": {
      "free": "263 MB",
      "total": "8192 MB",
      "usage": "14.7 MB"
    },
    "platform": {
      "node": "v22.16.0",
      "arch": "x64",
      "hostname": "server-hostname"
    }
  }
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/health
```

---

## 🔐 Auth 認證

### `POST /api/auth/register` — 註冊新用戶

- **Auth:** 無

**Request Body:**
```json
{
  "name": "陳大文",
  "email": "user@example.com",
  "password": "password123",
  "phone": "+85212345678"
}
```

**成功回應 (201):**
```json
{
  "message": "註冊成功",
  "token": "eyJhbGciOi...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "陳大文",
    "phone": "+85212345678",
    "credits": 0,
    "membership_type": null,
    "created_at": "2026-05-16T12:00:00.000Z"
  }
}
```

**錯誤回應:**
| 狀態碼 | 訊息 |
|--------|------|
| 400 | 請填寫姓名、電郵和密碼 |
| 400 | 密碼至少需要 6 個字元 |
| 400 | 電郵格式不正確 |
| 409 | 此電郵已經註冊 |

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"陳大文","email":"user@example.com","password":"password123"}'
```

---

### `POST /api/auth/login` — 登入

- **Auth:** 無

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**成功回應 (200):**
```json
{
  "message": "登入成功",
  "token": "eyJhbGciOi...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "陳大文",
    "phone": "+85212345678",
    "credits": 0,
    "membership_type": null,
    "is_coach": 0,
    "role": "user"
  }
}
```

**錯誤回應:**
| 狀態碼 | 訊息 |
|--------|------|
| 400 | 請輸入電郵和密碼 |
| 401 | 電郵或密碼不正確 |
| 401 | 此帳戶使用 Apple/Google 登入，請使用該方式登入 |

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

---

### `POST /api/auth/social` — Apple / Google 第三方登入

- **Auth:** 無

**Request Body:**
```json
{
  "provider": "google",
  "providerId": "google-uid-xxxxx",
  "email": "user@gmail.com",
  "name": "陳大文"
}
```

`provider` 可選值：`"apple"` | `"google"`

**成功回應 (200):** 同 login response

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/auth/social \
  -H "Content-Type: application/json" \
  -d '{"provider":"google","providerId":"google-uid-123","email":"user@gmail.com","name":"陳大文"}'
```

---

### `GET /api/auth/me` — 當前用戶資訊

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "陳大文",
      "phone": "+85212345678",
      "credits": 50,
      "membership_type": "standard"
    }
  }
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <token>"
```

---

## 👤 Users 用戶

### `GET /api/users/me` — 當前用戶完整資料

- **Auth:** `authenticateToken`
- **備注:** 別名指向 `/api/users/profile`，回傳更詳細的用戶資料

**成功回應 (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "陳大文",
    "phone": "+85212345678",
    "avatar_url": null,
    "credits": 50,
    "membership_type": "standard",
    "membership_expires_at": "2026-06-16T12:00:00.000Z",
    "is_coach": 0,
    "coach_verified": 0,
    "role": "user",
    "user_reference": "US-20260516-ABCD",
    "points": 150,
    "points_tier": "bronze",
    "checkin_streak": 3,
    "total_visits": 5,
    "total_spent": 1500
  }
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/users/me \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/users/profile` — 個人資料（含最近預約）

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "陳大文",
    "points": 150,
    "points_tier": "bronze",
    "checkin_streak": 3
  },
  "bookings": [
    {
      "id": "booking-uuid",
      "title": "瑜伽入門",
      "category": "瑜伽",
      "duration": 60,
      "start_time": "2026-05-17T10:00:00.000Z",
      "end_time": "2026-05-17T11:00:00.000Z",
      "status": "confirmed"
    }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/users/profile \
  -H "Authorization: Bearer <token>"
```

---

### `PUT /api/users/profile` — 更新個人資料

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "name": "陳大文",
  "phone": "+85298765432",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

**成功回應 (200):**
```json
{
  "message": "資料已更新"
}
```

**curl 例子:**
```bash
curl -X PUT http://localhost:3001/api/users/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"陳大文","phone":"+85298765432"}'
```

---

### `GET /api/users/credits` — 查詢 Credits / 點數記錄

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "credits": 50,
  "membership_type": "standard",
  "transactions": [
    {
      "id": "tx-uuid",
      "type": "credits_topup",
      "amount": 1000,
      "description": "購買 50 Credits",
      "created_at": "2026-05-16T12:00:00.000Z"
    }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/users/credits \
  -H "Authorization: Bearer <token>"
```

---

## 📚 Classes 課程

### `GET /api/classes` — 課程列表

- **Auth:** `optionalAuth`
- **Cache:** 30 秒

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `category` | string | 分類篩選（如 "瑜伽"、"TRX"） |
| `difficulty` | string | 難度 |
| `coach_id` | string | 教練 ID |
| `search` | string | 關鍵字搜尋（標題、描述） |
| `date` | string | 日期篩選 (YYYY-MM-DD) |
| `price_min` | int | 最低價格 |
| `price_max` | int | 最高價格 |
| `page` | int | 頁碼（預設 1） |
| `limit` | int | 每頁數量（預設 20） |
| `sort` | string | 排序：`popular` / `price_asc` / `price_desc` |

**成功回應 (200):**
```json
{
  "classes": [
    {
      "id": "class-uuid",
      "title": "瑜伽入門",
      "title_en": "Yoga Beginner",
      "category": "瑜伽",
      "difficulty": "初級",
      "price_hkd": 250,
      "credits_cost": 2,
      "duration": 60,
      "coach_name": "李教練",
      "booking_count": 15,
      "rating": 4.5,
      "upcoming_sessions": 3,
      "schedules": [
        {
          "id": "schedule-uuid",
          "start_time": "2026-05-17T10:00:00.000Z",
          "end_time": "2026-05-17T11:00:00.000Z",
          "enrolled_count": 5,
          "max_participants": 10,
          "status": "available"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50
  }
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/classes?category=瑜伽&page=1&limit=5"
```

---

### `GET /api/classes/:id` — 課程詳情

- **Auth:** `optionalAuth`

**成功回應 (200):**
```json
{
  "class": {
    "id": "class-uuid",
    "title": "瑜伽入門",
    "title_en": "Yoga Beginner",
    "category": "瑜伽",
    "difficulty": "初級",
    "description": "適合初學者的瑜伽課程",
    "price_hkd": 250,
    "credits_cost": 2,
    "duration": 60,
    "max_participants": 10,
    "venue_name": "中環瑜伽中心",
    "venue_address": "中環德輔道中 100 號",
    "coach_name": "李教練",
    "coach_bio": "10年瑜伽教學經驗",
    "schedules": [...],
    "reviews": [...]
  }
}
```

**錯誤回應:** 404 - 課程不存在

**curl 例子:**
```bash
curl http://localhost:3001/api/classes/<class-id>
```

---

### `GET /api/classes/categories` — 分類列表

- **Auth:** 無
- **Cache:** 5 分鐘

**成功回應 (200):**
```json
{
  "categories": ["瑜伽", "TRX", "拳擊", "普拉提", "HIIT", ...]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/classes/categories
```

---

### `GET /api/classes/available-dates` — 可用課程日期

- **Auth:** 無
- **Cache:** 60 秒

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `category` | string | 分類篩選 |

**成功回應 (200):**
```json
{
  "dates": ["2026-05-17", "2026-05-18", "2026-05-19", ...]
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/classes/available-dates?category=瑜伽"
```

---

### `GET /api/classes/upcoming` — 即將開課

- **Auth:** `optionalAuth`

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `limit` | int | 數量限制（預設 10） |

**成功回應 (200):**
```json
{
  "classes": [
    {
      "id": "class-uuid",
      "title": "瑜伽入門",
      "category": "瑜伽",
      "next_schedule": "2026-05-17T10:00:00.000Z",
      "enrolled_count": 5,
      "max_participants": 10
    }
  ]
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/classes/upcoming?limit=6"
```

---

### `GET /api/classes/:id/recommended` — 推薦相關課程

- **Auth:** 無

**成功回應 (200):**
```json
{
  "recommended": [
    { "id": "...", "title": "瑜伽進階", "category": "瑜伽" }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/classes/<class-id>/recommended
```

---

### `POST /api/classes` — 新增課程（教練專用）

- **Auth:** `authenticateToken` + `requireCoach`

**Request Body:**
```json
{
  "title": "瑜伽入門",
  "title_en": "Yoga Beginner",
  "category": "瑜伽",
  "difficulty": "初級",
  "description": "適合初學者的瑜伽課程",
  "price_hkd": 250,
  "credits_cost": 2,
  "duration": 60,
  "max_participants": 10,
  "venue_name": "中環瑜伽中心",
  "venue_address": "中環德輔道中 100 號"
}
```

**成功回應 (201):**
```json
{
  "message": "課程已建立",
  "class_id": "new-class-uuid"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/classes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title":"瑜伽入門","category":"瑜伽","difficulty":"初級","price_hkd":250,"duration":60,"max_participants":10,"venue_name":"中環瑜伽中心","venue_address":"中環德輔道中100號"}'
```

---

### `PUT /api/classes/:id` — 更新課程

- **Auth:** `requireCoach`

**Request Body:** 需要更新的欄位（部分更新）

**成功回應 (200):**
```json
{
  "message": "課程已更新"
}
```

---

## 📅 Bookings 預約

### `POST /api/bookings` — 建立預約

- **Auth:** `authenticateToken`
- **Validation:** `schemas.booking`

**Request Body:**
```json
{
  "schedule_id": "schedule-uuid",
  "class_id": "class-uuid",
  "payment_type": "single",
  "amount": 250
}
```

`payment_type` 可選值：
- `"single"` — 單次付款（需 Admin 確認）
- `"credits"` — 用 Credits 付款（即時確認）
- `"membership_trial"` — 試玩體驗（限一次）

**成功回應 (200/201):**
```json
{
  "message": "預約成功",
  "booking": {
    "id": "booking-uuid",
    "booking_reference": "ZP-20260516-ABCD",
    "status": "pending_payment",
    "payment_status": "pending"
  }
}
```

**錯誤回應:**
| 狀態碼 | 訊息 |
|--------|------|
| 400 | 缺少預約資料 |
| 400 | 你已經使用過試玩體驗 |
| 404 | 該時段不存在或已滿 |
| 400 | 該時段已滿額 |
| 200 | 你有一個未完成付款的預約，請繼續付款（重複預約時） |
| 409 | 你已經預約了此課程時段 |
| 400 | 點數不足，請先購買點數 |

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"schedule_id":"<schedule-id>","class_id":"<class-id>","payment_type":"credits","amount":0}'
```

---

### `GET /api/bookings/my` — 我的預約

- **Auth:** `authenticateToken`

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `status` | string | 篩選狀態：`confirmed` / `attended` / `cancelled` |
| `page` | int | 頁碼（預設 1） |
| `limit` | int | 每頁數量（預設 20） |

**成功回應 (200):**
```json
{
  "bookings": [
    {
      "id": "booking-uuid",
      "booking_reference": "ZP-20260516-ABCD",
      "class_id": "class-uuid",
      "title": "瑜伽入門",
      "category": "瑜伽",
      "start_time": "2026-05-17T10:00:00.000Z",
      "end_time": "2026-05-17T11:00:00.000Z",
      "status": "confirmed",
      "payment_status": "paid",
      "payment_type": "credits",
      "amount": 0,
      "schedule_id": "schedule-uuid"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/bookings/my?status=confirmed" \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/bookings/trial-status` — 檢查試玩使用狀態

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "used": false
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/bookings/trial-status \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/bookings/today` — 今日預約

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "bookings": [
    {
      "id": "booking-uuid",
      "title": "瑜伽入門",
      "start_time": "2026-05-16T18:00:00.000Z",
      "venue_name": "中環瑜伽中心"
    }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/bookings/today \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/bookings/:id/complete-payment` — 完成付款

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "payment_method": "fps",
  "payment_reference": "FPS123456",
  "amount": 250
}
```

`payment_method`：`"fps"` | `"payme"` | `"stripe"` | `"card"`

**成功回應 (200):**
```json
{
  "message": "✅ 付款資料已提交，待管理員確認"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/bookings/<booking-id>/complete-payment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"payment_method":"fps","payment_reference":"FPS123456","amount":250}'
```

---

### `POST /api/bookings/:id/cancel` — 取消預約

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "message": "預約已取消"
}
```

**錯誤回應:**
| 狀態碼 | 訊息 |
|--------|------|
| 404 | 找不到你可取消的預約 |

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/bookings/<booking-id>/cancel \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/bookings/:id/attend` — 標記已出席（教練用）

- **Auth:** `authenticateToken`（需是該課程教練）

**成功回應 (200):**
```json
{
  "message": "已標記出席"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/bookings/<booking-id>/attend \
  -H "Authorization: Bearer <token>"
```

---

## 🧑‍🏫 Coach 教練

### `POST /api/coach/apply` — 申請成為教練

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "name": "李教練",
  "phone": "+85212345678",
  "email": "coach@example.com",
  "years_experience": 5,
  "specialties": ["瑜伽", "普拉提"],
  "certificates": "RYT-200",
  "bio": "10年瑜伽教學經驗",
  "venue_name": "中環瑜伽中心",
  "venue_address": "中環德輔道中 100 號 5 樓",
  "venue_photos": ["url1", "url2"],
  "facilities": ["瑜伽墊", "更衣室"]
}
```

**成功回應 (201):**
```json
{
  "message": "申請已提交，我們將在 3 個工作日內完成審批",
  "application_id": "app-uuid"
}
```

**錯誤回應:** 409 - 你已經有進行中的申請

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/coach/apply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"李教練","phone":"+85212345678","email":"coach@example.com","venue_address":"中環德輔道中100號"}'
```

---

### `GET /api/coach/application` — 查詢申請狀態

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "application": {
    "id": "app-uuid",
    "status": "pending",
    "created_at": "2026-05-16T12:00:00.000Z"
  }
}
```

---

### `GET /api/coach/my-classes` — 教練的課程列表

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "classes": [
    {
      "id": "class-uuid",
      "title": "瑜伽入門",
      "category": "瑜伽",
      "upcoming_bookings": 5,
      "total_attended": 30
    }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/coach/my-classes \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/coach/schedules` — 新增課程時間

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "class_id": "class-uuid",
  "start_time": "2026-05-17T10:00:00.000Z",
  "end_time": "2026-05-17T11:00:00.000Z",
  "recurring": "weekly",
  "max_participants": 10
}
```

**成功回應 (201):**
```json
{
  "message": "時間已新增",
  "schedule_id": "new-schedule-uuid"
}
```

---

### `GET /api/coach/class-students` — 查看課程學生名單

- **Auth:** `authenticateToken`（需是該課程教練）

**Query Parameters:**

| 參數 | 類型 | 必須 | 說明 |
|------|------|------|------|
| `schedule_id` | string | ✅ | 時段 ID |

**成功回應 (200):**
```json
{
  "schedule": {
    "id": "schedule-uuid",
    "start_time": "2026-05-17T10:00:00.000Z",
    "end_time": "2026-05-17T11:00:00.000Z",
    "enrolled_count": 3,
    "max_participants": 10,
    "title": "瑜伽入門",
    "venue_name": "中環瑜伽中心",
    "venue_address": "中環德輔道中 100 號"
  },
  "students": [
    {
      "id": "booking-uuid",
      "user_id": "user-uuid",
      "name": "陳大文",
      "email": "user@example.com",
      "phone": "+85212345678",
      "booking_status": "confirmed",
      "payment_status": "paid",
      "booking_date": "2026-05-16T12:00:00.000Z"
    }
  ],
  "total": 3
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/coach/class-students?schedule_id=<schedule-id>" \
  -H "Authorization: Bearer <token>"
```

---

## 💰 Coach Earnings 教練收入

### `GET /api/coach/earnings` — 收入摘要

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "summary": {
    "monthly": 5000,
    "total": 25000,
    "pending": 3000,
    "paid": 22000,
    "week_classes": 5
  },
  "monthly_trend": [
    { "month": "2026-01", "total": 4000 },
    { "month": "2026-02", "total": 4200 }
  ],
  "commission_rate": 0.75,
  "total_earnings": 25000,
  "pending_payout": 3000
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/coach/earnings \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/coach/earnings/detail` — 收入明細

- **Auth:** `authenticateToken`

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `page` | int | 頁碼 |
| `limit` | int | 每頁數量 |
| `status` | string | `pending` / `paid` |
| `start_date` | string | 開始日期 |
| `end_date` | string | 結束日期 |

**成功回應 (200):**
```json
{
  "earnings": [
    {
      "id": "earning-uuid",
      "class_title": "瑜伽入門",
      "net_amount": 187.5,
      "date": "2026-05-16",
      "status": "pending"
    }
  ]
}
```

---

### `POST /api/coach/payout-request` — 提款申請

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "amount": 3000,
  "payout_method": "fps",
  "account_info": "12345678"
}
```

**成功回應 (200):**
```json
{
  "message": "提款申請已提交"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/coach/payout-request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"amount":3000,"payout_method":"fps","account_info":"12345678"}'
```

---

## 👑 Admin 管理員

### `GET /api/admin/stats` — 統計數據

- **Auth:** `authenticateToken` + `requireAdmin`

**成功回應 (200):**
```json
{
  "stats": {
    "total_users": 50,
    "total_bookings": 120,
    "total_revenue": 30000,
    "today_bookings": 5,
    "pending_payments": 3,
    "active_classes": 15,
    "monthly_growth": 12.5
  }
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/admin/stats \
  -H "Authorization: Bearer <admin-token>"
```

---

### `GET /api/admin/bookings` — 所有預約

- **Auth:** `authenticateToken` + `requireAdmin`

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `status` | string | 篩選狀態 |
| `page` | int | 頁碼 |
| `limit` | int | 每頁數量 |

**成功回應 (200):**
```json
{
  "bookings": [
    {
      "id": "booking-uuid",
      "booking_reference": "ZP-...",
      "user_name": "陳大文",
      "class_title": "瑜伽入門",
      "start_time": "2026-05-17T10:00:00.000Z",
      "status": "pending_payment",
      "amount": 250
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 120 }
}
```

---

### `GET /api/admin/users` — 用戶列表

- **Auth:** `authenticateToken` + `requireAdmin`

**成功回應 (200):**
```json
{
  "users": [
    {
      "id": "uuid",
      "name": "陳大文",
      "email": "user@example.com",
      "membership_type": "standard",
      "credits": 50,
      "created_at": "2026-05-01T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/admin/classes` — 所有課程

- **Auth:** `authenticateToken` + `requireAdmin`

**成功回應 (200):**
```json
{
  "classes": [...]
}
```

---

### `GET /api/admin/pending-payments` — 待確認付款

- **Auth:** `authenticateToken` + `requireAdmin`

**成功回應 (200):**
```json
{
  "pending_payments": [
    {
      "booking_id": "booking-uuid",
      "booking_reference": "ZP-...",
      "user_name": "陳大文",
      "amount": 250,
      "payment_method": "fps",
      "fps_reference": "FPS123",
      "class_title": "瑜伽入門",
      "start_time": "2026-05-17T10:00:00.000Z"
    }
  ]
}
```

---

### `POST /api/admin/approve-payment` — 確認付款

- **Auth:** `authenticateToken` + `requireAdmin`

**Request Body:**
```json
{
  "booking_id": "booking-uuid"
}
```

**成功回應 (200):**
```json
{
  "message": "✅ 付款已確認，預約已生效",
  "booking_id": "booking-uuid"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/admin/approve-payment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"booking_id":"<booking-id>"}'
```

---

### `POST /api/admin/reject-payment` — 拒絕付款

- **Auth:** `authenticateToken` + `requireAdmin`

**Request Body:**
```json
{
  "booking_id": "booking-uuid",
  "reason": "付款資料不清晰"
}
```

**成功回應 (200):**
```json
{
  "message": "❌ 付款已拒絕"
}
```

---

### `POST /api/admin/process-payouts` — 批量處理教練出糧

- **Auth:** `authenticateToken` + `requireAdmin`

**Request Body:**
```json
{
  "coach_id": "optional-coach-id",
  "period_start": "2026-05-01",
  "period_end": "2026-05-31"
}
```

**成功回應 (200):**
```json
{
  "message": "出糧處理完成",
  "payouts_count": 3,
  "total_amount": 5000
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/admin/process-payouts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"period_start":"2026-05-01","period_end":"2026-05-31"}'
```

---

### `GET /api/admin/payouts` — 查看所有出糧記錄

- **Auth:** `authenticateToken` + `requireAdmin`

**成功回應 (200):**
```json
{
  "payouts": [
    {
      "id": "payout-uuid",
      "coach_name": "李教練",
      "amount": 3000,
      "status": "paid",
      "processed_at": "2026-05-16T12:00:00.000Z"
    }
  ]
}
```

---

## 🎯 Points 積分

### `GET /api/points` — 積分摘要

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "points": 500,
  "tier": { "id": "bronze", "label": "🥉 銅牌", "color": "#CD7F32" },
  "nextTier": { "id": "silver", "label": "🥈 銀牌", "minPoints": 500 },
  "tierProgress": 60,
  "checkinStreak": 5,
  "checkedInToday": false,
  "weekBookings": 2,
  "monthEarned": 150,
  "totalEarned": 1200,
  "totalSpent": 700
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/points \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/points/history` — 積分記錄

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "transactions": [
    {
      "id": "tx-uuid",
      "type": "earn",
      "points": 10,
      "balance_after": 510,
      "source": "checkin",
      "description": "每日簽到",
      "created_at": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/points/tiers` — 積分等級制度

- **Auth:** 無

**成功回應 (200):**
```json
{
  "tiers": [
    { "id": "bronze", "label": "🥉 銅牌", "minPoints": 0, "color": "#CD7F32" },
    { "id": "silver", "label": "🥈 銀牌", "minPoints": 500, "color": "#C0C0C0" },
    { "id": "gold", "label": "🥇 金牌", "minPoints": 2000, "color": "#FFD700" },
    { "id": "diamond", "label": "💎 鑽石", "minPoints": 5000, "color": "#B9F2FF" }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/points/tiers
```

---

### `GET /api/points/rewards` — 可兌換獎勵列表

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "rewards": [
    { "id": "discount-10", "name": "9 折優惠碼", "points_cost": 200, "type": "discount", "value": "10% off" },
    { "id": "free-class", "name": "免費一堂", "points_cost": 500, "type": "class", "value": "free_class" },
    { "id": "credits-5", "name": "5 Credits", "points_cost": 300, "type": "credits", "value": 5 }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/points/rewards \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/points/checkin` — 每日簽到

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "latitude": 22.3193,
  "longitude": 114.1694
}
```

**成功回應 (200):**
```json
{
  "message": "✅ 簽到成功！獲得 10 積分",
  "points_earned": 10,
  "current_streak": 5,
  "total_points": 510
}
```

**錯誤回應:** 400 - 你今天已經簽到過了

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/points/checkin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{}'
```

---

### `POST /api/points/redeem` — 兌換積分獎勵

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "reward_id": "discount-10"
}
```

**成功回應 (200):**
```json
{
  "message": "✅ 兌換成功！",
  "reward": { "name": "9 折優惠碼", "code": "ZENPASS10" },
  "points_spent": 200,
  "remaining_points": 310
}
```

**錯誤回應:** 400 - 積分不足

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/points/redeem \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"reward_id":"discount-10"}'
```

---

### `GET /api/points/redemptions` — 兌換記錄

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "redemptions": [
    {
      "id": "redemption-uuid",
      "reward_name": "9 折優惠碼",
      "points_spent": 200,
      "created_at": "2026-05-16T12:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/points/leaderboard` — 積分排行榜

- **Auth:** 無

**成功回應 (200):**
```json
{
  "leaderboard": [
    { "rank": 1, "name": "陳大文", "points": 5000, "tier": "diamond" },
    { "rank": 2, "name": "張三", "points": 3200, "tier": "gold" }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/points/leaderboard
```

---

### `GET /api/points/checkin-dates` — 本月簽到日期

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "dates": ["2026-05-01", "2026-05-02", "2026-05-03"]
}
```

---

## 🏅 Badges 勳章

### `GET /api/badges` — 所有勳章列表

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "badges": [
    {
      "id": "badge-uuid",
      "name": "初出茅廬",
      "description": "完成第一堂課程",
      "icon": "🌟",
      "condition_type": "total_bookings",
      "condition_value": "1"
    }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/badges \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/badges/mine` — 我的勳章

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "badges": [
    {
      "badge_id": "badge-uuid",
      "name": "初出茅廬",
      "icon": "🌟",
      "earned_at": "2026-05-16T12:00:00.000Z"
    }
  ]
}
```

---

### `POST /api/badges/check` — 手動檢查並頒發勳章

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "new_badges": [
    { "id": "badge-uuid", "name": "初出茅廬", "icon": "🌟" }
  ]
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/badges/check \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/badges/progress` — 勳章進度

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "progress": [
    {
      "badge": { "id": "badge-uuid", "name": "初出茅廬", "condition_type": "total_bookings", "condition_value": "1" },
      "current": 0,
      "target": 1,
      "percentage": 0,
      "earned": false
    }
  ]
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/badges/progress \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/badges/profile/:userId` — 查看其他用戶的勳章

- **Auth:** 無

**成功回應 (200):**
```json
{
  "badges": [...],
  "user": { "name": "陳大文", "points_tier": "silver" }
}
```

---

## 🔔 Notifications 通知

### `GET /api/notifications` — 通知列表

- **Auth:** `authenticateToken`

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `page` | int | 頁碼 |
| `limit` | int | 每頁數量 |
| `unreadOnly` | string | `true` / `1` — 只顯示未讀 |

**成功回應 (200):**
```json
{
  "notifications": [
    {
      "id": "notif-uuid",
      "type": "booking.confirmed",
      "title": "預約確認",
      "body": "你的瑜伽入門課程已確認",
      "is_read": 0,
      "created_at": "2026-05-16T12:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 10 }
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/notifications?unreadOnly=true" \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/notifications/unread-count` — 未讀通知數量

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "count": 3
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/notifications/unread-count \
  -H "Authorization: Bearer <token>"
```

---

### `PUT /api/notifications/:id/read` — 標記單條已讀

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "message": "已標記為已讀"
}
```

---

### `PUT /api/notifications/read-all` — 全部標記已讀

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "message": "已標記 5 條通知為已讀",
  "count": 5
}
```

---

### `DELETE /api/notifications/:id` — 刪除通知

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "message": "已刪除"
}
```

---

### `POST /api/notifications/push-subscribe` — 註冊瀏覽器推送

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

**成功回應 (200):**
```json
{
  "message": "推送訂閱成功"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/notifications/push-subscribe \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"subscription":{"endpoint":"https://...","keys":{"p256dh":"...","auth":"..."}}}'
```

---

### `DELETE /api/notifications/push-unsubscribe` — 取消推送訂閱

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "endpoint": "https://fcm.googleapis.com/..."
}
```

**成功回應 (200):**
```json
{
  "message": "已取消推送訂閱"
}
```

---

## ⏳ Waitlist 候補名單

### `POST /api/waitlist/join` — 加入候補

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "schedule_id": "schedule-uuid"
}
```

**成功回應 (200):**
```json
{
  "success": true,
  "message": "✅ 已加入候補名單，第 2 位",
  "waitlist_id": "waitlist-uuid",
  "position": 2,
  "class_title": "瑜伽入門"
}
```

**錯誤回應:**
| 狀態碼 | 訊息 |
|--------|------|
| 400 | 缺少時段 ID |
| 404 | 該時段不存在 |
| 400 | 你已預約了此課程 |

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/waitlist/join \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"schedule_id":"<schedule-id>"}'
```

---

### `POST /api/waitlist/leave` — 離開候補

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "schedule_id": "schedule-uuid"
}
```

**成功回應 (200):**
```json
{
  "success": true,
  "message": "✅ 已離開候補名單"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/waitlist/leave \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"schedule_id":"<schedule-id>"}'
```

---

### `GET /api/waitlist/status` — 查詢候補狀態

- **Auth:** `authenticateToken`

**Query Parameters:**

| 參數 | 類型 | 必須 | 說明 |
|------|------|------|------|
| `schedule_id` | string | ✅ | 時段 ID |

**成功回應 (200):**
```json
{
  "in_waitlist": true,
  "position": 2,
  "total": 5,
  "status": "waiting"
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/waitlist/status?schedule_id=<schedule-id>" \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/waitlist/notify-next` — 通知下一位候補

- **Auth:** `authenticateToken`（管理員或已自動觸發）

**Request Body:**
```json
{
  "schedule_id": "schedule-uuid"
}
```

**成功回應 (200):**
```json
{
  "notified": true,
  "message": "已通知下一位候補"
}
```

---

## 💳 Memberships 會籍

### `GET /api/memberships/plans` — 會籍方案列表

- **Auth:** 無

**成功回應 (200):**
```json
{
  "plans": {
    "trial": {
      "name": "試玩體驗",
      "name_en": "Trial",
      "price_hkd": 399,
      "credits_granted": 4,
      "duration_days": 30,
      "description": "每月 4 堂課程，適合想試試 ZenPass 的新朋友"
    },
    "standard": {
      "name": "標準會員",
      "name_en": "Standard",
      "price_hkd": 699,
      "credits_granted": 10,
      "duration_days": 30,
      "description": "每月 10 堂課程，優先預約權"
    },
    "unlimited": {
      "name": "無限通行",
      "name_en": "Unlimited",
      "price_hkd": 1299,
      "credits_granted": 0,
      "duration_days": 30,
      "description": "無限堂數，每月 2 堂私人指導"
    }
  }
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/memberships/plans
```

---

### `POST /api/memberships/subscribe` — 訂閱會籍

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "type": "standard",
  "payment_method": "stripe"
}
```

`type`：`"trial"` | `"standard"` | `"unlimited"`

**成功回應 (201):**
```json
{
  "message": "🎉 成功訂閱 標準會員 會籍！",
  "membership": {
    "id": "membership-uuid",
    "type": "standard",
    "start_date": "2026-05-16T00:00:00.000Z",
    "end_date": "2026-06-15T00:00:00.000Z",
    "credits_granted": 10
  }
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/memberships/subscribe \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"type":"standard","payment_method":"stripe"}'
```

---

### `GET /api/memberships/my` — 我的會籍記錄

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "memberships": [
    {
      "id": "uuid",
      "type": "standard",
      "status": "active",
      "start_date": "2026-05-16T00:00:00.000Z",
      "end_date": "2026-06-15T00:00:00.000Z",
      "credits_granted": 10
    }
  ]
}
```

---

### `GET /api/memberships/credits/packages` — Credits 套餐列表

- **Auth:** 無

**成功回應 (200):**
```json
{
  "packages": [
    { "id": "credits-5", "credits": 5, "price_hkd": 500, "name": "5 Credits" },
    { "id": "credits-10", "credits": 10, "price_hkd": 900, "name": "10 Credits" },
    { "id": "credits-20", "credits": 20, "price_hkd": 1600, "name": "20 Credits" }
  ]
}
```

---

### `POST /api/memberships/credits` — 購買 Credits

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "package_id": "credits-10",
  "payment_method": "stripe"
}
```

**成功回應 (201):**
```json
{
  "message": "✅ 成功購買 10 Credits",
  "credits_added": 10
}
```

---

## 🔗 Referral 推薦計劃

### `GET /api/referral/my-code` — 我的推薦碼

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "code": "ZPABCDE1234",
  "redeemed": 3,
  "credits_earned": 60
}
```

**curl 例子:**
```bash
curl http://localhost:3001/api/referral/my-code \
  -H "Authorization: Bearer <token>"
```

---

### `POST /api/referral/redeem` — 使用推薦碼

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "code": "ZPABCDE1234"
}
```

**成功回應 (200):**
```json
{
  "message": "✅ 推薦碼已使用！你獲得 10 Credits",
  "bonus": 10
}
```

**錯誤回應:**
| 狀態碼 | 訊息 |
|--------|------|
| 404 | 推薦碼無效 |
| 400 | 唔可以用自己嘅推薦碼 |
| 400 | 你已經用過推薦碼 |

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/referral/redeem \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"code":"ZPABCDE1234"}'
```

---

### `GET /api/loyalty/tiers` — 會籍等級福利一覽

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "tiers": [
    { "id": "bronze", "name": "🥉 銅牌", "min_visits": 0, "benefits": ["基本課程預約", "標準支援"] },
    { "id": "silver", "name": "🥈 銀牌", "min_visits": 10, "benefits": ["優先預約", "每月 1 堂免費"] },
    { "id": "gold", "name": "🥇 金牌", "min_visits": 30, "benefits": ["無限預約", "每月 3 堂免費", "生日優惠"] },
    { "id": "platinum", "name": "💎 鉑金", "min_visits": 60, "benefits": ["全部金牌功能", "私人教練諮詢"] }
  ]
}
```

---

## 📋 CRM 客戶管理

### `GET /api/crm/students` — 學生列表

- **Auth:** `authenticateToken`

**Query Parameters:**

| 參數 | 類型 | 說明 |
|------|------|------|
| `search` | string | 姓名/Email/電話搜尋 |
| `tag` | string | 標籤篩選 |
| `status` | string | `active` / `inactive` |
| `page` | int | 頁碼（預設 1） |
| `limit` | int | 每頁數量（預設 50） |

**成功回應 (200):**
```json
{
  "students": [
    {
      "id": "user-uuid",
      "name": "陳大文",
      "email": "user@example.com",
      "phone": "+85212345678",
      "tags": "vip",
      "total_bookings": 5,
      "attended_bookings": 4,
      "last_visit": "2026-05-15T10:00:00.000Z"
    }
  ],
  "total": 50,
  "page": 1
}
```

**curl 例子:**
```bash
curl "http://localhost:3001/api/crm/students?search=陳" \
  -H "Authorization: Bearer <token>"
```

---

### `GET /api/crm/students/:id` — 學生詳情

- **Auth:** `authenticateToken`

**成功回應 (200):**
```json
{
  "student": { ... },
  "bookings": [...],
  "notes": [...],
  "communications": [...]
}
```

---

### `PUT /api/crm/students/:id` — 更新學生資料

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "tags": "vip,regular",
  "lead_source": "referral"
}
```

**成功回應 (200):**
```json
{
  "message": "已更新"
}
```

---

### `POST /api/crm/students/:id/notes` — 新增學生筆記

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "content": "學生對瑜伽課程非常投入"
}
```

**成功回應 (201):**
```json
{
  "message": "筆記已新增",
  "note": { ... }
}
```

---

### `POST /api/crm/waiver` — 提交健康申報表

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "name": "陳大文",
  "age": 30,
  "gender": "男",
  "phone": "+85212345678",
  "conditions": "無",
  "other": ""
}
```

**成功回應 (200):**
```json
{
  "success": true,
  "message": "✅ 健康申報已提交"
}
```

**curl 例子:**
```bash
curl -X POST http://localhost:3001/api/crm/waiver \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"陳大文","age":30,"gender":"男","phone":"+85212345678","conditions":"無"}'
```

---

### `POST /api/crm/import` — CSV 匯入學生

- **Auth:** `authenticateToken`

**Request Body:**
```json
{
  "students": [
    { "name": "新學生", "email": "new@example.com", "phone": "+85200000000" }
  ]
}
```

---

## 💳 Payments 付款

### `POST /api/payments/confirm` — 確認付款
- **Auth:** 無
- **Request:** `{ "booking_id", "payment_method", "payment_reference", "amount" }`

### `POST /api/payments/fps` — 轉數快付款
- **Auth:** 無
- **Request:** `{ "amount", "booking_id", "fps_reference" }`

### `POST /api/payments/payme` — PayMe 付款
- **Auth:** 無
- **Request:** `{ "amount", "booking_id", "payme_reference" }`

### `POST /api/payments/stripe/create-intent` — 建立 Stripe PaymentIntent
- **Auth:** `authenticateToken`
- **Request:** `{ "amount" }`

### `POST /api/payments/stripe/create-checkout` — 建立 Stripe Checkout Session
- **Auth:** `authenticateToken`
- **Request:** `{ "booking_id", "amount" }`

### `POST /api/payments/stripe/confirm-payment` — 確認 Stripe 付款
- **Auth:** `authenticateToken`
- **Request:** `{ "payment_intent_id" }`

### `GET /api/payments/gateways` — 可用付款方式
- **Auth:** 無

### `POST /api/payments/upload-receipt` — 上傳收據圖片
- **Auth:** `authenticateToken`

---

## ⚡ 快速測試

```bash
# 1. 健康檢查
curl http://localhost:3001/api/health

# 2. 註冊 + 登入
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com","password":"test123"}'

TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 3. 使用 token 存取受保護的 endpoint
curl http://localhost:3001/api/classes \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🔧 開發資訊

- **DB:** SQLite（WAL mode），路徑 `backend/data/zenpass.db`
- **Admin 後台:** `http://localhost:3001/admin.html`
- **Port:** 3001（可通過 `PORT` env var 修改）
- **Rate Limit:** 每 15 分鐘 500 請求
- **CORS:** 支援 localhost + GitHub Pages
- **啟動:** `cd backend && node src/index.js`

---
