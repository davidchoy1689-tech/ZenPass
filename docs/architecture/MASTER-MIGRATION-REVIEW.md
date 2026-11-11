# Master Migration 安全審查（2026-11-11）

## 結論：**唔可以喺生產直接執行** `000_master_zenpass_production.sql`

原因唔係腳本寫得差，而係它假設「空白資料庫」，但生產已經有 95 張表、183 個班次、15 張真實預約。`CREATE TABLE IF NOT EXISTS` 遇到同名表會**靜靜跳過**，結果係一半舊 schema、一半新空表，形成 split-brain。

## 逐表裁決

| 腳本表 | 生產現況 | 直接跑會發生 |
|---|---|---|
| `users` | 已存在（60+ 欄） | 跳過；`phone NOT NULL` 約束**唔會**套用。而且生產有 12 個 user `phone` 為 NULL（管理員／電郵帳戶），喺乾淨副本上會直接 INSERT 失敗 |
| `merchant_studios` / `studio_coaches` / `studio_access_configs` | 已存在 | 跳過（形狀相近，可接受） |
| `corporate_clients` / `corporate_employees` | 已存在 | 跳過（缺少 `quota_month`、`role`、`monthly_quota_units` 等實際欄位） |
| `family_groups` / `family_members` | 已存在 | 跳過 |
| `user_passes` | 已存在但**完全唔同**：`total_credits/remaining_credits/price_paid` | 跳過；腳本嘅 `total_units/remaining_units/price_paid_cents/student_user_id` 全部**唔存在** |
| `classes` | 已存在 30+ 欄 | 跳過；腳本只定義 6 欄，差好遠 |
| **`schedules`** | **唔存在**（真實係 `class_schedules`） | **建立一張空表**，同 183 個真實班次完全脫節 |
| `coach_availability_slots` | 已存在 | 跳過 |
| **`bookings`** | 已存在（100+ 欄） | 跳過；腳本用 `session_id` / `student_user_id` / `payment_type CHECK`，真實用 `schedule_id` / `user_id` / 值域唔同 |
| `checkin_audit_incidents` | 已存在 | 跳過 |
| `buddy_groups` | 已存在 | 跳過（缺 payment_intent 欄） |
| `verified_reviews` | 已存在 | 跳過 |
| `marketplace_products` / `marketplace_orders` | 已存在 | 跳過（真實多咗 `unit_price_cents`、`commission_cents`、`paid_at` 等） |
| `fps_clearing_batches` | 已存在 | 跳過（缺 `bank_mode`、`details_json`） |
| **`coach_earnings_ledger`** | **唔存在**（真實係 `coach_earnings`） | **建立空表**；之後 FPS / 報表會計錯數 |
| **`audit_logs`** | **唔存在**（真實係 `audit_log`） | **建立空表**；新代碼寫入會去錯表，審計斷鏈 |

## 已提供嘅安全替代品

`migrations/000_master_zenpass_reconciliation.sql`：
- **唔建任何 base table**、唔改任何資料。
- 只建立三個 **read-only 兼容 view**：`schedules`、`audit_logs`、`coach_earnings_ledger`，將規格名映射到真實表。
- 目的：任何按清冊名寫嘅 SELECT／報表可以即時跑；**寫入仍然要用真實表名**（SQLite view 預設不可寫）。

## 如果真要行「canonical schema」

正確做法（未做，需 David 批准）：
1. 喺 VPS 影一份 DB 副本（`zenpass_production.db`），唔好碰生產。
2. 寫 ETL：`class_schedules → schedules`、`coach_earnings → coach_earnings_ledger`（要補 `booking_id`，部分資料根本無法回填）。
3. 雙寫期：新舊表同時寫，比對 2–4 週。
4. 切換讀取，保留舊表 90 天。
5. 唔可以一步到位；`coach_earnings` 缺 `booking_id`，逐單分錄需要由 `bookings` 重算，屬會計重述。

## 建議

- 短期：用現有真實 schema ＋ 兼容 view。
- 中期：只做 P1「booking 級 ledger」——新建 `coach_earnings_ledger` 並**由結算引擎雙寫**，舊表保留，唔好一次性取代。
- 任何時候：呢類 master script 只可以在空 DB／副本執行，禁止直接落生產。
