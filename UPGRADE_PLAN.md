# ZenPass 升級計劃 — 參考市場龍頭系統

> 參考對象：ClassPass (8.2M users, 65K venues)、Mindbody (60K+ businesses, 130 countries)
> 更新日期：2026-06-13

---

## 📊 現狀對比

| 功能 | ClassPass | Mindbody | ZenPass |
|:----|:--------:|:--------:|:-------:|
| Credit 預約系統 | ✅ AI dynamic pricing | ✅ | ✅ 二段式定價 |
| 會員制度 | ✅ 5 tiers | ✅ Multi-tier | ✅ 4 tiers |
| 取消罰款 | ✅ $15 (降67% no-show) | ✅ | ❌ |
| AI 推薦 | ✅ 94.3% accuracy | ✅ | ❌ |
| 虛擬/混合課程 | ✅ 35% of bookings | ✅ | ❌ |
| 企業健康計劃 | ✅ 12,500 companies | ✅ | ❌ |
| 自動行銷 (referral) | ✅ | ✅ | ❌ |
| 教練品牌 App | ✅ | ✅ | ❌ |
| POS / 零售 | ❌ limited | ✅ | ❌ |
| 整合 (Zapier等) | ✅ | ✅ | ❌ |
| 管理報表/分析 | ✅ | ✅ | ⚠️ 基本 |
| No-show 防護 | ✅ 67% reduction | ⚠️ | ❌ |

---

## 🎯 優先級劃分

### 🔴 P0 — 直接影響收入 (1-2週)

#### 1. No-Show / 取消罰款系統
**為何重要：** ClassPass 靠 $15 罰款將 no-show 降低 67%，直接影響 revenue + 產能利用率

**執行：**
- `backend/src/rules/penalty-rules.js` — 罰款邏輯 (獨立module)
- 規則：開課前 <4h 取消 → 罰 15cr 或 $120
- No-show（唔出現）→ 罰全數
- 收入分拆：罰款 50% 歸教練 / 50% 歸平台
- 引入 grace period（首次免罰）
- Admin panel 可調整
- 🔗 現有 `bookings.js` → cancel 時檢查時間 + 扣 penalty

**參考：** ClassPass charges $15 cancellation fee + full price for no-shows
**估計：** 3-4 天

#### 2. 企業健康計劃 (B2B)
**為何重要：** ClassPass 12,500 企業客戶是第二大收入來源

**執行：**
- `backend/src/routes/corporate.js` — Corporate API
- 企業主頁 `corporate.html` + `corporate-dashboard.html`
- Employee credit pool（公司埋單俾員工上堂）
- 批量開 account、用量報表
- Invoice / 月結功能

**估計：** 5-7 天

#### 3. Referral 獎賞系統（做返好）
**為何重要：** Mindbody / ClassPass 靠 referral 低成本增長

**執行：**
- ✅ 已有 `referral_codes` table（但未整合到 user flow）
- 加強：分享 referral link → 朋友 join plan → 雙方各得 5cr
- 自動 SMS/WhatsApp/email 發送 referral link
- Dashboard 顯示 referral 績效

**估計：** 2-3 天

### 🟡 P1 — 大幅改善體驗 (2-3週)

#### 4. AI 推薦課程
**為何重要：** ClassPass 94.3% 推薦準確率，用戶月開 app 31次

**執行：**
- `backend/src/services/recommendations.js`
- 根據：user booking history + category 偏好 + 時段偏好 + 教練偏好
- 簡單版本：Rule-based（相同 category + 時段）
- 進階版本：Collaborative filtering（用 SQL）
- Frontend：首頁「推薦給你」section

**參考：** ClassPass uses ML to optimize inventory allocation
**估計：** 3-5 天

#### 5. 動態時段定價 (Dynamic Pricing)
**執行：**
- ✅ 已有 `pricing_config` table + 離峰/一般/高峰定義
- 升級：**動態調整** — 根據該時段剩餘名額自動調整 credit 消耗
- 名額 <20% 剩 → 加價 (demand pricing)
- 名額 >80% 剩 → 減價 (fill-up pricing)
- Admin 可設定上下限

**估計：** 2-3 天

#### 6. 管理報表系統 (Analytics)
**執行：**
- `admin.html` 加新 tab「📊 報表」
- 關鍵 KPI：收入趨勢、課程熱度排行、教練績效、取消率、no-show 率
- 按週/月/季 filter
- CSV export
- 圖表（簡化版 — 用 Chart.js CDN）

**估計：** 3-4 天

### 🟢 P2 — 增值功能 (長期)

| 功能 | 說明 | 時間 |
|:----|:-----|:----:|
| 虛擬課程 / Hybrid | Zoom/Google Meet 整合，link auto-send | 3-4天 |
| 教練品牌 App | Coach-branded mobile PWA | 2-3天 |
| POS 零售模組 | 場地賣嘢 + 積分抵扣 | 3-5天 |
| Zapier 整合 | Webhook → Zapier → 會計/CRM | 2-3天 |
| WhatsApp 通知 | CallMeBot（已有 code，等 API key） | 半天 |
| Telegram Bot Alert | 管理員即時警報（等 token） | 半天 |
| 用戶成就系統強化 | Badges + 社交分享 + leaderboard | 2-3天 |

---

## 🗓️ 執行時間表建議

```
Week 1 (6/13-6/19): P0 — No-Show Penalty + Referral 強化
Week 2 (6/20-6/26): P1 — AI 推薦 + Dynamic Pricing
Week 3 (6/27-7/3): P0 — Corporate B2B (basic)
Week 4 (7/4-7/10): P1 — Analytics + P2 開始
```

---

## ⚡ Quick Wins（即日做到，高回報）

| Item | Effort | Impact |
|:----|:------:|:-----:|
| No-show penalty 2 段式（取消 vs no-show） | 半天 | 高 |
| Referral flow UI 整合（已有 table） | 半天 | 中 |
| WhatsApp notification 啓用（有 code） | 等 David 俾 key | 中 |
| Admin 報表加入基本取消率 | 半天 | 中 |
| 首頁加「推薦給你」用簡單 rule-based | 1天 | 中 |
