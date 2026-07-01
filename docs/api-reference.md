# ZenPass API Reference

> 版本：v1 | 最後更新：2026-07-02

---

## Response Format

所有 API response 統一格式：

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": "錯誤訊息" }
```

部分 endpoint 直接回傳 `{ "message": "...", "user": {...} }` 等扁平結構（legacy 兼容）。

---

## Authentication

所有需要登入的 endpoint 需於 HTTP Header 傳送：

```
Authorization: Bearer <token>
```

Token 亦可透過 HTTP-only cookie `zenpass-token` 傳遞（自動處理）。

### CSRF Protection

所有 POST / PUT / PATCH / DELETE 請求（登入、註冊、school inquiry 等 public 端點除外）需要傳送 CSRF token：

1. 先 `GET /api/csrf-token` 獲取 token（同時存入 cookie）
2. 在 mutating 請求的 HTTP Header 加上：

```
x-csrf-token: <token>
```

---

## Endpoints

---

### Auth — 認證系統

#### `POST /api/auth/register` — 電郵註冊

- **Auth required**: No
- **CSRF bypass**: Yes（public）

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "abc123",
  "name": "張小明",
  "phone": "+85261234567"
}
```

**Response** `201 Created`:
```json
{
  "message": "註冊成功",
  "token": "eyJhbGci...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "張小明",
    "phone": "+85261234567",
    "credits": 0,
    "membership_type": null,
    "email_verified": 0,
    "created_at": "2026-07-02 00:00:00"
  },
  "dev_verify_url": "https://zenpass.hk/verify-email.html?token=xxx"  // 僅開發模式
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請填寫姓名、電郵和密碼` |
| 400 | `密碼至少需要 6 個字元` |
| 400 | `電郵格式不正確` |
| 409 | `此電郵已經註冊` |

---

#### `POST /api/auth/login` — 電郵登入

- **Auth required**: No
- **CSRF bypass**: Yes（public）

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "abc123"
}
```

**Response** `200 OK`:
```json
{
  "message": "登入成功",
  "token": "eyJhbGci...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "張小明",
    "credits": 37,
    "membership_type": "standard",
    ...
  }
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請輸入電郵和密碼` |
| 401 | `電郵或密碼不正確` |
| 401 | `此帳戶使用 Apple/Google 登入，請使用該方式登入` |

---

#### `POST /api/auth/social` — 第三方登入（Apple / Google）

- **Auth required**: No
- **CSRF bypass**: Yes（public）

**Request Body:**
```json
{
  "provider": "google",
  "providerId": "google_sub_id",
  "email": "user@gmail.com",
  "name": "John Doe",
  "providerToken": "google_id_token"
}
```

**Response** `200 OK`（existing user） / `201 Created`（new user）:
```json
{
  "message": "登入成功",
  "token": "eyJhbGci...",
  "user": { ... }
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `缺少第三方登入資料` |
| 400 | `不支援的登入方式` |
| 401 | `Google 身份驗證失敗` |

---

#### `POST /api/auth/logout` — 登出

- **Auth required**: No
- **CSRF bypass**: No

**Response:**
```json
{
  "message": "已登出"
}
```

Clear cookie `zenpass-token`.

---

#### `GET /api/auth/me` — 當前用戶資料

- **Auth required**: Yes

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "張小明",
    "phone": "+85261234567",
    "avatar_url": null,
    "credits": 37,
    "membership_type": "standard",
    "membership_expires_at": "2026-08-01T00:00:00.000Z",
    "is_coach": 0,
    "coach_verified": 0,
    "role": "user",
    "partner_id": null,
    "created_at": "2026-06-01 10:00:00",
    "email_verified": 1
  }
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 404 | `用戶不存在` |

---

#### `POST /api/auth/password-reset-request` — 請求重置密碼

