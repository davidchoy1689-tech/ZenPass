# ZenPass DB Gap 分析 & 改善研究

> 日期：2026-10-12 ｜ 對象：ZenPass 生產 SQLite DB（`backend/data/zenpass.db`）
> 方法：dump 生產 `.schema`（35KB）＋實際查生產數據；對照開源參考項目 Studio OS / Formance Ledger
> 定位：**IPO / 審計級** — 目標係「可審計、可追溯、可擴展、零 vendor lock-in」

---

## 0. 摘要（TL;DR）
1. 🔴 **所有金額都用 `REAL`（浮點）** — 29 個金額欄。浮點會有分毫誤差，審計唔接受。→ 改 **integer cents**。
2. 🔴 **book / cancel 唔夠原子** — capacity + credit 分開處理（15 分鐘 hold + scheduler），會超賣 / 漏扣。
3. 🟠 **錢相關表嚴重重疊** — `transactions` / `booking_payments` / `wallet_transactions` / `ledger` / `sales` / `private_income` / `venue_rentals`… 對數要對幾處。
4. 🟠 **概念重覆** — `waitlist`+`app_waitlist`、`notifications`+`notification_logs`、`reviews`+`feedback`+`coach_ratings`+`nps_surveys`。
5. 🟠 **時間戳不一致** — 大部分 UTC `datetime('now')`，但有 4 張表用本地 `+8 hours`。
6. 🟡 **約束不足** — `users.role` 8 個值無 CHECK；0 張 STRICT 表；缺 partial unique index。

---

## 1. 現況清單
- 表：**60 張**（`sqlite_master`），但**只有約 32 張有資料**；`ledger`、`booking_payments`、`waitlist`、`coach_payouts`、`sales`、`venue_rentals`、`private_income`、`partner_payouts`、`nps_surveys`、`notification_logs`、`request_log` 等**全部 0 行**。
- 主要資料量：`notifications`=2751、`class_schedules`=1757、`pageviews`=744、`classes`=110、`partner_venues`=58、`users`=24、`bookings`=15。
- 金額欄：**29 個 `REAL`**，只有少數 credit 類係 `INTEGER`。
- `STRICT` 表：**0**（SQLite 動態型別 → 一個 REAL 欄其實可以塞 TEXT，型別無保證）。
- 孤兒資料：暫時 0（bookings→users / schedules、ledger→bookings、wallet→users、coach_earnings→users 全部乾淨）。

---

## 2. 🔴 P1 — 必須改（直接影響審計）

### P1-1 金額用浮點（29 欄）
`REAL` 金額欄：
```
bookings.amount / platform_earned_amount / venue_earned_amount
bookings.amount_paid            booking_payments.amount
transactions.amount             wallet_transactions.amount / balance_before / balance_after / fee
ledger.debit / ledger.credit    refund_logs.amount
coach_earnings.unit_price / gross_amount / net_amount
coach_payouts.amount / fee / net_amount
partner_payouts.amount / fee / net_amount
partner_venues.total_revenue    private_income.amount
sales.unit_price / total_amount venue_rentals.price_hkd
classes.price_hkd               memberships.price_hkd
auto_topup_history.amount_paid
```
**問題**：0.1+0.2 類誤差會累積；對數（reconcile）會出現「差一分」假警報；四式拆賬加總可能對唔上 `amount`。
**參考**：Studio OS 全用 `*_cents INTEGER`。
**改善**：新欄位一律 `INTEGER`（單位 = 分 / cent）。
- 遷移：新增 `*_cents` 欄 → `UPDATE ... SET x_cents = ROUND(x*100)` → 切換讀寫層 →（可選）之後先棄用舊欄（SQLite 3.35+ 支援 `DROP COLUMN`，但要留意 CHECK/index 依賴）。
- 讀寫層統一：DB 存 cents，API/UI 轉換。**唔好逐處散落手寫 `*100`**，要做一個 money helper。

### P1-2 原子性（capacity + credit）
- 現況：靠 15 分鐘 hold + scheduler 清理（eventual consistency）。
- 風險：兩個併發請求搶最後一個位 → 超賣；或 hold 釋放同 confirm 之間漏扣。
- **參考**：Studio OS 將「檢查容量 + 扣 credit + 寫 booking」放喺**單一 `db.transaction()`**。
- **改善**：核心 `book()` / `cancel()` 用單一 SQLite transaction（`BEGIN IMMEDIATE`）完成檢查 + 扣/退 + 寫入；hold 機制保留做 UX，但「落實」要 atomic。

### P1-3 Ledger 覆蓋政策
- `ledger` 剛上線（0 行）；舊資料冇 ledger（已於今日 reconcile 加 cutoff：上線前 → advisory）。
- **改善**：明確寫落 policy —「**由 2026-10-12 起，每筆成功收/退款必須喺同一 transaction 內寫 ledger**」；加 CI gate（已有 `audit` job）；每星期 reconcil（已有 cron）。

---

## 3. 🟠 P2 — 應改（架構清晰度 / 可追溯）

