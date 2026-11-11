# 金流對帳與營運監控（Phase 2.1-RECON）

## 自動機制
| 工作 | 頻率 | 位置 |
|---|---|---|
| 掉單補償 Worker | 每 5 分鐘 | `services/fulfillment-worker.js`（`index.js` 啟動） |
| 指數退避 | 1 / 2 / 4 / 8 分鐘 | `next_retry_at` 欄位 |
| 5 次失敗熔斷 | 自動 | `status='failed_manual_review'` |
| 每日對帳 | HKT 00:00–00:59 每小時檢查一次 | `services/daily-reconciliation.js`；UNIQUE date 保證 idempotent |
| 差額警報 | 對帳時 | Telegram（需 bot 設定），否則只寫 log/報表 |

## API
```bash
# 健康摘要（admin 或本機）
curl -s http://localhost:3001/api/admin/ops/health-summary
# 手動跑 Worker
curl -s -X POST http://localhost:3001/api/internal/cron/fulfillment-worker -d '{}' -H 'content-type: application/json'
# 手動跑對帳（可指定日期 YYYY-MM-DD）
curl -s -X POST http://localhost:3001/api/internal/cron/daily-reconciliation -d '{}' -H 'content-type: application/json'
# 對帳報表
curl -s http://localhost:3001/api/admin/reconciliation/reports -H 'authorization: Bearer <admin>'
```

## 判讀
- `queue_metrics.pending_count` > 0：Worker 會自動處理；連續 5 次失敗會轉 `failed_manual_review`。
- `failed_manual_review` > 0：需人手 `POST /api/admin/fulfillments/:id/retry`。
- `last_reconciliation.status='discrepancy_flagged'`：Stripe 實收與 `user_passes` 不符，先查 `details` JSON。
- `stripe_unavailable: true`：未配置 Stripe 或 API 失敗，該日以 DB 總額作基準（不會誤報差額，但不可視為已與銀行對帳）。

## 已知邊界
- Stripe 對帳只計 `payment_intent` 且 `currency='hkd'`、`status='succeeded'`；退款/爭議未納入。
- `user_passes` 只計有 `payment_intent_id` 的簽發（管理員人手簽發、企業 Pass 不計）。
- Stripe API 分頁上限 20 頁（每頁 100），足夠日交易 < 2,000 筆；超過需改為報表 API。
- 對帳不會自動修正任何金額；只標記，等人手處理。