- **Auth required**: No
- **CSRF bypass**: Yes（public）

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "message": "如果此電郵已註冊，你將會收到重置密碼指示",
  "dev_token": "abc123...",   // 僅開發模式
  "dev_message": "開發模式:使用此 token 重置密碼"
}
```

---

#### `POST /api/auth/password-reset` — 重置密碼

- **Auth required**: No
- **CSRF bypass**: Yes（public）

**Request Body:**
```json
{
  "token": "abc123...",
  "new_password": "newpass123"
}
```

**Response:**
```json
{
  "message": "✅ 密碼已成功重置，請使用新密碼登入"
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請提供 token 及新密碼` |
| 400 | `密碼至少 6 個字元` |
| 400 | `連結已過期或無效，請重新申請` |

---

#### `POST /api/auth/change-password` — 已登入更改密碼

- **Auth required**: Yes

**Request Body:**
```json
{
  "new_password": "newpass123"
}
```

**Response:**
```json
{
  "message": "✅ 密碼已更新"
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請提供新密碼` |
| 400 | `密碼至少需要 6 個字元` |

---

#### `POST /api/auth/resend-verification` — 重新發送驗證電郵

- **Auth required**: Yes

**Response:**
```json
{
  "message": "驗證電郵已發送",
  "dev_verify_url": "https://zenpass.hk/verify-email.html?token=xxx"
}
```

---

#### `GET /api/auth/verify-email` — 驗證電郵（query param）

- **Auth required**: No

**Query:** `?token=xxx`

**Response:**
```json
{
  "message": "✅ 電郵已驗證成功"
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `缺少驗證 token` |
| 400 | `驗證連結已過期或無效` |

---

#### `GET /api/csrf-token` — 獲取 CSRF Token

- **Auth required**: No

**Response:**
```json
{
  "success": true,
  "token": "a1b2c3d4e5f6..."
}
```

同時設置 HTTP-only cookie `zenpass-csrf-token`（SameSite=Strict, 24h 有效期）。

---

### Wishlist — 收藏課程

所有 wishlist endpoint **需要 Auth**。

#### `GET /api/wishlist` — 取得用戶 wishlist

**Response:**
```json
{
  "wishlist": [
    {
      "id": 1,
      "class_id": "uuid",
      "created_at": "2026-07-02 09:00:00",
      "title": "空中瑜伽初班",
      "category": "瑜伽",
      "difficulty": "beginner",
      "duration": 60,
      "price_hkd": 200,
      "image_url": "/images/yoga.jpg",
      "venue_name": "中環 Studio",
      "coach_id": "uuid",
      "coach_name": "陳教練"
    }
  ],
  "count": 1
}
```

#### `POST /api/wishlist/:classId` — 加入收藏

**Path:** `classId` = 課程 UUID

**Response:**
```json
{
  "success": true,
  "message": "✅ 已加入收藏",
  "wishlisted": true
}
```

**Notes:**
- 已收藏時回傳 `"已喺收藏列表"`（非錯誤）
- 課程不存在或已下架 → `404`

#### `DELETE /api/wishlist/:classId` — 移除收藏

**Response:**
```json
{
  "success": true,
  "message": "✅ 已移除收藏",
  "wishlisted": false
}
```

#### `GET /api/wishlist/count` — Badge 數量

**Response:**
```json
{
  "count": 3
}
```

#### `GET /api/wishlist/check/:classId` — 檢查收藏狀態

**Response:**
```json
{
  "wishlisted": true,
  "created_at": "2026-07-02 09:00:00"
}
```

---

### NPS Survey — 課後評價

#### `POST /api/nps/submit` — 提交課後評價

- **Auth required**: Yes

**Request Body:**
```json
{
  "booking_id": 123,
  "rating": 9,
  "comment": "課堂非常好，導師專業！",
  "would_recommend": true
}
```

**Field Notes:**
| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `booking_id` | ✅ | integer | 預約記錄 ID |
| `rating` | ✅ | integer (1-10) | NPS 評分（1=極差，10=極好） |
| `comment` | ❌ | string | 文字意見 |
| `would_recommend` | ❌ | boolean | 會否推薦（預設 true） |

**Response** `201 Created`:
```json
{
  "success": true,
  "message": "多謝你嘅評價！你的意見幫助我哋變得更好 🙏",
  "id": 5
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請提供 booking_id 和評分` |
| 400 | `NPS 評分必須為 1-10` |
| 400 | `只能對已出席嘅課程提交評價` |
| 400 | `你已經提交過呢個課程嘅評價，多謝你！` |
| 403 | `你無權限評價此預約` |
| 404 | `預約記錄不存在` |

#### `GET /api/nps/stats` — NPS 統計（管理員用）

- **Auth required**: Yes
- **Role required**: admin

**Response:**
```json
{
  "success": true,
  "stats": {
    "total_responses": 120,
    "nps_score": 45,
    "promoters": { "count": 72, "percentage": 60 },
    "passives": { "count": 30, "percentage": 25 },
    "detractors": { "count": 18, "percentage": 15 },
    "would_recommend": 108,
    "would_not_recommend": 12,
    "average_rating": 8.3
  },
  "distribution": [
    { "rating": 10, "count": 40 },
    { "rating": 9, "count": 32 }
  ],
  "recent": [
    {
      "id": 1,
      "rating": 9,
      "comment": "非常好！",
      "would_recommend": 1,
      "created_at": "2026-07-02 09:00:00",
      "user_name": "張小明",
      "class_title": "空中瑜伽初班"
    }
  ]
}
```

**NPS Score Calculation:**
- Promoters（推薦者）: rating 9-10
- Passives（中立）: rating 7-8
- Detractors（批評者）: rating ≤ 6
- NPS = %Promoters − %Detractors

---

### Dynamic Pricing — 動態定價

#### `GET /api/pricing/estimate` — 價格估算

- **Auth required**: No

**Query Parameters:** `?schedule_id=X` or `?class_id=Y`

**Response:**
```json
{
  "success": true,
  "class_id": "uuid",
  "schedule_id": 123,
  "class_title": "空中瑜伽初班",
  "start_time": "2026-07-03T10:00:00.000Z",
  "basePrice": 12,
  "adjustments": [
    {
      "rule_id": "early_bird",
      "label": "早鳥優惠：提前 7 日預約，減 15%",
      "multiplier": 0.85,
      "description": "早鳥優惠：提前 7 日預約，減 15%"
    }
  ],
  "finalPrice": 10,
  "fill_rate": 25,
  "total_discount_percent": 15,
  "currency": "credits"
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請提供 class_id 或 schedule_id` |
| 404 | `找不到該課堂或時間表` |

#### `GET /api/pricing/estimate/batch` — 批量估算

**Query:** `?schedule_ids=1,2,3`

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "schedule_id": 1,
      "class_id": "uuid",
      "title": "空中瑜伽初班",
      "basePrice": 12,
      "finalPrice": 10,
      "adjustments": [ ... ],
      "fill_rate": 25
    }
  ]
}
```

**Constraints:** 1-50 schedule_ids.

#### `GET /api/pricing/rules` — 取得當前定價規則

- **Auth required**: No

**Response:**
```json
{
  "success": true,
  "rules": [
    {
      "id": "weekend_morning",
      "type": "time",
      "days": [0, 6],
      "hours": [9, 12],
      "multiplier": 0.85,
      "label": "週末上午優惠",
      "active": true
    }
  ],
  "rule_count": 6
}
```

**Rule Types:**
| Type | Description |
|------|-------------|
| `time` | 時段規則（特定星期幾 + 時段） |
| `occupancy` | 滿座率規則（min/max 觸發） |
| `early_bird` | 早鳥優惠（課前 N 日預約） |
| `last_minute` | 最後一刻優惠（課前 N 小時） |

#### `PUT /api/pricing/rules` — 更新定價規則

- **Auth required**: Yes
- **Role required**: admin

**Request Body:**
```json
{
  "rules": [
    {
      "id": "weekday_peak",
      "type": "time",
      "days": [1,2,3,4,5],
      "hours": [17, 20],
      "multiplier": 1.15,
      "label": "繁忙時段附加費",
      "active": true
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "✅ 已儲存 6 條定價規則",
  "rules_updated": 6
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `請提供有效嘅規則陣列` |
| 400 | `無效嘅規則類型: xxx` |
| 400 | `規則 xxx 嘅 multiplier 必須大於 0` |

#### `POST /api/pricing/rules/reset` — 重置為預設規則

- **Auth required**: Yes
- **Role required**: admin

**Response:**
```json
{
  "success": true,
  "message": "✅ 已重置為 6 條預設定價規則",
  "rules": [ ... ]
}
```

---

### Loyalty — 忠誠度系統

#### `GET /api/loyalty/tiers` — Tier 定義

- **Auth required**: No

**Response:**
```json
{
  "success": true,
  "tiers": {
    "bronze": {
      "name": "銅牌",
      "name_en": "Bronze",
      "icon": "🥉",
      "min_bookings": 0,
      "max_bookings": 4,
      "benefits": [],
      "next_tier": "silver"
    },
    "silver": {
      "name": "銀牌",
      "name_en": "Silver",
      "icon": "🥈",
      "min_bookings": 5,
      "max_bookings": 9,
      "benefits": [
        { "icon": "🎯", "text": "優先預約權" },
        { "icon": "💵", "text": "Top-up 95折 (5% off)" }
      ],
      "next_tier": "gold"
    },
    "gold": {
      "name": "金牌",
      "name_en": "Gold",
      "icon": "🥇",
      "min_bookings": 10,
      "max_bookings": 19,
      "benefits": [
        { "icon": "🎯", "text": "優先預約權" },
        { "icon": "💵", "text": "Top-up 9折 (10% off)" },
        { "icon": "⏰", "text": "早鳥 24 小時優先預約" }
      ],
      "next_tier": "vip"
    },
    "vip": {
      "name": "VIP",
      "name_en": "VIP",
      "icon": "👑",
      "min_bookings": 20,
      "max_bookings": "Infinity",
      "benefits": [
        { "icon": "🎯", "text": "優先預約權" },
        { "icon": "💵", "text": "Top-up 9折 (10% off)" },
        { "icon": "⏰", "text": "早鳥 24 小時優先預約" },
        { "icon": "🎧", "text": "專屬客服" },
        { "icon": "🎫", "text": "每月免費 Guest Pass 1 張" }
      ],
      "next_tier": null
    }
  }
}
```

**Tier Thresholds:**
| Tier | Monthly Bookings | Top-up Discount |
|------|-----------------|-----------------|
| 🥉 Bronze | 0-4 | 0% |
| 🥈 Silver | 5-9 | 5% |
| 🥇 Gold | 10-19 | 10% |
| 👑 VIP | 20+ | 10% |

#### `GET /api/loyalty/my` — 用戶 Tier 資訊

- **Auth required**: Yes

**Response:**
```json
{
  "success": true,
  "user_id": "uuid",
  "current_tier": "silver",
  "current_tier_info": {
    "name": "銀牌",
    "name_en": "Silver",
    "icon": "🥈",
    "min_bookings": 5,
    "max_bookings": 9,
    "benefits": [ ... ],
    "next_tier": "gold"
  },
  "booking_count": 7,
  "this_month_bookings": 7,
  "next_tier": "gold",
  "next_tier_info": { ... },
  "progress_percent": 60,
  "benefits": [ ... ]
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 404 | `用戶資料不存在` |

#### `GET /api/loyalty/discount` — Top-up 折扣

- **Auth required**: Yes

**Response:**
```json
{
  "success": true,
  "discount_percent": 5,
  "has_discount": true
}
```

#### `POST /api/loyalty/refresh` — 手動 refresh tier

- **Auth required**: Yes

**Response:**
```json
{
  "success": true,
  "message": "✅ 已更新忠誠度等級：🥈 銀牌",
  "tier": "silver",
  "tier_info": { ... },
  "booking_count": 7,
  "benefits": [ ... ]
}
```

**Note:** 根據過去 30 日 booking 數自動計算 tier。

---

### Auto Top-up — 自動加購

#### `GET /api/topup/config` — 讀取設定

- **Auth required**: Yes

**Response:**
```json
{
  "enabled": false,
  "threshold": 10,
  "bundle_type": "standard",
  "bundle": {
    "credits": 25,
    "price": 225,
    "label": "標準包"
  },
  "created_at": null,
  "updated_at": null
}
```

**Bundle Options:**

| Bundle | Credits | Price (HKD) |
|--------|---------|-------------|
| `light` | 10 | $100 |
| `standard` | 25 | $225 |
| `premium` | 55 | $440 |

#### `PUT /api/topup/config` — 儲存設定

- **Auth required**: Yes

**Request Body:**
```json
{
  "enabled": true,
  "threshold": 15,
  "bundle": "standard"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | ❌ | 啟用自動加購（預設 false） |
| `threshold` | integer (1-100) | ❌ | 低於此值時自動加購（預設 10） |
| `bundle` | string | ❌ | 加購包類型：`light` / `standard` / `premium`（預設 `standard`） |

**Response:**
```json
{
  "success": true,
  "message": "Auto Top-up 設定已儲存",
  "config": {
    "enabled": true,
    "threshold": 15,
    "bundle_type": "standard",
    "bundle": { "credits": 25, "price": 225, "label": "標準包" }
  },
  "auto_executed": null
}
```

**Notes:**
- `auto_executed`: 若啟用時 credits 低於 threshold，會立即執行一次 top-up，返回加購結果
- 啟用後系統會定期檢查，當 credits < threshold 時自動加購

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `無效嘅 bundle 類型` |
| 400 | `Threshold 必須喺 1-100 之間` |

#### `POST /api/topup/execute` — 手動觸發 top-up

- **Auth required**: Yes

**Response（credits 足夠）:**
```json
{
  "message": "✅ Credits 足夠，無需 top-up",
  "credits_ok": true
}
```

**Response（執行加購）:**
```json
{
  "success": true,
  "message": "✅ 已自動加購 標準包（+25 cr）",
  "bundle": { "credits": 25, "price": 225, "label": "標準包" },
  "credits_added": 25,
  "amount_paid": 225,
  "credits_before": 8,
  "credits_after": 33,
  "threshold": 15
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 400 | `Auto Top-up 未啟用，請先設定` |

#### `GET /api/topup/history` — Top-up 記錄

- **Auth required**: Yes

**Query:** `?limit=20&offset=0`

**Response:**
```json
{
  "history": [
    {
      "id": 1,
      "user_id": "uuid",
      "bundle_type": "standard",
      "credits_added": 25,
      "amount_paid": 225,
      "status": "completed",
      "trigger": "auto",
      "created_at": "2026-07-02 09:00:00"
    }
  ],
  "total": 5
}
```

**Trigger types:** `auto`（自動） / `manual`（手動）

---

### School ECA — 學校課外活動查詢

#### `POST /api/school/inquiry` — 學校查詢 ECA 合作

- **Auth required**: No
- **CSRF bypass**: Yes（public）

**Request Body:**
```json
{
  "school_name": "聖保羅書院",
  "contact_name": "陳老師",
  "contact_email": "teacher@school.edu.hk",
  "contact_phone": "+85261234567",
  "sports_of_interest": "瑜伽，健身，舞蹈",
  "message": "希望為學生安排課後活動"
}
```

**Response:**
```json
{
  "id": "uuid",
  "message": "✅ 查詢已收到！我哋嘅學校團隊會儘快同你聯絡。"
}
```

同時向管理員 Telegram 發送通知。

---

### Membership Pause — 會籍暫停

所有 pause endpoint **需要 Auth**，且用戶僅可操作自己的會籍。

#### `GET /api/memberships/:id/pause-status` — 查看暫停狀態

- **Auth required**: Yes

**Response:**
```json
{
  "is_paused": true,
  "paused_until": "2026-07-16T01:04:00.000Z",
  "remaining_days": 14,
  "remaining_hours": 336,
  "pause_count": 1,
  "max_pause_days": 30,
  "pause_reason": "考試溫習",
  "can_pause": false,
  "can_resume": true,
  "pause_history": [
    {
      "action": "pause",
      "description": "暫停 (x1)",
      "timestamp": null
    }
  ]
}
```

**Note:** 最多可暫停 3 次。

#### `PUT /api/memberships/:id/pause` — 暫停會籍

- **Auth required**: Yes

**Request Body:**
```json
{
  "pause_days": 14,
  "reason": "考試溫習"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pause_days` | integer | ❌ | 暫停日數（1-30，預設 14） |
| `reason` | string | ❌ | 暫停原因 |

**Response:**
```json
{
  "message": "⏸️ 會籍已暫停 14 日，將於 2026/7/16 自動恢復",
  "paused_until": "2026-07-16T01:04:00.000Z",
  "new_end_date": "2026-08-15T01:04:00.000Z",
  "pause_count": 1
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 404 | `會籍不存在` |
| 400 | `會籍唔係 active 狀態` |
| 400 | `會籍已經暫停緊` |
| 400 | `已達到最大暫停次數 (3次)` |

**Note:** 暫停期間會籍到期日會順延相同日數。

#### `PUT /api/memberships/:id/resume` — 恢復會籍

- **Auth required**: Yes

**Response:**
```json
{
  "message": "🔁 會籍已恢復！",
  "end_date": "2026-08-15T01:04:00.000Z"
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 404 | `會籍不存在` |
| 400 | `會籍未暫停` |

---

### Revenue Dashboard — 收入儀錶板

#### `GET /api/admin/revenue-dashboard` — KPI + Charts 數據

- **Auth required**: Yes
- **Role required**: admin

**Response:**
```json
{
  "mrr": 125000,
  "totalRevenue": 2500000,
  "activeSubscribers": 320,
  "avgRevenuePerUser": 650.5,
  "monthlyRevenue": [
    {
      "month": "2025-07",
      "subscription": 120000,
      "topup": 50000,
      "corporate": 30000,
      "total": 200000
    }
  ],
  "revenueBreakdown": [
    { "source": "membership", "label": "會籍", "amount": 1500000, "percentage": 60 },
    { "source": "topup", "label": "增值", "amount": 500000, "percentage": 20 },
    { "source": "corporate", "label": "企業", "amount": 300000, "percentage": 12 },
    { "source": "booking", "label": "單次預約", "amount": 200000, "percentage": 8 }
  ],
  "recentTransactions": [
    {
      "id": "txn_uuid",
      "user_id": "uuid",
      "user_name": "張小明",
      "user_email": "user@example.com",
      "type": "membership",
      "amount": 799,
      "payment_method": "stripe",
      "status": "completed",
      "description": "標準Pass會籍 (30日)",
      "created_at": "2026-07-01 10:00:00"
    }
  ]
}
```

**Field Notes:**
| Field | Description |
|-------|-------------|
| `mrr` | 月經常性收入（active membership × price） |
| `totalRevenue` | 歷史總收入 |
| `activeSubscribers` | 活躍會籍用戶數 |
| `avgRevenuePerUser` | 平均每用戶收入 |
| `monthlyRevenue` | 過去 12 個月每月收入細項 |
| `revenueBreakdown` | 收入來源佔比（會籍/增值/企業/單次） |

---

### Corporate — 企業健康計劃

#### `GET /api/corporate/stats/:companyId` — 員工 Wellness 數據

- **Auth required**: Yes
- **Role required**: admin

**Response:**
```json
{
  "totalBookings": 450,
  "monthlyUsage": [
    { "month": "2026-06", "count": 45 }
  ],
  "topEmployees": [
    { "name": "李四", "email": "lee@company.com", "bookings": 20 }
  ],
  "popularCategories": [
    { "category": "瑜伽", "count": 150 }
  ],
  "creditUtilization": 0.75
}
```

**Error Codes:**
| Status | Error |
|--------|-------|
| 404 | `企業不存在` |
| 403 | `只限管理員` |

---

### Other Corporate Endpoints

All require `admin` role except `my-company` / `my/hr-dashboard` / `my/employee` / `my/invite`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/corporate/companies` | 企業列表（admin） |
| `POST` | `/api/corporate/companies` | 建立企業帳戶（admin） |
| `GET` | `/api/corporate/companies/:id` | 企業詳情 + 用量報表（admin） |
| `PATCH` | `/api/corporate/companies/:id` | 更新企業資料（admin） |
| `POST` | `/api/corporate/companies/:id/topup` | Credit Pool 加值（admin） |
| `POST` | `/api/corporate/companies/:id/employees` | 批量新增員工（admin） |
| `GET` | `/api/corporate/report` | 收入報表（admin） |
| `PATCH` | `/api/corporate/members/:memberId/limit` | 設定員工月度上限（admin） |
| `GET` | `/api/corporate/my-company` | 員工查詢所屬企業 |
| `GET` | `/api/corporate/my/hr-dashboard` | HR 儀錶板 |
| `GET` | `/api/corporate/my/employee/:userId` | 員工詳細用量 |
| `POST` | `/api/corporate/my/invite` | HR 邀請新員工 |
| `GET` | `/api/corporate/stats/:companyId` | Wellness 統計（admin） |

Documentation available at `docs/corporate-company-guide.md`.

---

## Common Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Bad Request — 參數缺失或格式錯誤 |
| 401 | Unauthorized — 未登入或 token 失效 |
| 403 | Forbidden — 權限不足 / CSRF 驗證失敗 |
| 404 | Not Found — 資源不存在 |
| 409 | Conflict — 資源重複（如電郵已註冊） |
| 429 | Rate Limited — 請求過於頻繁 |
| 500 | Internal Server Error — 伺服器錯誤 |

---

## Admin 權限要求

部分 management endpoint 需要 `role === "admin"`：

- `GET /api/admin/*` — 所有 admin routes
- `PUT /api/pricing/rules` — 更新定價規則
- `POST /api/pricing/rules/reset` — 重置定價規則
- `GET /api/nps/stats` — NPS 統計
- `GET /api/corporate/stats/:companyId` — 企業統計
- `GET /api/school/inquiries` — 學校查詢列表 (或 API key)

---

## 額外 Pricing Config Endpoints

The `getDb`-based pricing config also exposes these endpoints (non-admin readable):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pricing/all` | 完整定價（plans + packages + credit costs） |
| `GET` | `/api/pricing/plans` | 會籍方案列表 |
| `GET` | `/api/pricing/packages` | 加購點數方案 |
| `GET` | `/api/pricing/dynamic` | 動態時段 pricing（by fill rate） |
| `GET` | `/api/admin/pricing` | 全部定價設定（admin） |
| `PUT` | `/api/admin/pricing` | 更新定價設定（admin） |
