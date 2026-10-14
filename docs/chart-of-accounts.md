# ZenPass 財務：會計科目表 + 不變式（v2.1）

> 配合 `backend/src/services/accounting.js`（既有複式帳）與 `backend/scripts/ledger-reconcile.js`（對帳）。
> 目的：令金錢流「可審計、可對帳、可交核數師」。

## 記帳原則
- **複式記帳**：每筆交易 `sum(debit) == sum(credit)`。
- **Append-only**：`ledger` 只加、唔改唔刪（DB trigger 保護）。
- **Idempotent**：同一 booking 已有分錄就唔重複寫（`postBookingLedger` 會先 check）。
- **影子模式**：v2.1 之下 ledger 與現有金錢表**並行**，暫未做真相來源；對帳穩定後逐個 flow 切換。

## 會計科目（現行）
| Code | 名稱 | 類型 | 說明 |
|---|---|---|---|
| 1000 | 現金 | 資產 | 實際收到嘅款項 |
| 2000 | 商戶應付款 | 負債 | 平台代收、待出糧畀教練／場地 |
| 3000 | 平台收入 | 收入 | 課程/服務收入 |
| 3100 | 佣金收入 | 收入 | 平台抽佣 |
| 5000 | 退款／折讓 | 費用 | 退款相關（見 accounting.js） |

## 分錄模型（現行）
- **payment**（收款）：借 1000 現金 / 貸 3000 平台收入
- **commission**（抽佣）：借 3100 佣金收入 / 貸 2000 商戶應付款
- **payout**（出糧）：借 2000 商戶應付款 / 貸 1000 現金
- **refund**（退款）：見 `recordRefund`

## 對帳指令
```bash
cd backend
node scripts/ledger-reconcile.js             # 只報告
node scripts/ledger-reconcile.js --backfill  # 補寫未入帳嘅已付款 booking（idempotent）
```
- 退出碼 `0` = 平衡；`1` = 唔平（需跟進）。
- 報告內容：已付款 booking 數、未入帳數、總借/總貸、平衡、各帳戶結餘。

## 不變式（Invariants，任何時間都要成立）
1. `sum(ledger.debit) == sum(ledger.credit)`（全域平衡）
2. 每張已付款 booking 至少有一筆 `payment` 分錄
3. 金錢表只准 INSERT / UPDATE status，不准 DELETE（trigger 保護）
4. `platform_earned_amount + venue_earned_amount + coach_earnings == amount`（四邊拆賬，待 v2.2 全面覆蓋）

## 缺口 / 下一步（v2.2+）
- 目前科目未完全反映「四邊拆賬」（學生/平台/教練/場地）；v2.2 擴充科目：1200 教練應付、1300 場地應付。
- Hold 位改兩階段轉帳（pending→commit/void）。
- 每日自動對帳（加入 daily-maintenance 或 cron）。
- `payment_intent` 抽象統一 Stripe/FPS/PayMe。
