# 教練公開專頁 v1.1 — 銀髮／伸展／1對1 PT 本地 SEO 擴充（Addendum）

> 母文件：`docs/coach-public-profile-mvp.md`（v1，2026-10-28）
> 本文件：David 2026-10-28 21:09 需求增補 ｜ 狀態：**規格待開發（代碼凍結中，11/04 開工）**
> 定位轉變：由「泛教練名片」收窄為 **「香港銀髮樂齡 × 痛症伸展 × 1對1 PT」獲客引擎**

---

## 1. 客群與場景（已定）

| 項目 | 定義 |
|---|---|
| 核心客群 | 55–70 歲退休人士、長俸公務員、腰膝痛／需深層伸展及防肌少症人士 |
| 主力時段 | 週一至五 10:00–16:00（HKT） |
| 產品形態 | 長者小班 4–6 人 ／ 1 對 1 PT |
| 平台價值 | 填補平日日間閒置場地與教練檔期；把「手停口停」變成月費型穩定收入 |

---

## 2. 資料庫增補（相對 v1 的 delta）

### 2.1 新增／調整欄位

| 表 | 欄位 | 型別 | 說明 |
|---|---|---|---|
| users | `coach_slug` | TEXT UNIQUE | v1 已有 |
| users | `public_contact_phone` | TEXT | v1 已有，fallback `users.phone` |
| users | `public_contact_hidden` | INTEGER DEFAULT 0 | v1 已有 |
| users | `service_types` | TEXT (JSON) | `stretching / senior_fitness / pt_1on1 / niche_sports / rehab_posture` |
| users | `target_audiences` | TEXT (JSON) | `seniors / retirees / adults / kids` |
| users | `service_districts` | TEXT (JSON) | `kwun_tong / lai_chi_kok / prince_edward / sha_tin …` |
| class_schedules | `intensity_level` | TEXT DEFAULT 'moderate' | `gentle / moderate / high` |
| class_schedules | `is_offpeak` | ← **建議唔好實體化**（見 §2.3） |

### 2.2 為何放 `users` 而唔放 `coach_credentials`
David 原稿寫 `coach_credentials`。技術上**建議放 `users`**：
- `coach_credentials` 係「資質證明」紀錄，一個教練可以有多筆（換證／多牌照），查公開頁時要 `ORDER BY created_at DESC LIMIT 1`，容易攞錯舊紀錄
- 公開資料（服務類型／對象／地區）本質係「個人檔案」，一對一，放 `users` 確保 join 永遠有值，API 少一個 subquery
- 現有 `coach_credentials.qualified_sports` 繼續做「可發證項目」唯一來源，唔重複

> 如 David 堅持放 `coach_credentials`，實作上可行，但要額外處理多筆紀錄取最新 + NULL 情況；工時 +0.5 日。

### 2.3 `is_offpeak`：唔建議存 DB，改為**查詢時計算**
- 原因：存欄位要 backfill + 每次改班都要重算，跨時區／改時間就會 drift
- 正確做法（SQL，UTC → HKT）：
```sql
-- HK 時間 = UTC+8；strftime('%w') 0=週日
CAST(strftime('%w', cs.start_time, '+8 hours') AS INTEGER) BETWEEN 1 AND 5
AND CAST(strftime('%H%M', cs.start_time, '+8 hours') AS INTEGER) BETWEEN 900 AND 1630
```
- 好處：永遠準確、無 migration 風險；壞處：每次查詢多幾個運算（可忽略，5–20 行）
- **⚠️ 時區坑**：`class_schedules.start_time` 存 UTC（如 `2026-10-31T07:00:00Z` = HKT 15:00）。若直接比較 `strftime('%H', start_time)` 會全部差 8 小時，off-peak 判定全錯。

---

## 3. API 調整（`GET /api/coaches/:slug/profile`）

相對 v1 新增／修改：

