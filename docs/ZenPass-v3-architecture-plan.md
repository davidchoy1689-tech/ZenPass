# ZenPass v3 架構升級計劃
### 參考 8 個世界級開源專案，抽取可落地模式，目標：可審計 · 可擴展 · 合規（IPO-ready）

> 作者：CEO Assistant　日期：2026-10-14　狀態：**待 David 批准開工**

---

## 0. 目的與原則
- **目的**：唔重寫，而係將 ZenPass 由「做得到」升級到「上到市、經得起核數」嘅交易／財務核心。
- **原則**：只借鑑**架構與設計模式**，唔 copy code；維持**零 vendor lock-in**；**money = 只 append、可全程追溯**；按需要複雜化，唔為型而型。

---

## 1. 參考專案 → 抽取嘅核心模式

| 專案 | 領域 | 最值得參考嘅模式（提取重點） |
|---|---|---|
| **Sharetribe** (sharetribe/sharetribe) | Marketplace | ① **Listing（可售項目）vs Transaction（一筆交易）vs Booking（時段佔用）** 三者分離；② 交易**狀態機**（enquiry→offer→payment→completed→disputed）；③ 多邊收款／**佣金引擎**（provider commission + payout） |
| **Cal.com** (calcom/cal.com) | 排程 | ① **Availability 由規則算出**（schedule + buffer + blackout + timezone），唔係硬塞 DB；② **Idempotent booking**；③ **Webhook / event bus**（觸發式通知） |
| **Kill Bill** (killbill/killbill) | 訂閱計費 | ① **Catalog（計劃版本化）**；② **Invoice 為一等公民**；③ **Entitlement**（會籍→可用權限）；④ **每個 object 有 audit history**；⑤ 事件匯流排 |
| **Lago** (getlago/lago) | 用量計費 | ① **用量事件 append-only → 聚合 → 出賬**；② **冪等事件攝入**；③ customer/subscription 模型 |
| **Formance Ledger / TigerBeetle** | 複式記帳 | ① **Accounts + Transfers + 不可變 ledger**，餘額由 transfers 推導；② **兩階段轉帳（pending→commit/void）**；③ **多資產**（credits vs HKD）；④ 對帳 |
| **Hyperswitch** (juspay/hyperswitch) | 支付編排 | ① **PaymentIntent 抽象**（統一 Stripe/FPS/PayMe）；② 標準化**狀態機**；③ **對帳（reconciliation）**；④ webhook 正規化 |
| **Medusa** (medusajs/medusa) | 電商後端 | ① **Workflow/Saga（可補償）** 處理多步金錢操作；② **模組邊界**；③ **事件 + Outbox**；④ plugin |
| **Twenty** (twentyhq/twenty) | CRM | ① 現代 CRM 資料模型 + **自訂欄位**；② 簡潔嘅前後端結構 |
| Easy!Appointments / OpenReservation | 基本預約 | 基本 available-slot 邏輯（作為對照） |

---

## 2. 現況 vs 目標（Gap）

| 領域 | 現況 | 目標 |
|---|---|---|
| 記帳 | 有多張 financial table（wallet_transactions、coach_earnings、coach_payouts、ledger、audit_log）＋ DELETE trigger 保護 | **單一複式 ledger 為真相來源**，其餘表為「物化視圖」 |
| Hold 位 | 15 分鐘 pending_payment + cron 清理 | **兩階段轉帳**（pending→commit/void），原子、可審計 |
| 支付 | 各 PSP 各寫法（stripe/fps/payme 分頭） | **PaymentIntent 抽象 + 對帳** |
| 預約 | 預先生成 class_schedules | **規則/template → 實例**（混合模式），Timezone 統一 |
| 會籍 | memberships 表 + type CHECK 漂移 | **Catalog（計劃版本化）+ Invoice + Entitlement** |
| Credits | users.credits + wallet_transactions | **Metered events（append-only）** 推導餘額 |
| 審計 | audit_log + blockchain-audit | **每 object history + Outbox 事件**，端到端可追 |
| 交易邏輯 | 散落 route/service | **Workflow/Saga（可補償）** |

---

## 3. 專案範圍（六大工作流 Workstream）

- **WS1 財務核心**：複式 ledger（accounts/transfers）、兩階段轉帳（hold）、多資產（credits/HKD）、對帳報表。
- **WS2 支付編排**：PaymentIntent 抽象、狀態機、多 PSP adapter、webhook 正規化、reconciliation job。
- **WS3 預約與排程**：availability 規則→實例、booking 狀態機、冪等、timezone 統一、hold 接 WS1。
- **WS4 會籍與 Credits**：catalog（plan versions）、subscription、invoice、entitlement、credits meter。
- **WS5 審計與事件**：per-object history、Outbox、內部 event bus、admin 可視化。
- **WS6 架構與工作流**：模組邊界、Workflow/Saga 引擎（輕量）、可補償步驟、feature flags。

