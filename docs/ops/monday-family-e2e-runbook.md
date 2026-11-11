# 週一真實家庭 E2E 驗收手冊（校正版）

> 依 2026-11-11 生產實況校正。所有 SQL 已改為**真實表名／欄位名**，可直接貼上執行。
> 系統狀態：commit `96ccd2c`、`PHONE_VERIFY_ENFORCE=0`（軟閘，**已寫入 backend/.env 並重啟生效**）、health 200。

## 0a. 帳號已鎖定（2026-11-12 01:48 寫入生產 DB）

| 角色 | 姓名 | 電話 | user id | 備註 |
|---|---|---|---|---|
| 付款人（女兒） | **陳小姐** | **91234567** | `seed-sandbox-stu-b` | 原本叫「李淑芬」，已改名；`phone_verified_at` 已設 |
| 上課長者（父親） | **陳大文** | **98765432** | `seed-sandbox-stu-a` | 新帳號已存在（非 98764532）；`phone_verified_at` 已設 |

> ⚠️ 父親號碼 **尾四碼係 5432（98765432）**，不是 98764532。腳本、WhatsApp、後台一律用這組。
> 若現場要重建家庭組：先用 `/family.html`（陳小姐登入）建「陳氏家庭健康通票」，再綁 98765432。

**環境現狀確認（貼上即驗）**：
```bash
cd /var/www/zenpass/backend && node -e "require('dotenv').config({path:'./.env'});console.log('ENFORCE='+(process.env.PHONE_VERIFY_ENFORCE ?? '(unset)'),'NODE_ENV='+process.env.NODE_ENV)"
# 預期：ENFORCE=0 NODE_ENV=production
```
> 註：pm2 `exec cwd` = `/var/www/zenpass/backend`，所以 `.env` 就在 cwd，app 確實載入得到。
> prodtest 測試資料已 **soft-cancel**（`class_schedules` / `coach_earnings` status='cancelled'，classes inactive），無任何 DELETE。


## 0. 環境事實（照抄原始手冊會失敗的地方）

| 原始手冊 | 生產實際 |
|---|---|
| DB `/var/www/zenpass/data/zenpass_production.db` | **`/var/www/zenpass/backend/data/zenpass.db`** |
| `pm2 env 1424` | pm2 名 **`zenpass-api`**；`pm2 env $(pm2 id zenpass-api)` |
| `user_passes.total_units / remaining_units` | **`total_credits / remaining_credits`** |
| `user_passes.student_user_id` | **`user_id`**（使用人）＋ `owner_user_id`（付款人） |
| `user_passes.price_paid_cents` | **`price_paid`（HKD 浮點）**；暫無 cents 欄位 |
| `bookings.session_id / student_user_id` | **`schedule_id / user_id`** |
| `coach_earnings.amount_cents` | **`net_amount_cents`** |
| `coach_earnings.earning_type='teaching_share_80'` | **`class_teaching`**（預設） |
| `audit_log.action / target_id` | **`action_type / entity_id`** |

## 1. 前置檢查（VPS）

```bash
# 1) 軟閘已開
pm2 env $(pm2 id zenpass-api) | grep -E 'NODE_ENV|PHONE_VERIFY_ENFORCE'
# 預期：NODE_ENV=production（PHONE_VERIFY_ENFORCE 由 dotenv 載入，唔會出現在 pm2 env；
#       用下面 runtime 檢查）

cd /var/www/zenpass/backend
node -e "require('dotenv').config({path:'../.env'});console.log('ENFORCE='+process.env.PHONE_VERIFY_ENFORCE)"

# 2) 測試班次（如未建立，用真班次 ID）
sqlite3 data/zenpass.db \
 "SELECT id,start_time,end_time,max_participants,enrolled_count,booking_open,status
    FROM class_schedules WHERE id='sch_live_verify_001';"
```

> 若 `sch_live_verify_001` 不存在：**唔好硬插測試班落生產**。用現有真實班次（`status='available'`、未來時間、`booking_open=1`），或由教練用 `/coach-schedule.html` 開一班真班，完成後照常保留（屬真實營運數據，不是 prodtest）。

## 2. 階段 A：管理員簽發 → 家庭扣堂 → 點名分帳