### P2-1 錢表重疊（source of truth 唔清）
同一件事散落多表：`transactions`（3）／`booking_payments`（0）／`wallet_transactions`（1）／`ledger`（0）／`sales`（0）／`private_income`（0）／`venue_rentals`（0）／`partner_payouts`（0）。
**改善**：確立**分層**：
- `ledger` = 會計唯一真相（double-entry，append-only）。
- `wallet_transactions` = 用戶錢包流水（credit 變動）。
- `bookings` = 業務事件。
- `coach_earnings` / `coach_payouts` / `partner_payouts` = 應付/已付。
- 其餘（`transactions`、`sales`、`private_income`、`booking_payments`）→ **收斂／標明用途或淘汰**，避免兩處記同一筆。

### P2-2 概念重覆的表
| 概念 | 重覆表 | 建議 |
|---|---|---|
| 候補 | `waitlist`(0) + `app_waitlist`(1) | 二選一；或用 `bookings.status='waitlist'`（Studio OS 做法） |
| 通知 | `notifications`(2751) + `notification_logs`(0) | 統一一個 |
| 評價 | `reviews`(1) + `feedback`(2) + `coach_ratings`(0) + `nps_surveys`(0) | 定義清楚邊個係 NPS、邊個係 review |
| 追蹤 | `pageviews`(744) + `user_actions`(92) + `request_log`(0) | 收斂 analytics |

### P2-3 無 provenance（邊個 pack/membership 出錢）
- `bookings` 只有 `payment_type` + `amount` + `credits_used`，**冇 FK 指返邊張 pass / membership**。
- **參考**：Studio OS `bookings.paid_with` + `pass_id` / `membership_id`。
- **改善**：加 `pass_id` / `membership_id`（或 `payment_source_id`）→ 審計可一鍵追溯。

### P2-4 時間戳不一致
- 65 處用 UTC `datetime('now')`；**4 張表**用本地 `datetime('now','+8 hours')`：`wishlist`、`nps_surveys`、`auto_topup_config`、`auto_topup_history`。
- **問題**：同一系統兩種時間基準 → 對帳 / 時序分析會錯。
- **改善**：統一**存 UTC**，顯示時先轉 HKT（Studio OS 原則）。

### P2-5 Pack 到期 / credit 模型
- 而家係 `users.credits` 單一 pool → 冇「套票有效期」概念。
- **改善**：若要有效期，需要 per-pack 記錄（Studio OS `passes`：`credits_total/remaining/expires_on`），配「最快到期先用」。

---

## 4. 🟡 P3 — Nice to have

- **加 CHECK / enum**：`users.role` 現有 8 值（admin / coach / partner_owner / partner_staff / platform_manager / platform_staff / super_admin / user）但**無 CHECK** → 打錯字會靜默。加 CHECK 或用 reference table。
- **Partial unique index**：防重覆報名 —— `UNIQUE(schedule_id, user_id) WHERE status NOT IN ('cancelled')`（Studio OS 有類似）。
- **STRICT 表**：新表用 `CREATE TABLE ... STRICT`，杜絕型別漂移。
- **啟用 FK 強制**：應用層每次連線要 `PRAGMA foreign_keys = ON`（確認所有 route 都做）；否則 FK 只係文件。
- **空表清理**：0 行嘅表要麼落實、要麼移除，減少審計面。
- **append-only 保證**：`ledger` / `audit_log` 加 SQLite trigger 擋 UPDATE/DELETE（你 12 張金融表已裝，確認 ledger/audit_log 都喺內）。

---

## 5. 改善路線圖（建議次序）

**Phase 1 — 錢正確性（最高優先）**
1. 寫 money helper（cents ↔ display）。
2. 29 個金額欄加 `*_cents` + backfill（`ROUND(x*100)`）+ 切讀寫 + 測試。
3. `book()/cancel()` 改單一 transaction。

**Phase 2 — 結構收斂**
4. waitlist / notifications / 評價 三組表各自收斂。
5. `bookings` 加 provenance 欄。
6. 時間戳統一 UTC（改 4 張表 default）。

**Phase 3 — 約束 & 文檔**
7. `users.role` CHECK + partial unique index + 新表 STRICT。
8. 0 行表清理 / 文檔化；確認 FK 全 route 開啟 + ledger/audit trigger。

---

## 6. 參考項目對應
- **Studio OS**（單館版，同 stack）：cents、atomic booking、resolvePayment 次序、anchor 月 reset、per-pack 到期、provenance、CHECK/partial index、UTC。
- **Formance Ledger**（double-entry 標杆）：account/asset 建模、atomic multi-posting → 你 `ledger` 升級方向。
- **Stripe Connect RocketRides**：教練/場地出糧 onboarding + transfer（將來真金派錢先做）。

---

## 7. 風險 / 注意
- 改金額涉及**金融資料 migration** → 必須：先備份（`VACUUM INTO`）、喺 snapshot 副本試、加測試、可回滾；**唔可以一次過大改冇 fallback**。
- SQLite 改 CHECK / 欄型別要**重建表**（copy → 換名 → 重建 → 搬資料）→ 要喺維護窗做，並先過 reconcile。
- 所有改動只限 ZenPass 目錄；金錢相關改動需 David 批准。
