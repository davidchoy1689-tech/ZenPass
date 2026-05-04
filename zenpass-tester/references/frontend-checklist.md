# ZenPass 前端測試清單

## 1. 課程頁 (courses.html / explore.html)

| 測試項目 | 檢查點 |
|---------|--------|
| 課程列表顯示 | 所有課程正常渲染，無空白/斷裂 |
| 分類篩選 | 瑜伽 / 健身 / 新興運動 / 伸展 / 冥想 過濾正確 |
| 難度篩選 | beginner / intermediate / advanced 過濾正確 |
| 價格範圍 | 價格顯示正確，格式 `$120` |
| 課程搜尋 | 搜尋關鍵字後結果正確（中英皆可） |
| 課程卡片 RWD | 手機一欄、平板兩欄、桌面三欄以上 |
| 課程詳情頁 | class-detail.html 載入正確、顯示時段、教練資料 |
| Loading 狀態 | 數據載入中的 spinner/skeleton |
| Error 狀態 | API 錯誤時的優雅降級（非白屏） |

## 2. 會員頁 (membership.html / my-membership.html)

| 測試項目 | 檢查點 |
|---------|--------|
| 會籍計劃顯示 | trial / standard / unlimited 計劃清晰顯示 |
| 價格顯示 | 所有價格顯示正確 |
| 升級流程 | 點擊升級按鈕後導向付款流程 |
| 會籍狀態 | 當前會籍狀態正確顯示（active / expired / none） |
| 到期日 | 會員到期日期正確顯示 |
| RWD | 手機/平板/桌面排版正確 |

## 3. 搜尋功能 (explore.html)

| 測試項目 | 檢查點 |
|---------|--------|
| 關鍵字搜尋 | 輸入關鍵字後結果即時更新 |
| 空結果 | 搜尋無結果時顯示「沒有找到相關課程」提示 |
| 中英文搜尋 | 同時支援中英文課程名稱搜尋 |
| 分類+搜尋組合 | 篩選分類 + 關鍵字搜尋組合正常 |
| 搜尋速度 | 輸入後 300ms 內顯示結果（debounce） |

## 4. 預約流程

| 測試項目 | 檢查點 |
|---------|--------|
| 課程詳情 → 選時段 | 時段選擇器正確列出所有可預約時段 |
| 時段衝突 | 已滿的時段顯示「已滿」無法選擇 |
| 預約確認 | 預約成功後顯示確認訊息 |
| 我的預約 | my-bookings.html 顯示用戶所有預約 |
| 取消預約 | 取消功能正常運作 |
| 付款整合 | 預約後導向付款頁面正確 |

## 5. 登入/註冊

| 測試項目 | 檢查點 |
|---------|--------|
| 登入表單 | email + password 驗證正確 |
| 登入錯誤 | 錯誤 credentials 顯示友好錯誤訊息 |
| Token 儲存 | localStorage 儲存 token |
| 登出 | 清除 token，返回登入頁 |
| 自動登入 | 已有 token 時自動跳過登入頁 |
| 註冊流程 | register-coach.html 完整可用 |

## 6. 管理後台 (admin.html)

| 測試項目 | 檢查點 |
|---------|--------|
| Dashboard 統計 | 數字正確、無 NaN/undefined |
| 用戶列表 | 所有用戶顯示，學號格式 US- 正確 |
| 課程列表 | 課程編號 CL-、教練編號 US- 正確顯示 |
| 預約列表 | 預約編號 ZP-、學生編號、課程編號正確 |
| 付款管理 | Pending payments 列表正常，Approve/Reject 可用 |
| auth 安全 | 無 token → 401、錯 token → 403、普通用戶 → 403 |

## 7. 行動版 (Mobile)

| 測試項目 | 檢查點 |
|---------|--------|
| Viewport | `<meta name="viewport">` 存在且正確 |
| Touch 目標 | 所有按鈕/連結觸控區域 >= 44px |
| 水平滾動 | 無意外 horizontal scrollbar |
| 漢堡選單 | 導航在手機上折疊為 hamburger menu |
| 表單輸入 | Input fields 在手機上 zoom 正常 |
| 載入速度 | 3G 網路下首屏 < 3s |

## 8. 性能

| 測試項目 | 目標 |
|---------|------|
| Lighthouse Performance | >= 80 |
| Lighthouse Accessibility | >= 85 |
| Lighthouse Best Practices | >= 90 |
| Lighthouse SEO | >= 90 |
| 最大內容繪製 (LCP) | < 2.5s |
| 首次輸入延遲 (FID) | < 100ms |
| 累積佈局位移 (CLS) | < 0.1 |
