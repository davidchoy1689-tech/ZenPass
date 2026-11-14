# ZenPass 業務事件日誌（events.log）

> 目的：任何一張單，可以用 `request_id` / `booking_id` / `idempotency_key` 一條線查完全程。

## 檔案
- `backend/logs/events.log`：JSONL，每行一個業務事件
- `backend/logs/trace.log`：JSONL，每個 HTTP 請求一行（頭尾 + duration）
- 兩者都有 `request_id`，nginx access log 亦有同一個 `$request_id`（edge → app 對得返）

## 自動欄位（AsyncLocalStorage，業務碼唔使手傳）
`ts`, `level`, `msg`, `request_id`, `trace_id`, `route`, `ip`

## 必備事件表（booking 路徑）

| 事件 msg | level | 何時 | 主要欄位 |
|---|---|---|---|
| `rate_limited` | warn | 三維限流擋住 | `dim`(ip/phone/session), `retry_after_sec` |
| `idem_hit` | info | 同一 Idempotency-Key 重放 | `key`, `age_sec` |
| `idem_mismatch` | warn | 同 key 但 payload 唔同 | `key` |
| `booking_created` | info | 訪客落單成功 | `booking_ids`, `seat_count`, `payable_amount`, `phone_hash` |
| `guest_lookup` | info | 電話查單 | `found`, `count` |

## 區段計時（trace.log）
| 欄位 | 意思 |
|---|---|
| `duration_ms` | 整個 HTTP 請求 |
| `booking_write_ms` | 訪客落單寫入 DB 的時間（含逐座位建立） |
| `stripe_ms` | 呼叫 Stripe 建立 Checkout Session 的時間 |

用法：`evlog.startTimer("stripe")` 回傳 `stop()`，停止後自動寫入 context，
`trace.log` 該請求行就會多一個 `stripe_ms`。零依賴、唔影響業務。

## 查單指令

```bash
# 1) 客人提供 booking 編號
grep '"booking_ids":"[^"]*ZP-00xx' backend/logs/events.log

# 2) 客服提供 request_id（截圖 header X-Request-ID）
grep '"request_id":"<id>"' backend/logs/events.log backend/logs/trace.log

# 3) 懷疑重複收費：由 idempotency key 追
grep '"key":"<uuid>"' backend/logs/events.log
```

## 紀律
- **PII**：永不寫原始電話／姓名／卡號；電話只寫 `phone_hash`（sha256+salt 前 16 位）
- **Level**：`info` 業務里程碑、`warn` 429/重試、`error` 5xx/付款異常
- **抽樣**：booking 寫入 / 429 / 付款 **100% 記錄**，唔抽樣
- 保留：trace 14 日、events 30 日（logrotate 自動）