```jsonc
{
  "coach": { "slug": "sam-wong", "name": "Sam Wong", "headline": "…" },
  "positioning": {
    "service_types":  [{ "key": "senior_fitness", "label": "銀髮體適能" },
                       { "key": "stretching",     "label": "深層筋膜伸展" },
                       { "key": "pt_1on1",        "label": "1對1 私人訓練" },
                       { "key": "rehab_posture",  "label": "痛症／體態復健" }],
    "target_audiences": [{ "key": "seniors", "label": "銀髮樂齡" }],
    "districts": [{ "key": "kwun_tong", "label": "觀塘" }]
  },
  "trust": {
    "verified_teaching_hours": 128.5,   // ← 定義見下
    "certificates_issued": 64,
    "rating": { "avg": 4.8, "count": 21 }
  },
  "upcoming": [
    {
      "schedule_id": "…", "class_id": "…", "title": "長者深層伸展班",
      "start_time": "2026-11-07T02:00:00Z",
      "hk_time_label": "11/07（六）10:00–11:15",
      "intensity_level": "gentle",
      "is_offpeak": true,
      "price_hkd": 180, "seats_left": 6,
      "venue_name": "新興運動推廣社", "district": "觀塘"
    }
  ],
  "contact": { "whatsapp": "85291234567",
               "prefill": "你好 Coach Sam，我想了解平日日間嘅長者伸展／強肌課堂…" }
}
```

### 3.1 `verified_teaching_hours` 定義（David 原稿 vs v1 有分歧）
- David 原稿：**已完結班次時長總和**（真實授課）
- v1 Spec：證書 `hours` 總和（認證時數）

**建議：兩者都計，但對外顯示前者，另存後者作內部核對**
```sql
-- A. 真實授課（顯示）
SELECT COALESCE(SUM((julianday(cs.end_time) - julianday(cs.start_time)) * 24), 0) AS hours
  FROM class_schedules cs
  JOIN classes c ON c.id = cs.class_id
 WHERE c.coach_id = ? AND cs.start_time < datetime('now');
-- B. 證書認證時數（內部／對賬）
SELECT COALESCE(SUM(hours), 0) FROM certificates WHERE coach_id = ? AND revoked = 0;
```
- 理由：授課時數係「信任背書」，應反映真實付出；若只計證書時數，未發證的班會被低估，容易被教練質疑造假

---

## 4. SEO 與 OG（強化版）

### 4.1 Title 範本（**必須控制長度**）
- David 原稿範本過長（>60 中文字元，Google SERP 會被截斷）：
  `Coach {Name} | 香港{主要地區}{主要項目}教練 (銀髮強肌/深層伸展/1對1 PT) | ZenPass`
- **建議壓縮版（≤ 30 全形字元／60 半形）**：
  - 有地區＋服務：`{Name}｜{區}銀髮伸展・1對1 PT教練｜ZenPass`
  - 無地區：`{Name}｜長者伸展・防肌少症教練｜ZenPass`
- Description（≤ 80 中文字元）：
  `{區}長者伸展／防肌少症／1對1 PT。{hours} 小時認證授課、{certs} 張官方證書、{rating}★（{n} 評價）。平日日間班招生中。`

### 4.2 關鍵字落地（**唔可以堆砌**）
- 唔會將關鍵字塞入 meta keywords（Google 已忽略，且屬過時做法）
- 改為自然分佈：H1 含「區 + 服務」、H2 用「長者伸展班／1對1 PT 收費」、FAQ 區塊回答「防肌少症幾歲開始」
- **新增 FAQ 區塊 + `FAQPage` JSON-LD**：呢個係搶 featured snippet 最有效手段（比硬塞關鍵字有效 3–5 倍）

