# ZenPass UI 升級建議

> 2026-10-12 ｜ 目標：視覺同體驗升級到「企業級 / 可上市」水平，**唔推倒重來**。
> 現況：~50 個 HTML 頁、`frontend/css/zenpass.css`（1618 行共用樣式）、mobile-first PWA（max-width 480px、bottom-nav、dark mode）。

---

## 0. 一句總結
**唔換 framework**（React/Next 重寫風險太大、唔值）。用 **Tailwind + DaisyUI 元件層** 統一視覺，booking 流程照 **Cal.com** 重做，admin 參考 **shadcn-admin / Mazer**。目標係「同一個 design system、每個 page 一致、手機手感一流」。

---

## 1. 現況盤點
- 已有品牌 token（橙 `#ff6b35` 系、中性灰、語意色、shadow、radius 8–24px、Inter/Noto Sans TC）— **底子好**。
- 已引入 Tailwind CDN（部分頁）；`membership-tailwind.html`、`design-prototype.html` 有探索版。
- 主要頁：`index` / `explore` / `courses` / `class-detail`（2260 行）/ `booking` / `my-bookings` / `membership` / `wallet` / `checkin` / `admin`（5315 行）/ `partner-dashboard`（3076 行）。

## 2. 主要問題（體感 + 一致度）
1. **唔一致**：各頁自寫 inline style / 每頁 layout 不同；`theme-color` 仲有紫色 `#7C3AED`（品牌係橙）。
2. **元件靠複製**：按鈕／卡片／輸入框每頁抄一份 → 改一次要改幾十頁。
3. **Booking UX 未夠好**：揀課程 → 揀時段 → 付款 → 確認，多步、狀態提示不足、手機易迷路。
4. **狀態（loading / empty / error）** 唔統一。
5. **Typography scale／間距唔系統**：字級同 spacing 靠手感。
6. **無障礙**：focus ring、tap target（≥44px）、對比度未系統化。

## 3. 建議方向（揀 1）
| 方案 | 內容 | 適合 | 成本 |
|---|---|---|---|
| **A（推薦）** | 保留純 HTML/CSS，導入 **Tailwind + DaisyUI**（CDN 或 build），抽出 component class | 想快、唔重寫 | 低-中 |
| B | 升級做 **Vue/React + shadcn/ui** SPA | 長遠大重構 | 高 |
| C | 只做 CSS 微調（唔導入元件庫） | 只想快修 | 低 |

→ **採 A**：即刻可用、風險低、又可循序漸進升級。

## 4. 設計語言（Design Tokens）
沿用現有變數，補齊一層 **semantic token**：
- **Color**：brand(orange) / success / warning / danger / info；surface / surface-2 / border / text / text-muted（light+dark 兩套）。
- **Type scale**：12 / 14 / 16 / 18 / 20 / 24 / 30（行高 1.4–1.5）；中英混排用 Noto Sans TC + Inter。
- **Spacing**：4 的倍數（4/8/12/16/20/24/32）。
- **Radius**：input 12、card 16、sheet 24、pill 999。
- **Shadow**：沿用 sm/md/lg；卡片統一 md。
- **Motion**：150–220ms ease-out；sheet 由下升上。
- **Tap target ≥ 44×44、focus-visible ring 統一 2px**。

## 5. 逐頁建議

### 🏠 首頁 `index.html`
- Hero 簡化，一個主 CTA（「即刻預約」）。
- 課程卡統一（圖 16:9、標題 1 行、價/credit 右對齊、狀態 chip）。
- 加「今日熱門 / 你附近 / 新上架」分區（拉 segment）。
- 底部 bottom-nav 固定，active 有品牌色。

### 🔍 探索/課程 `explore.html` `courses.html`
- 頂部 **搜尋 + filter chips**（運動類型、地區、時段、價位）。
- 卡片 grid 2 欄（手機），skeleton loading。
- 空狀態 + 「清除 filter」。

