# ZenPass 禪流 API

Base URL: `http://localhost:3001/api`

## 認證

```
Authorization: Bearer <token>
```

開發環境可用 demo token：`demo_token_admin` / `demo_token_coach` / `demo_token_student`

---

## Endpoints

### 🏥 Health
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/health` | 伺服器健康檢查 |

### 🔐 Auth
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/auth/register` | 註冊 `{ name, email, password }` |
| POST | `/api/auth/login` | 登入 `{ email, password }` → JWT token |
| GET | `/api/auth/me` | 當前用戶資料 |

### 📚 Classes
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/classes` | 課程列表 (cache 30s) |
| GET | `/api/classes/:id` | 課程詳情 (含 schedules + reviews) |
| GET | `/api/classes/categories` | 分類列表 (cache 5min) |
| GET | `/api/classes/available-dates` | 可用日期 (cache 60s) |
| GET | `/api/classes/:id/recommended` | 推薦相關課程 |
| POST | `/api/classes` | 新增課程 (教練專用) |
| PUT | `/api/classes/:id` | 更新課程 |

### 📅 Bookings
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/bookings` | 建立預約 `{ schedule_id, class_id, payment_type, amount }` |
| GET | `/api/bookings/my` | 我的預約 `?status=confirmed&page=1&limit=20` |
| POST | `/api/bookings/:id/complete-payment` | 完成付款 `{ payment_method, payment_reference, amount }` |
| POST | `/api/bookings/:id/cancel` | 取消預約 |

### 💳 Payments
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/payments/confirm` | 確認付款 `{ booking_id, payment_method, payment_reference, amount }` |
| POST | `/api/payments/fps` | 轉數快 `{ amount, booking_id, fps_reference }` |
| POST | `/api/payments/payme` | PayMe `{ amount, booking_id, payme_reference }` |
| POST | `/api/payments/stripe/create-intent` | Stripe PaymentIntent |
| POST | `/api/payments/stripe/create-checkout` | Stripe Checkout Session |
| POST | `/api/payments/stripe/confirm-payment` | 確認 Stripe 付款 |
| GET | `/api/payments/gateways` | 可用付款方式 |
| POST | `/api/payments/upload-receipt` | 上傳收據圖片 |

### 🧑‍🏫 Coach
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/coach/apply` | 申請成為教練 |
| GET | `/api/coach/earnings` | 收入概覽 |
| GET | `/api/coach/earnings/detail` | 收入明細 |
| POST | `/api/coach/payout-request` | 提款申請 |
| GET | `/api/coach/my-classes` | 我的課程 |

### 👑 Admin
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/admin/bookings` | 所有預約 |
| GET | `/api/admin/users` | 用戶列表 |
| GET | `/api/admin/classes` | 課程管理 |
| GET | `/api/admin/stats` | 統計數據 |
| GET | `/api/admin/pending-payments` | 待確認付款 |
| POST | `/api/admin/approve-payment` | 通過付款 |
| POST | `/api/admin/reject-payment` | 拒絕付款 |

### 🎯 Points & Badges
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/points` | 積分記錄 |
| POST | `/api/points/redeem` | 兌換積分 |
| GET | `/api/badges` | 徽章列表 |

### 🏅 Memberships
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/memberships/plans` | 會籍計劃 |
| POST | `/api/memberships/subscribe` | 訂閱會籍 |
| GET | `/api/memberships/credits/packages` | Credits 套餐 |

---

## Response Format

成功：
```json
{ "success": true, "data": { ... } }
```

錯誤：
```json
{ "success": false, "error": "錯誤訊息" }
```

或（向後兼容舊 endpoint）：
```json
{ "classes": [...], "bookings": [...] }
```

---

## 開發

```bash
# 啟動
cd backend && node src/index.js

# Smoke test
bash backend/test-smoke.sh

# 清理
bash backend/scripts/reset-data.sh
```

DB: `backend/data/zenpass.db` (SQLite, WAL mode)
Admin: `http://localhost:3001/admin.html`