### A1 女兒建家庭群組 + 綁定父親
前端：`/family.html` → 建立群組 → 新增家人（父親 8 位電話，稱謂「父親」，可扣堂）。

核對：
```bash
cd /var/www/zenpass/backend
sqlite3 -box data/zenpass.db "
SELECT fg.id AS group_id, fg.group_name, ow.name AS owner, ow.phone AS owner_phone,
       mb.name AS member, mb.phone AS member_phone, fm.relation_title, fm.can_consume_pass
  FROM family_groups fg
  JOIN users ow ON ow.id=fg.owner_user_id
  LEFT JOIN family_members fm ON fm.family_group_id=fg.id
  LEFT JOIN users mb ON mb.id=fm.member_user_id
 WHERE ow.phone='91234567';"
```
預期：1 個 group、1 個 member、`can_consume_pass=1`。

### A2 後台簽發 4 堂 Pass（FPS 線下收款）
`admin-ops.html` → 🎫 通行證 → 簽發；或 API：
`POST /api/passes/admin/issue`（需 `finance.payout.process`）
```json
{ "phone": "91234567", "student_name": "陳小姐", "total_credits": 4,
  "price_paid": 520, "family_group_id": "<A1 group_id>", "valid_days": 60 }
```
核對：
```bash
sqlite3 -box data/zenpass.db "
SELECT id AS pass_id, user_id, owner_user_id, family_group_id,
       total_credits, remaining_credits, price_paid, status, expires_at
  FROM user_passes
 WHERE owner_user_id=(SELECT id FROM users WHERE phone='91234567' LIMIT 1)
 ORDER BY created_at DESC LIMIT 1;"
```
預期：`remaining_credits=4`、`family_group_id` 非 NULL。

### A3 父親報名（或教練加名冊）
前端 `/explore.html` 以父親帳號預約，或在點名冊加入。確認 booking 存在：
```bash
sqlite3 -box data/zenpass.db "
SELECT b.id,b.booking_reference,u.name,b.status,b.payment_type,b.payment_status,
       b.attendance_status,COALESCE(b.amount_cents,ROUND(b.amount*100)) amount_cents
  FROM bookings b JOIN users u ON u.id=b.user_id
 WHERE b.schedule_id='<SCHED>' AND u.phone='98765432';"
```

### A4 教練點名（核心）
`/coach-roster.html?schedule_id=<SCHED>`：
- 父親旁應顯示 `👨‍👩‍👧 使用 [陳小姐] 家庭Pass · 餘 4`
- 勾 Present → 提交

一次核對三張表：
```bash
sqlite3 -box data/zenpass.db "
SELECT 'PASS' AS item, id, total_credits, remaining_credits FROM user_passes
 WHERE owner_user_id=(SELECT id FROM users WHERE phone='91234567' LIMIT 1);
SELECT 'BOOKING' AS item, id, attendance_status, payment_type FROM bookings
 WHERE schedule_id='<SCHED>' AND user_id=(SELECT id FROM users WHERE phone='98765432' LIMIT 1);
SELECT 'EARNING' AS item, schedule_id, coach_id, earning_type, net_amount_cents, payout_month
 FROM coach_earnings WHERE schedule_id='<SCHED>';"
```
預期：`remaining_credits 4→3`、`attendance_status='present'`、`net_amount_cents=11200`（$140×80%，整數）。

### A5 端側同步
- 女兒 `/family.html` → 餘 3
- 父親 `/student-handbook.html` → 課堂記錄出現今日出席

## 3. 階段 B：Stripe 自助購卡 → 自動入家庭

### B1 女兒購卡
`/pass.html` → 4 堂 $520 → 預選家庭群組 → Stripe Hosted Checkout → 測試卡 `4242 4242 4242 4242`、任意未來月、CVC 123。

> 現時 Stripe 仍係 **test key**；如 `STRIPE_SECRET_KEY` 未配置會回 503，唔會假成功。

### B2 核對自動發卡
```bash
sqlite3 -box data/zenpass.db "
SELECT up.id,up.pass_type,up.total_credits,up.remaining_credits,up.price_paid,
       up.family_group_id,up.payment_intent_id,up.created_at,
       (SELECT action_type FROM audit_log a WHERE a.entity_id=up.id ORDER BY a.created_at DESC LIMIT 1) AS last_audit
  FROM user_passes up
 WHERE up.owner_user_id=(SELECT id FROM users WHERE phone='91234567' LIMIT 1)
 ORDER BY up.created_at DESC LIMIT 1;"
```
預期：4 堂、`price_paid=520`、`family_group_id` 正確、`payment_intent_id` 唯一。