### 4.3 JSON-LD
```jsonc
{ "@context": "https://schema.org",
  "@graph": [
    { "@type": "Person", "name": "Sam Wong", "jobTitle": "長者體適能教練",
      "url": "https://zenpass.hk/c/sam-wong",
      "hasCredential": [{ "@type": "EducationalOccupationalCredential", "name": "芬蘭木柱 Level 2" }] },
    { "@type": "SportsActivityLocation", "name": "新興運動推廣社",
      "address": { "@type": "PostalAddress", "addressLocality": "觀塘", "addressCountry": "HK" } },
    { "@type": "Service", "serviceType": "長者伸展班",
      "provider": { "@id": "#coach" },
      "areaServed": "觀塘",
      "offers": { "@type": "Offer", "price": 180, "priceCurrency": "HKD" } }
  ] }
```

---

## 5. 前端（長者友善）

| 項目 | 規格 |
|---|---|
| 正文 | 16px（≥ 18px for 主要段落）；標題 24–28px |
| 對比 | 文字對比 ≥ 7:1（WCAG AAA 方向）；避免淺灰字 |
| 點擊區 | ≥ 48×48px；按鈕間距 ≥ 12px |
| 動畫 | 停用視差／自動輪播；尊重 `prefers-reduced-motion` |
| Chips | `👵 銀髮樂齡友好`　`🧘 深層筋膜伸展`　`💪 關節防跌強肌`　`🎯 1對1 私人定制` |
| 排程標籤 | `🌤 平日日間優惠班`（is_offpeak=true）、`🟢 溫和` / `🟡 適中` / `🔴 高強度` |
| CTA | 固定底部：`💬 WhatsApp 諮詢教練`（綠，主）＋ `📅 預約體驗時段`（次） |

---

## 6. ⚠️ 未定義項目（開工前必須由 David 拍板）

1. **「平日日間優惠」係咩？**
   - 折扣幾多？(10%? 20%?)
   - 用 promo code、`price_offpeak` 新欄位、抑或只係文案標籤？
   - 未定義 → 11/04 只能出「標籤」，唔可以出優惠價，否則會出現價錢前後不一致
2. **1對1 PT 點定價？** 現時 `classes.price_hkd` 係每班（多人）價；1對1 要 `price_per_session` 還是新 `course_type='pt_1on1'` + 獨立價？
3. **地區清單標準化**：`kwun_tong` 等 key 要對應現有 `districts` 值（需一次性 mapping），否則 SEO 頁會顯示英文 key
4. **教練可唔可以自選服務類型？** 建議：教練可自選，但 `senior_fitness` / `rehab_posture` 需管理員核實（避免無資歷教練接長者／痛症客，涉法律風險）

---

## 7. 測試計劃（`test-coach-profile.js`，≥30 項）

- [ ] slug 派生：`Sam Wong` → `sam-wong`；重名 → `sam-wong-2`
- [ ] 改名 → 舊 slug 301（唔係 404）
- [ ] 未核驗教練 → 404；已停用 → 404
- [ ] `verified_teaching_hours` 對數（與 SQL 手算一致，含跨日班）
- [ ] `certificates_issued` 排除 `revoked=1`
- [ ] **off-peak 判定**：HKT 週一 10:00 → true；HKT 週六 10:00 → false；HKT 週一 17:00 → false（**用 UTC 輸入測，防時區 bug**）
- [ ] `intensity_level` 預設 `moderate`，非法值被拒
- [ ] 牌照號碼遮罩、學員姓名脫敏（「陳太」）、唔回傳電話當 `public_contact_hidden=1`
- [ ] OG/meta 注入（`curl -A facebookexternalhit`）
- [ ] JSON-LD 係合法 JSON（`JSON.parse`）
- [ ] 現有全套測試全綠

---

## 8. 時程（維持 David 節奏）

| 日期 | 工作 |
|---|---|
| 今–11/01 | **代碼凍結**（本文件只寫 docs） |
| 11/02 | 解除凍結：Cloudflare 遷移 + 離線簽到抗重放 |
| 11/04 | Migration + 聚合 API + slug/nginx + 派生測試 |
| 11/05 | 頁面（長者友善）+ OG 分享卡 + JSON-LD + sitemap |
| 11/06 | 驗收 + Lighthouse（Performance ≥90、Accessibility ≥95）+ 上線 |
