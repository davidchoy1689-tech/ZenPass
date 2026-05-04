# 常見 Bug 與修復指南

## 1. 參考編號相關

### 舊用戶無 user_reference
- **徵兆：** Users API 回傳 `user_reference: null`
- **原因：** 用戶於 migration 前已存在
- **修復：** 
  ```sql
  UPDATE users SET user_reference = 'US-' || strftime('%Y%m%d','now') || '-' || upper(substr(hex(randomblob(4)),1,4))
  WHERE user_reference IS NULL;
  ```

## 2. CSS/UI 問題

### RWD 響應式斷裂
- **徵兆：** 手機上 table overflow / 按鈕重疊
- **檢查：** `<meta name="viewport">` 是否存在
- **修復：** 
  - Table: `overflow-x: auto` + `white-space: nowrap`
  - 卡片: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`

### 表頭與數據不對齊
- **徵兆：** 管理後台預約管理 / 課程管理
- **檢查：** `td` 數量是否等於 `th` 數量
- **修復：** 對齊表頭與數據行

## 3. 後端問題

### SQLite 無 role column
- **徵兆：** User 回傳 `role: null`
- **原因：** 無 `role` 欄位，用 `is_coach` 判斷
- **修復：** 如需 role 可加欄位或改用 `is_coach + hardcode admin email`

## 4. 載入性能

### JS 未 minify
- **徵兆：** 大型 inline script 阻擋渲染
- **修復：** async/defer 加載，或 bundle/minify

### Font Awesome / Google Font 慢
- **徵兆：** 白屏直到 font 載入
- **修復：** `font-display: swap`，或 self-host
