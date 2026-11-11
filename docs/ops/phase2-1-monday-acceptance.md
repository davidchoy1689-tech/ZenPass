# Phase 2.1 週一驗收 Runbook — 家庭 Pass 全鏈路

> 2026-11-17（週一）· 生產 `https://zenpass.hk` · pm2 `zenpass-api`
> 目標：先以人手簽發跑通扣堂／對賬，再以 Stripe Test Mode 跑通零人手自動發卡。

## 0. 開跑前檢查（5 分鐘）

```bash
ssh zenpass-vps "pm2 jlist | grep -A2 zenpass-api; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health"
curl -s https://zenpass.hk/api/passes/plans
```

- [ ] health 200
- [ ] `/api/passes/plans` 回傳 `pack_4` 52000 cents、`pack_8` 96000 cents
- [ ] Stripe 仍為 **test key**（`sk_test_`），不要用真卡
- [ ] 確認測試家庭／學員不會混入正式對賬：測試班 `prodtest-%`、`VERIFIED_TEST%`

---

## A. 上午：最穩流程（人手簽發）

1. 女兒登入 → `https://zenpass.hk/family.html`
2. 建立家庭群組，加入父親 8 位電話（父親必須已登記）
3. 後台 `admin-ops.html` → 🎫 通行證
   - 電話：女兒
   - 姓名：女兒
   - 堂數：4
   - 實收：520
   - 有效日數：60
   - 備註：`PHASE21_ACCEPTANCE_A`
   - 簽發後到 `family.html` 把 Pass「加入家庭」
4. 教練 `coach-roster.html` 為父親點名 Present
5. 驗證：
   - [ ] Roster 顯示「👨‍👩‍👧 使用 [女兒] 家庭Pass · 餘 3」
   - [ ] 女兒 `family.html` / `my.html` Pass 4 → 3
   - [ ] 父親 `student-handbook.html` 見到出席紀錄
   - [ ] 教練收益報表按班次正確歸帳（整數 cents）

### SQL 核對

```sql
-- 家庭 Pass
SELECT id,user_id,owner_user_id,family_group_id,total_credits,remaining_credits,price_paid,payment_intent_id
FROM user_passes WHERE notes LIKE '%PHASE21_ACCEPTANCE_A%';
-- 扣堂紀錄
SELECT * FROM pass_redemptions WHERE pass_id='<pass_id>';
-- 點名
SELECT id,user_id,schedule_id,status,payment_status FROM bookings WHERE schedule_id='<schedule_id>';
```

---

## B. 下午：Stripe Test Mode 全自動

1. 女兒登入 → `https://zenpass.hk/pass.html`
2. 選「4 堂全家健康通行 Pass」→ 選家庭群組 → 即時付款 HK$520
3. Stripe Checkout 測試卡：
   - 卡號 `4242 4242 4242 4242`
   - 任意未來到期日、任意 3 位 CVC、任意郵編
4. 付款完成會自動回跳 `pass.html?pass_success=1&session_id=...`
5. 驗證：
   - [ ] 畫面顯示「✅ 購買成功！4 堂 Pass 已入賬，家人已可即時扣堂」
   - [ ] `user_passes` 新增一筆：4 堂、520、`payment_intent_id` 非空、`family_group_id` 正確
   - [ ] 重刷 `pass.html` 不會重複發卡（idempotent）
   - [ ] 父親 roster 即時顯示「餘 4」
   - [ ] 點名 Present 後變「餘 3」
   - [ ] Webhook 與前端回跳其中一條先到都不會重複發卡

### SQL 核對

```sql
SELECT id,user_id,owner_user_id,family_group_id,total_credits,remaining_credits,
       price_paid,payment_intent_id,pass_type,created_at
FROM user_passes ORDER BY datetime(created_at) DESC LIMIT 5;

SELECT id,status,amount_total,payment_status
FROM stripe_sessions WHERE id='<session_id>'; -- 若有此表
```

### 防重複測試

在瀏覽器 console 或 API 重 call：

```js
await api.post('/passes/complete-checkout', { session_id: '<session_id>' })
```

- [ ] 第二次回 200 + `duplicated:true`，`user_passes` 總數不變

---

## C. 驗收後清理（不刪金錢紀錄）

- 測試 Pass：不改 `remaining_credits`，加 `notes` 標記 `PHASE21_ACCEPTANCE_DONE`
- 測試 family group：改名加 `[TEST]` 前綴，不刪
- 測試 booking：如屬正式班，保留出席紀錄；如屬 sandbox，`status=cancelled` 並寫原因
- 嚴禁 `DELETE` `user_passes` / `pass_redemptions` / `bookings` / `audit_log`

---

## D. 失敗處理

| 症狀 | 先查 | 處理 |
|---|---|---|
| 付款成功但未發卡 | Stripe webhook 是否到達；`/api/passes/complete-checkout` 回應 | 用 session_id 手動 call complete；檢查 `payment_intent_id` 唯一索引 |
| 重複發卡 | `user_passes.payment_intent_id` | 應有 unique index；重複則停用多出 Pass 並 audit |
| 父親 roster 無家庭 Pass | `family_members`、`family_groups.owner_user_id`、Pass `family_group_id` | 修正綁定，不重發 Pass |
| 扣錯個人 Pass | `findApplicablePass` 次序 | 應本人優先；如錯，restore 後重新點名 |
| 金額不符 | Stripe session amount_total | 必須 52000；否則拒絕發卡 |

---

## E. 完成簽核

- [ ] A 段全過
- [ ] B 段全過
- [ ] 對賬報表總額無漂移（排除 `prodtest-%` / `VERIFIED_TEST%`）
- [ ] David 確認可切 Live Key

切 Live Key 需要：
1. `STRIPE_SECRET_KEY=sk_live_...`
2. `STRIPE_WEBHOOK_SECRET=whsec_...`（Live endpoint）
3. `pm2 restart zenpass-api`
4. 用 HK$1 真卡／Apple Pay 做一次退款測試