---

## 4. 分期路線圖

### Phase 0 — 打底（1–2 日，低風險）
- 撰寫 **Domain glossary + Invariants**（金錢不變式：sum(debit)=sum(credit) 等）。
- 建立 `docs/` 架構文件；加 **CI 檢查**：禁止 DELETE 金錢表、schema parity。
- 交付：`docs/domain-invariants.md`、CI gate。

### Phase 1 — 財務核心（複式 ledger + hold）（最優先）
- 新表：`ledger_accounts`（學生/平台/教練/場地，多資產）、`ledger_transfers`（雙邊、immutable）、`ledger_holds`（pending）。
- 將現有 4 邊拆賬（學生→平台→教練→場地）表達為 **一次 booking 產生一組平衡 transfers**。
- **Hold 位改用兩階段轉帳**：落單 → pending transfer（凍結 credits）→ 15 分鐘 commit/void。
- 對帳報表：每日/每月平衡檢查。
- 交付：migrations、service、對帳 script、測試（100% 覆蓋核心 flow）。

### Phase 2 — 支付編排
- `payment_intents`（統一 Stripe/FPS/PayMe）、狀態機、adapter、webhook 正規化。
- Reconciliation job（PSP 結算 vs ledger）。
- 交付：intent API、adapters、對帳報表。

### Phase 3 — 預約與排程
- Schedule template → 生成實例（保留現有 pre-generated 兼容）；timezone 統一為 UTC 存 / 顯示本地。
- Booking 狀態機 + 每步寫 event；idempotency 全面覆蓋。
- 交付：availability service、state machine、時間測試。

### Phase 4 — 會籍與 Credits
- `plan_versions`（catalog）、`subscriptions`、`invoices`、`entitlements`。
- Credits 改為 append-only meter → 餘額推導。
- 交付：catalog API、invoice、entitlement check、migration。

### Phase 5 — 審計與事件
- `object_history`、`outbox`、內部 event bus；admin 交易 timeline。
- 交付：history 中間件、timeline UI、事件重放。

### Phase 6 — 架構與工作流
- 抽 Workflow/Saga（booking→payment→ledger→payout，含補償）；模組化邊界。
- 交付：workflow engine、重構核心 route。

---

## 5. Schema 變更建議（重點，非全部）

- `ledger_accounts(id, owner_type[user|platform|coach|venue], owner_id, asset[credits|hkd], created_at)`
- `ledger_transfers(id, hold_id?, debit_account, credit_account, amount, asset, state[pending|posted|void], ref_type, ref_id, created_at)` — **immutable，只准加 pending→posted/void**
- `ledger_holds(id, booking_id, amount, asset, expires_at, state)`
- `payment_intents(id, user_id, booking_id, amount, currency, method, psp, psp_ref, state, created_at)`
- `booking_events(id, booking_id, from_state, to_state, actor, meta, created_at)`（append-only）
- `plan_versions(id, plan_key, version, price_hkd, credits_granted, features_json, effective_from)`
- `invoices(id, user_id, period, lines_json, total, state)`；`subscriptions(...)`
- `credit_events(id, user_id, delta, reason, ref, created_at)`（append-only，餘額由聚合）
- **沿用現有保護**：所有金錢表 DELETE trigger；audit_log append-only。

---

## 6. 唔好抄嘅嘢（避免過早複雜化）
- **唔即上 microservices / Kafka**：SQLite + 模組化單體 + Outbox 已足夠，將來先換 Postgres/隊列。
- **唔照搬 Cal.com 全功能**（團隊/round-robin 等）：只取 availability + idempotency。
- **唔重寫前端**：v2 已完成；v3 專注後端交易核心。
- **唔引入重 framework 綁死**：保持零 lock-in。

---

## 7. 風險與合規
- **遷移風險**：現有真實金錢資料 → 先 DB `.backup`、雙寫校驗、再切換真相來源（灰度）。
- **一致性**：ledger 為真相，其他表可重建；提供 rebuild script。
- **合規**：所有交易不可刪、可追溯；對帳報表可交會計師。
- **改動安全**：每 phase 獨立 branch + 測試 + 灰度，唔影響生產。

---

## 8. 成功指標
- 記帳：任何時間 `sum(debit) == sum(credit)`（0 例外）。
- 交易：每筆 booking 有完整 timeline（誰/幾時/乜狀態）。
- 對帳：PSP 結算 vs ledger 日差 = 0。
- 可審計：會計師可於無需工程協助下完成抽樣核對。
- 效能：核心 flow p95 < 300ms。

---

## 9. 建議
**即刻可做（低風險、高回報）**：Phase 0 + Phase 1（財務核心 + hold 兩階段轉帳）。其餘按階段推進。
