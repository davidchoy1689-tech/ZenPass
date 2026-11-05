# Admin 預約操作 API（改期 / 加位）

> 權限：`ops.booking.write`（admin／platform_staff／platform_manager／super_admin）
> 所有操作喺單一 SQLite transaction 內完成；任何一步失敗即全數 rollback。
> 全部寫 `audit_log`。
> ⚠️ Production POST 需要登入 cookie ＋ `x-csrf-token`（由 admin 前端 `api.js` 自動帶）；用 curl 測試要自行加。

## 1. 改期 `POST /api/admin/bookings/:id/reschedule`

```json
{
  "new_schedule_id": "69770fe1-7970-4fb5-8be2-8960167dfa88",
  "reason": "11/09首發特批免費順延至11/11"
}
```

- 只限 `confirmed` / `pending_payment` 嘅預約
- 新班次必須**同一課程**、未取消、未開始、名額足夠
- 同一用戶同一班嘅所有有效 booking（2 人同行 = 2 筆）**一齊搬**
- 舊單 → `cancelled`，`cancel_reason = rescheduled: <reason>`；**付款狀態保留**（唔會當退款）
- 新單沿用原金額、付款方式、FPS 參考、拆賬比例；狀態：已確認→`confirmed`，待付款→`pending_payment`
- 名額：新班以 `enrolled_count + n <= max_participants` 原子扣減；舊班 `MAX(0, enrolled_count - n)`
- 審計：`booking.rescheduled`（old/new booking ids、新舊 schedule、seats、reason、actor）

回應 `200`：
```json
{ "success": true, "old_booking_ids": ["…"], "new_booking_ids": ["…"], "seats": 1, "new_schedule_id": "…" }
```

錯誤：`400 INVALID_INPUT / REASON_REQUIRED / CLASS_MISMATCH / SCHEDULE_PAST / SAME_SCHEDULE`、`404 BOOKING_NOT_FOUND / SCHEDULE_NOT_FOUND`、`409 BOOKING_STATUS_INVALID / SCHEDULE_CANCELLED / CLASS_FULL`

## 2. 加位升級 `POST /api/admin/bookings/:id/upgrade-seats`

```json
{
  "friend_name": "陳太",
  "friend_phone": "85292345678",
  "top_up_amount": 100,
  "payment_reference": "FPS-20261107-001"
}
```

- 原單必須已付款（`payment_status = paid`）且 `confirmed` / `pending_payment`
- 補款固定 **HK$100**（140 + 100 = 240，二人同行價）
- 朋友會建立一個獨立訪客帳號（不能登入），令點名單可分開顯示姓名／電話
- 名額以原子條件扣 1，滿額即 409
- 新 booking：`amount=100`、`payment_status=paid`、`status=confirmed`、`payment_method=fps`、`fps_reference=payment_reference`
- 審計：`booking.upgraded_seats`（原單、新單、姓名、電話、補款、FPS 參考、actor）

回應 `201`：
```json
{ "success": true, "original_booking_id": "…", "new_booking_id": "…", "friend_user_id": "…", "top_up_amount": 100 }
```

錯誤：`400 FRIEND_NAME_REQUIRED / FRIEND_PHONE_INVALID / TOPUP_AMOUNT_INVALID / PAYMENT_REF_REQUIRED`、`404 BOOKING_NOT_FOUND / SCHEDULE_NOT_FOUND`、`409 BOOKING_NOT_PAID / BOOKING_STATUS_INVALID / FRIEND_PHONE_EXISTS / CLASS_FULL / SCHEDULE_CANCELLED / SCHEDULE_PAST`

## 測試
- `node backend/tests/test-admin-booking-actions.js`（31 項：正常流程、2 人同行、滿額 rollback、狀態／課程／時間驗證、重複電話、未付款）
- 快照 E2E：真實 HTTP 呼叫 + DB 核對（改期 11/09→11/11、加位 100、滿額 409 舊單不變、401 未登入、400 跨課程）