### 📄 課程詳情 + 預約（最重要）`class-detail.html` `booking.html`
**參考 Cal.com 流程**，改成清晰 **3 步：選時段 → 確認 → 付款**：
- 頂部 sticky：課程名 + 價 / credit。
- **時段選擇**：日曆（有班嘅日子 highlight + 剩位數），揀完顯示時段列表。
- **確認頁**：清楚列 amount / credits / 取消政策（「開課前一日可取消」）。
- **付款頁**：payment method tabs（信用卡/FPS/PayMe/credits），**15 分鐘倒數清晰顯示**（你已有 hold 機制）。
- **成功頁**：預約號 + 「加入日曆」+ 分享。
- 全程：**stepper 進度、每步可返回、錯誤 inline 顯示、loading spinner**。

### 📅 我的預約 `my-bookings.html`
- 分 **即將 / 已完成 / 已取消** tabs。
- 每張卡：狀態 chip（confirmed/pending/attended/no_show）、時間、**取消 / 簽到 / 評價** 動作。
- pending 付款 → 明顯「繼續付款」CTA（配合 hold 倒數）。

### 👤 會員 / 錢包 `membership.html` `wallet.html` `buy-credits.html`
- Plan 卡對比表（credits / 月費 / 每堂折算 / 折扣），推薦 plan 高亮。
- 錢包：餘額大字 + 交易列表（+/- 色分）+ top-up 一鍵。

### 📍 簽到 `checkin.html`
- 大圓形「簽到」按鈕；未到範圍顯示距離提示（geofence 100m）。

### 🖥️ Admin `admin.html` / `partner-dashboard.html`
- **參考 `satnaing/shadcn-admin` 或 `Mazer`**：左 sidebar（desktop）/ drawer（mobile）、頂 bar（搜尋+通知+用戶）。
- Dashboard：KPI 卡（GMV、訂單、新客、NPS）+ 圖表 + 表格（排序/分頁/匯出）。
- 表單／modal 統一；danger 操作二次確認。
- 沿用你已有嘅 mobile hamburger overlay 設計。

## 6. 元件清單（抽成共用 class / 元件）
Button（primary/secondary/ghost/danger, 3 尺寸）、Input/Select/Textarea（含 error)、Card、Chip/Badge（狀態色）、Tabs、Bottom-sheet/Modal、Toast、Skeleton、Empty-state、Stepper、Calendar、Avatar、Stat/KPI card、Table、Bottom-nav、Header。

## 7. 分階段 Roadmap
- **P0 快贏（1–2 日）**：修 `theme-color`；統一按鈕/卡片/輸入框 base class；統一 loading/empty/error；重寫 `class-detail` + `booking` 成 3 步（Cal.com 風）。
- **P1（3–5 日）**：導入 Tailwind+DaisyUI；首頁 / explore / my-bookings / wallet 統一；mobile QA（每頁 44px tap、focus ring）。
- **P2（1–2 週）**：admin + partner-dashboard 升級（shadcn-admin 風格）；圖表；深色模式全覆蓋；a11y 掃描（Lighthouse）。
- **P3**：微互動（過場、success 動畫）、PWA 離線、效能（LCP）。

## 8. 風險 / 注意
- 唔好一次過改 50 頁 → 分頁 + 每頁 screenshot 回歸（已有 `zenpass-tester` 截圖腳本）。
- admin / class-detail 極大（5k / 2.2k 行）→ 改動要細步 + 測試。
- Tailwind CDN 用於 production 有警告 → 長遠改 build（或 DaisyUI CDN 版）。
- 保持 SEO / GA / PWA manifest 不受影響。

## 9. 參考對應
- Booking 流程：**Cal.com**（calcom/cal.com）
- Admin：**satnaing/shadcn-admin**（shadcn 風）、**Mazer**（純 HTML+Bootstrap，最易套）、**AdminLTE**（老牌）
- 元件層：**DaisyUI**、**Meraki UI**、**Flowbite**（純 CSS）
- 長遠 SPA：**shadcn-ui/ui** + **nextjs/saas-starter**
- Landing/推廣：**cruip/tailwind-landing-page-template**
