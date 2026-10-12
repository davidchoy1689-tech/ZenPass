# Phase 1 遷移計劃：金額 → 整數 cents

> 目標：消除浮點 `REAL` 金額嘅分毫誤差，達 IPO 審計要求。
> 狀態：**遷移腳本已寫 + 已喺生產 snapshot 副本實測通過（未跑生產）。**
> 相關：`docs/db-gap-analysis.md`（P1-1）

---

## 1. 影響範圍（實測）
- 掃描生產 schema，偵測到 **34 個金額欄（REAL）**：
  `bookings`(amount / platform_earned_amount / venue_earned_amount)、`wallet_transactions`(amount/balance_before/balance_after/fee)、`ledger`(debit/credit)、`coach_earnings`(unit_price/gross/net)、`coach_payouts`(amount/fee/net)、`partner_payouts`(amount/fee/net)、`classes.price_hkd`、`memberships.price_hkd`、`venue_rentals`(price_hkd/commission_amount)、`transactions.amount`、`refund_logs.amount`、`booking_payments.amount`、`auto_topup_history.amount_paid`、`private_income.amount`、`sales`(unit_price/total_amount)、`partner_venues.total_revenue`、`users`(total_spent/total_earnings/pending_payout/wallet_balance)。
- **會讀寫金額嘅 app 檔：33 個**（`src/routes/*` + `src/services/*`）→ 呢個係「cutover」階段嘅主要工作量。

## 2. 策略：加成式（additive）→ dual-write → 切換 → 棄舊欄
**唔一次過改型別**（SQLite 改欄型別要重建表，風險大）。分 4 步：

| 步驟 | 內容 | 風險 | 可回滾 |
|---|---|---|---|
| **S1（已做）** | 每個金額欄新增 `<col>_cents INTEGER`，backfill `ROUND(col*100)` | 低（只加欄） | ✅ 直接 DROP 欄 |
| **S2** | 引入 money helper；寫入路徑**同時寫**舊欄 + `_cents`（dual-write） | 中 | ✅ |
| **S3** | 逐個 module 讀取改為 `_cents`（先做 ledger/accounting/wallet 等 audit 核心） | 中 | ✅ |
| **S4** | 全部讀寫用 cents + 對數連續綠 → 重建表移除舊 REAL 欄 | 高（維護窗） | 需備份 |

## 3. 已完成（S1）
- 腳本：`backend/src/scripts/migrate-money-to-cents.js`
  - 冪等、單一 transaction、`--dry-run`、寫 `audit_log`（append-only）
  - 自動偵測金額欄（排除 rate/percent 等）；backfill + **逐行驗證**
- **實測（生產 snapshot 副本 `/tmp/cents-work/prod.db`）**：
  - dry-run 列出 34 欄 ✅
  - 實跑：34 欄 backfill（bookings 15 行、classes 110、users 24、partner_venues 58 …）✅
  - 逐行驗證：**全部一致** ✅
  - 重跑：0 欄 → **冪等** ✅
  - `reconcile-audit.py` 對遷移後副本：**block=0**（讀舊欄，未受影響）✅

## 4. S2–S4 待辦（未做）
### S2 dual-write
- 新檔 `src/lib/money.js`：`toCents(x) = Math.round(x*100)`、`fromCents(c) = c/100`、格式 helper。
- 所有 INSERT/UPDATE 金額嘅地方：同時寫舊欄 + `_cents`。
- 加**一致性檢查 job**（或每日維護）：比對 `ABS(col - col_cents/100) > 0.005` 嘅行 → 報警。

### S3 逐 module 切讀
- 次序（audit 核心優先）：`services/accounting.js`、`services/wallet-service.js`、`services/commission.js`、`services/refund.js`、`services/booking-service.js` → 再到 routes。
- 每切一個：加/更新 unit test（已備 `tests/test-ledger-unit.js`）。

### S4 棄舊欄
- 用「重建表」方式移除舊 REAL 欄（SQLite 3.35+ 亦可 `DROP COLUMN`，但要先清 CHECK/index 依賴）。
- 前提：連續 N 次 reconcil 綠 + 一致性檢查 0 偏差。

## 5. 執行前置（跑生產時）
1. `VACUUM INTO` 備份生產 DB（已有 daily backup）。
2. 喺 snapshot 副本再跑一次 S1（今次已驗證）。
3. 維護窗內跑 S1（只加欄，秒級、可 online）。
4. 驗證：`migrate-...js` 內建驗證 + `reconcile-audit.py`。
5. 出事回滾：`ALTER TABLE ... DROP COLUMN <col>_cents`（或還原備份）。

## 6. 風險 / 注意
- **S1 對生產係「只加欄」**，唔改任何現有讀寫 → 對現行系統零影響（app 仍然用舊欄）。
- 真正風險喺 S2–S3（改 app code）→ 必須逐 module + 測試 + 可回滾。
- 金額改動屬**金融資料**，跑生產前需 David 明確批准。
