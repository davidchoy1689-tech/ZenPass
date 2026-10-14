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
| 1000 | 現金 | 資產 | 實際收到嘅款項（FPS/PayMe） |
| 1100 | Stripe 待結算 | 資產 | 信用卡待結算 |
| 1200 | 點數收入 | 資產 | 用 Credits 支付 |
| 2001 | 教練應付 | 負債 | 待出糧畀教練 |
| 2002 | 場地應付 | 負債 | 待出糧畀場地 |
| 2000 | 商戶應付款 | 負債 | 一般應付（舊） |
| 3000 | 平台收入 | 收入 | 平台實收 |
| 3100 | 佣金收入 | 收入 | 平台抽佣（舊模型） |
| 5000 | 退款 | 費用 | 退款 |

## 分錄模型（v2.1 四邊拆賬）
每筆已付款 booking → **一組平衡分錄**（`postBookingSplitLedger`）：
```
借 1000/1100/1200 資產      = amount（學生實付）
貸 3000 平台收入            = platform_earned_amount
貸 2001 教練應付            = coach（= amount − 平台 − 場地）
貸 2002 場地應付            = venue_earned_amount
```
- 恆等式：`amount == platform_earned + venue_earned + coach`
- **Idempotent**：同 booking 已有 `payment` 分錄就唔重複
- 舊 `postBookingLedger` 保留向後兼容，內部 delegate 去四邊拆賬

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
4. `platform_earned_amount + venue_earned_amount + coach_earnings == amount`（四邊拆賬，待 v2.1 全面覆蓋）

## 缺口 / 下一步（v2.1+）
- 目前科目未完全反映「四邊拆賬」（學生/平台/教練/場地）；v2.1 擴充科目：1200 教練應付、1300 場地應付。
- Hold 位改兩階段轉帳（pending→commit/void）。
- 每日自動對帳（加入 daily-maintenance 或 cron）。
- `payment_intent` 抽象統一 Stripe/FPS/PayMe。
