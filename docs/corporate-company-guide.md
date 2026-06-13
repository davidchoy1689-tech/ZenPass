# 🏢 ZenPass 企業健康計劃 — 使用指南

> 一個Pass，全公司通行全城運動體驗。

---

## 一、點樣開始？

### 1.1 企業註冊
1. 聯絡 ZenPass（2387 0724 / support@zenpass.hk）開通企業帳戶
2. 提供：公司名稱、聯絡人、電郵、電話
3. 確定每月 Credit 分配及 billing cycle
4. Admin 喺後台開通帳戶 + 設定每月 Credits

### 1.2 加值 Credits
- 每月自動分配（每月 1 號 Reset）
- 或按需要額外加值
- 每 1 Credit = HK$8

### 1.3 設定員工上限（可選）
- Admin 可以為每位員工設定每月使用上限
- 例：每人每月上限 100 Credits
- 唔 set = 冇上限

---

## 二、員工點用？

### 2.1 登入
- Admin 批量開戶後，員工會收到電郵
- 臨時密碼：`zpXXXXXX!`
- 首次登入後可更改密碼

### 2.2 預約課程
1. 登入 ZenPass → 探索課程
2. 揀選課程 + 時段
3. 付款方式揀 **「🏢 公司 Credits」**
4. 系統會見到：公司名稱 + 剩餘 Credits + 每月用量
5. 確認預約 ✅

### 2.3 付費邏輯（自動混合）
系統自動計算：

```
例子：一堂 12 Credits
情況 A：公司夠 + 未超每月上限
→ 公司俾 12 Credits，自己俾 0 ✅

情況 B：公司夠但超每月上限（上限 10/月）
→ 公司俾 0，自己俾 12 Credits ✅

情況 C：公司剩 5 Credits
→ 公司俾 5，自己俾 7 Credits ✅

情況 D：公司 0 + 自己都唔夠
→ ❌ 需先購買 Credits
```

### 2.4 查看用量
員工可以喺 booking 頁見到：
- 🏢 公司名 + 剩餘公司 Credits
- 📊 本月已用 / 每月上限
- 💰 自己嘅 Credits 餘額

---

## 三、每月 Reset 機制

### 3.1 點運作？
- **每月 1 號凌晨**：credit_used 歸零
- 上個月未用嘅 Credits **自動過期**
- 員工每月用量紀錄同時 reset

### 3.2 原因
> Use it or lose it！
- 員工有 incentive 去 book 堂
- 公司 budget predictable
- 唔怕囤 Credits 唔用

### 3.3 Admin 睇到嘅資訊
- 每間公司：上次 reset / 下次 reset 日期
- 上個月 expired credits 數量
- 每位員工每月用量

---

## 四、Admin 操作

### 4.1 後台功能
| 功能 | 位置 |
|:----|:----|
| 新增企業 | 🏢 企業計劃 → + 新增企業 |
| 加值 Credits | 㩒公司名 → 💰 加值 Credits |
| Set 員工上限 | 㩒公司名 → 員工列表 → 輸入每月上限 |
| 批量新增員工 | 㩒公司名 → 批量新增 |
| 手動 Reset | 㩒公司名 → Reset Now |
| 用量報表 | 🏢 企業計劃 → 詳情 |

### 4.2 設定 billing cycle
每個月 / 每季 / 每年 — 喺建立時揀。

---

## 五、常見問題

**Q：員工離職點處理？**
A：Admin 可以喺後台將員工標記為 inactive。

**Q：員工自己嘅 Credits 同公司 Credits 點分？**
A：完全分開。公司 Credits 用公司池，個人 Credits 用自己戶口。Hybrid 模式會自動混合俾錢。

**Q：Reset 之後 Credits 去邊？**
A：未用嘅 Credits 自動到期消失。每月 allocation 係「呢個月俾你咁多，用唔晒冇得留」。

**Q：可唔可以提早 Reset？**
A：Admin 後台有「立即 Reset」掣，隨時可以手動 trigger。

**Q：員工睇唔睇到公司仲有幾多 Credits？**
A：睇到。預約時會顯示公司名 + 剩餘 Credits + 每月用量。

---

## 六、技術流程總結

```
每月 1 號
  ↓
✅ credit_used = 0（公司池 reset）
✅ monthly_credit_used = 0（員工用量 reset）
✅ audit_log 記錄 expired credits

員工 booking
  ↓
✅ 檢查公司池夠唔夠
✅ 檢查員工每月上限
✅ 自動混合公司 + 個人 Credits
✅ Audit log + blockchain 記錄

每日 scheduler
  ↓
✅ 每 15 分鐘檢查到期 reset
✅ 自動處理
```

---

有問題可以聯絡 support@zenpass.hk 或 2387 0724。
