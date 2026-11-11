# ZenPass Phase 1–5 全域架構對照（Actual Schema Map）

> 目的：將「最終全域交付架構清冊」的規格名稱，對應到**生產資料庫實際欄位**，避免日後以規格名寫 SQL 而造成 `no such column`。
> 更新：2026-11-11 · 依據 VPS `backend/data/zenpass.db` 實際 `PRAGMA table_info`
> 原則：**實際 schema 為準**；規格名只作概念參考。所有金額為整數 cents 的欄位以 `_cents` 結尾。

## 1. 表名對照

| 規格名稱 | 實際表 | 說明 |
|---|---|---|
| `schedules` | `class_schedules` | 所有班次；無 `schedules` 表 |
| `bookings.session_id` | `bookings.schedule_id` | 指向 `class_schedules.id` |
| `coach_earnings_ledger` | `coach_earnings` | 分錄式但以「每班一筆 + 帶貨每單一筆」運作；**冇 `booking_id`** |
| `audit_logs` | `audit_log` | 欄位 `action_type`／`entity_type`／`new_values`／`description` |
| `checkin_audit_incidents` | 同名 | 有 `details`、`is_resolved` |
| `merchant_studios` / `studio_coaches` / `studio_access_configs` | 同名 | 已上線 |
| `corporate_clients` / `corporate_employees` | 同名 | 已上線；另有 `corporate_email_otps` |
| `marketplace_products` / `marketplace_orders` | 同名 | 已上線 |
| `verified_reviews` | 同名 | `booking_id` UNIQUE |

## 2. 關鍵欄位實際名稱

### bookings
- 班次：`schedule_id`（非 `session_id`）
- 出席：`attendance_status` ∈ `registered / present / no_show / leave_excused / cancelled_by_coach`
- 核銷：`checkin_method`、`checkin_lat`、`checkin_lng`、`checkin_device_hash`、`fraud_audit_status`（`clean` / `flagged_distance` / `flagged_device` / `blocked`）
- 付款：`payment_type` ∈ `single / credits / pass / corporate / walkin…`（**冇 `corporate_pass`、`single_stripe`、`cash_walkin` 字串**）
- 金額：`amount`（HKD 浮點，歷史欄）＋ `amount_cents`（整數，新邏輯用）
- 企業：`corporate_id`、`corporate_employee_id`

### class_schedules
- 容量：`max_participants`（非 `capacity`）
- 開放：`booking_open`（非 `is_booking_open`）
- 價格：**不在** schedule；在 `classes.price_hkd` / `classes.price_hkd_cents`
- Flash：`is_flash_sale_enabled`、`flash_price_cents`
- 商戶：`studio_id`、`is_dropin_enabled`
- 代堂：`coach_override_id`

### user_passes
- 堂數：`total_credits` / `remaining_credits`（非 `total_units` / `remaining_units`）
- 價格：`price_paid`（HKD 浮點）；**冇 `price_paid_cents`**
- 歸屬：`user_id`（使用人）＋ `owner_user_id`（付款人）＋ `family_group_id`
- 企業：`corporate_id`、`pass_type='corporate_pass'`

### coach_earnings
- 分錄種類：`earning_type` ∈ `class_teaching`（預設）/ `affiliate_product_commission`
- 月度：`payout_month`（YYYY-MM）
- 清算：`clearing_status` ∈ `pending / processing / cleared / failed / held_fraud`、`clearing_batch_id`、`bank_tx_id`、`held_reason`
- 帶貨：`product_order_id`
- 金額：`net_amount`（HKD）＋ `net_amount_cents`（整數）
- **冇 `booking_id`**：帶班收益以 `schedule_id` 聚合；帶貨收益以 `product_order_id` 對應

### audit_log
- `action_type`、`entity_type`、`entity_id`、`old_values`、`new_values`、`description`
- （**唔係** `action` / `target_type` / `details`）

## 3. 狀態機實際值

| 概念 | 實際值 |
|---|---|
| 預約狀態 | `pending_payment / confirmed / attended / cancelled / no_show / rescheduled` |
| 付款狀態 | `pending / paid / refunded / failed` |
| 退款 | `refund_status`：`none / requested / processing / refunded`；`refund_state`：`none / pending / refunded` |
| 教練出糧 | `payout_status`：`active / frozen / frozen_stolen` |
| 企業 | `corporate_clients.status`：`active / suspended / trial` |
| 商城 | `order_status`：`pending_payment / paid / dispatched / delivered / refunded` |
| 清算批次 | `draft / processing / completed / partial_failure` |

## 4. 與清冊的實質落差（需要知道，唔影響已上線功能）

1. **逐 booking 凍結做唔到**：`coach_earnings` 以班次為單位，所以一個 `flagged_distance` 會令整班收益 `held_fraud`。要真正做到「只凍結該學員對應份額」，需要新增 `coach_earnings_ledger`（booking 級）並改寫結算引擎 — 屬架構級改動，未做。
2. **`payment_type` 值域受 CHECK 限制**：企業訂單用 `corporate`（＋`corporate_id`），唔係 `corporate_pass`；避免重建金錢核心表。
3. **`bookings` 冇 `session_id`**：全程用 `schedule_id`。
4. **`user_passes` 冇 cents 欄位**：`price_paid` 為 HKD 浮點；新增 Pass 時以 `price_paid` 記錄，結算另用方案價 cents。
5. **`audit_log` 欄名不同**：用 `action_type` / `new_values`；寫錯會靜靜失敗（外層 catch）。
6. **`fps_clearing_batches` 有 `bank_mode`**：現時生產為 `simulated`（銀行 adapter 未接）。
7. **`marketplace_orders` 預設 `pending_payment`**：付款成功才 `paid`，較規格預設 `paid` 安全。

## 5. 建議優先修正（未做，等 David 決定）

| 優先 | 項目 | 影響 |
|---|---|---|
| P1 | 建 `coach_earnings_ledger`（booking 級分錄）＋ migration 回填 | 可逐單凍結、逐單對帳、IPO 級審計 |
| P1 | 真銀行 FPS adapter（HSBC/DBS/恒生 或 ISO 20022） | 自動出糧真正落地 |
| P2 | Stripe live key | 真錢收款（現時 test mode） |
| P2 | 評價提交前端（my-bookings 已出席課堂） | 完成 C 端閉環 |
| P3 | `user_passes` 加 `price_paid_cents` | 全庫金額統一整數 |
| P3 | 商城訂單前端列表／退款流程 | 客服可營運 |
