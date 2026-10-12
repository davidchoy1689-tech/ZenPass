# 參考項目 Gap 分析：Studio OS ↔ ZenPass

> 目的：用最貼近嘅開源項目（Studio OS，MIT）對照 ZenPass 現有 DB / 流程，
> 列出「值得改」嘅位。逐項標咗優先次序。**呢份係分析，唔係已改。**

來源：`github.com/Booyaka101/studio-os`（我已 clone 並讀過 `src/db/schema.sql`、`src/services/booking.js`、`SPEC.md`）
對照版本：ZenPass `main` @ 2026-10-12（DB 54 張表）

---

## A. 點解 Studio OS 值得參考
- Stack 同 ZenPass **一樣**：Node + Express + better-sqlite3 + SQLite（WAL），預設 HKD / Asia_Hong_Kong。
- 功能重疊：class packs(credits)、membership（unlimited 或每月 N 次）、FIFO waitlist + 自動補位、取消窗 + credit 退回、waiver、Stripe BYO、append-only `audit_log`。
- 佢嘅核心 booking 規則**全部有 test**，而且係「純 DB transaction、無 HTTP/email side effect」嘅設計 → 好易驗證。

⚠️ 單作者、年輕 project → **攞設計，唔好當 dependency**。

---

## B. 值得改嘅位（按影響排）

### 🔴 P1 — 錢用整數分（cents），唔好用 REAL
- **Studio OS**：所有金額用 `*_cents INTEGER`（`drop_in_price_cents`、`price_paid_cents`、`amount_cents`）。
- **ZenPass**：`bookings.amount REAL`、`wallet_transactions.amount/balance_*  REAL`、`ledger.debit/credit REAL`、`coach_earnings.gross/net REAL`。
- **風險**：浮點加減會有 0.01 級誤差 → 對數（reconcile）長期會出現「差一分」假警報，IPO 審計唔接受。
- **建議**：新欄位一律 `INTEGER` cents；遷移時 `ROUND(x*100)`；讀寫層統一 conversion。**呢個係最影響 audit 嘅一項。**

### 🔴 P1 — Credits 扣/退要同 booking 同一個 transaction（atomic）
- **Studio OS**：capacity 檢查 + credit 扣減 + 寫 booking row **喺同一個 `db.transaction()`**；取消時在同一 transaction 內退 credit + 補位。
- **ZenPass**：靠「15 分鐘 hold + scheduler 清理」做 eventual consistency（見 MEMORY）。RACE：兩個請求同時搶最後一個位，可能超賣或漏扣。
- **建議**：核心路徑（book/cancel）改成單一 SQLite transaction 內完成 capacity + credit + booking 寫入；hold 機制保留做 UX，但「落實」要 atomic。

### 🟠 P2 — Waitlist 建模：用 booking status，唔好另開一套
- **Studio OS**：waitlist 就係 `bookings.status='waitlist'`，補位時 `UPDATE ... SET status='booked'`，**同一張表、同一引擎**。
- **ZenPass**：有獨立 `waitlist.js` 模組（本地 DB 見唔到 `waitlist` table，疑 lazy create）→ 同 booking 兩套邏輯，易 drift。
- **建議**：考慮統一用 `bookings.status` 表達 waitlist；補位時**重新 resolve 付款**（Studio OS 咁做，因為 pass 可能已過期）。

### 🟠 P2 — Pack 到期 + 「最快到期先用」次序
- **Studio OS**：`passes(credits_total, credits_remaining, expires_on)`；`resolvePayment` 揀「最快到期、且未過期」嘅 pack。
- **ZenPass**：`users.credits` 係**單一 pool** → 冇「邊個 pack 快到期」概念，過期亦難處理。
- **建議**：若要支援「套票有效期」，需要 per-pack 記錄 + 到期 scheduler（唔可以只靠一個 credits 數字）。

### 🟠 P2 — Membership 月 reset 用 anchor date（避開 2 月漂移）
- **Studio OS**：月週期由**入會日**做 anchor 去計，唔係層層加月；否則「31 號入會」過一次 2 月就變 28 號、之後永遠卡 28。
- **ZenPass**：企業 credit 每月 1 號 reset（相對安全），但若日後做「個人 membership 月週期」要跟呢個 pattern。
- **建議**：任何「N 個月週期」都錨定起始日，唔好由上一期推進。

### 🟠 P2 — Booking 要記「邊個 pack / membership 出錢」
- **Studio OS**：`bookings.paid_with`(enum) + `pass_id` / `membership_id` FK → 一睇就知筆錢點嚟。
- **ZenPass**：`bookings.payment_type` + `payment_status` + `amount`，但**冇 FK 指返邊張 pass / membership**。
- **建議**：加 provenance（邊張 pass/membership）→ 審計追溯先完整。

### 🟡 P3 — Schema 加 CHECK / enum，防止 status 漂移
- **Studio OS**：status 全部 `CHECK(... IN (...))`，加 partial unique index（例：`UNIQUE(class_instance_id, client_id) WHERE status!='cancelled'` 防重覆報名）。
- **ZenPass**：status 多數係自由 TEXT（見到 `confirmed` / `booked` 混用風險）→ 資料易漂。
- **建議**：新表加 CHECK；關鍵表（bookings/schedules）補 enum 校驗 + partial unique index。

### 🟡 P3 — 錢相關表太多、source of truth 唔清
- **Studio OS**：得一張 `payments`（+ passes/memberships）做記帳來源。
- **ZenPass**：有 `ledger`、`transactions`、`booking_payments`、`wallet_transactions`、`sales`、`private_income` 多過一組 → 對數要對幾處。
- **建議**：明確「ledger = 會計 source of truth」，其餘表標明用途 / 或收斂；避免將來 audit 對唔上。

### 🟡 P3 — 取消政策參數化
- **Studio OS**：`settings` 存 `cancellation_window_hours`、`late_cancel_policy`(forfeit/refund)。
- **ZenPass**：hold/取消規則多數寫死喺 code / MEMORY。
- **建議**：抽去 config 表，方便按活動 / partner override。

---

## C. 建議次序（Impact × Effort）
1. **P1 金額整數化（cents）** — 影響 audit 最深；做一次 migration + 讀寫層轉換。
2. **P1 booking atomic（capacity+credit 同 transaction）** — 直接消除超賣 / 漏扣。
3. **P2 provenance + waitlist 統一** — 追溯同邏輯一致性。
4. 其餘（pack 到期、anchor reset、CHECK、表收斂）按 roadmap 慢慢做。

## D. 唔建議照搬嘅
- Studio OS 係**單館**設計（無 multi-tenant / partner / 拆賬）→ 你多場地、多教練、四邊拆賬嘅 model 要保留。
- 佢呃唔做 payout（明確 out of scope）→ 你 `coach_payouts` / Stripe Connect 要自己嚟。

## E. 補充參考
- **Formance Ledger**（double-entry 標杆：Postgres、numscript、atomic multi-posting、account/asset 建模）→ 你 `ledger` 想升級到 IPO 級可以照佢 model。
- **Stripe Connect RocketRides**（官方）→ 教練/場地出糧 onboarding + transfer 先睇。