### B3 堆疊扣堂
第二堂再點名 → 先扣舊卡（3→2），新卡保持 4。

## 4. 邊界檢查

| 場景 | 指令／操作 | 預期 |
|---|---|---|
| 無電話帳號 | 用無 phone 帳號呼叫 `/api/passes/checkout/create-intent` | 403 `PHONE_REQUIRED` |
| 重複完成付款 | 重放同一 `payment_intent_id` `/checkout/complete` | 回傳既有 Pass，不重複發卡 |
| prodtest 隔離 | `SELECT COUNT(*) FROM coach_earnings WHERE schedule_id LIKE 'prodtest-%';` | 0 |
| 家庭 Pass 越權 | 非付款人嘗試把他人 Pass 加入群組 | 403 |

## 5. 一鍵核對腳本（3 秒定生死）

```bash
cd /var/www/zenpass
bash zenpass-tester/scripts/family-e2e-check.sh 91234567 98765432 <SCHED>
```

只讀，不改任何資料。輸出 ①–⑦ 段（帳戶、家庭、Pass、班次、預約、收益、審計）＋ **七大指標 PASS/FAIL 總計**：

- `🎉 家庭閉環全綠 — 可簽核` + exit code 0 → 即刻簽核
- `⚠️ 有項目未達標` + exit code 1 → **唔好簽核**，照輸出逐項排查

判讀基準：Pass 餘額 4→3、`attendance_status=present`、`net_amount_cents=11200`（整數）、prodtest 全 0。

> 💡 唔記得班次 ID？用真班次即可：
> ```bash
> sqlite3 -box backend/data/zenpass.db "SELECT id,start_time,enrolled_count,booking_open
>   FROM class_schedules WHERE datetime(start_time) > datetime('now') AND booking_open=1
>   ORDER BY start_time LIMIT 5;"
> ```

## 5b. 週一開場三分鐘（照順序貼）

```bash
# ① 服務與軟閘狀態
cd /var/www/zenpass && curl -s -o /dev/null -w 'health %{http_code}\n' localhost:3001/api/health
cd /var/www/zenpass/backend && node -e "require('dotenv').config({path:'./.env'});console.log('ENFORCE='+(process.env.PHONE_VERIFY_ENFORCE ?? '(unset)'))"

# ② 確認無 prodtest 污染（未作廢者）
sqlite3 /var/www/zenpass/backend/data/zenpass.db \
  "SELECT (SELECT COUNT(*) FROM class_schedules WHERE id LIKE 'prodtest-%' AND status<>'cancelled')
        + (SELECT COUNT(*) FROM coach_earnings  WHERE schedule_id LIKE 'prodtest-%' AND status<>'cancelled');"

# ③ 跑閉環核對
cd /var/www/zenpass && bash zenpass-tester/scripts/family-e2e-check.sh 91234567 98765432 <SCHED>
```

⚠️ **軟閘提醒**：`backend/src/services/phone-gate.js` 的判定是
`NODE_ENV==='production' && PHONE_VERIFY_ENFORCE !== '0'`。
即係：生產環境只要 `PHONE_VERIFY_ENFORCE` **未設**，就會**強制驗證電話**。
若第一步印出 `ENFORCE=(unset)`，週一驗收前要先設定：`PHONE_VERIFY_ENFORCE=0` 並重啟 `zenpass-api`。

## 6. 驗收簽署

| # | 項目 | 通過 |
|---|---|---|
| 1 | 家庭群組建立＋父親綁定 | ☐ |
| 2 | 4 堂 Pass 綁定家庭（`total_credits=4`） | ☐ |
| 3 | 點名扣堂 4→3、`attendance_status=present` | ☐ |
| 4 | 教練收益 11200 cents（整數） | ☐ |
| 5 | Stripe 自助購卡自動發卡＋掛家庭 | ☐ |
| 6 | 堆疊扣堂次序正確（舊卡先） | ☐ |
| 7 | 無電話 403、重複付款不重發、prodtest=0 | ☐ |
