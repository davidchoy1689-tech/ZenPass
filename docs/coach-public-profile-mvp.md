# 教練個人專屬主頁（Coach Public Profile）— MVP Spec v1

> 狀態：**規格定稿，等待開發**（代碼凍結中，最快 2026-11-04 開工）
> 負責：OpenClaw ｜ 決策：David（2026-10-28 20:01）
> 目標頁：`https://zenpass.hk/c/<slug>` 例：`/c/sam-wong`

---

## 0. 目標與成功指標

| 項目 | 目標 |
|---|---|
| 目的 | 用教練私域流量帶動冷啟動；同時建立 Google 長尾 SEO 資產 |
| 成功指標 | 每個教練頁 30 日內 ≥50 次外部 referrer 到訪；≥10% 到訪者進入課堂詳情；Google 收錄 ≥80% 教練頁 |
| 非目標（本期唔做） | 自訂主題／自訂域名、教練自行編輯排版、拼團、相簿 |

---

## 1. Slug 規則（已定案）

- 由後端派生：`英文名` → lowercase → 空白轉 `-` → 去非 `[a-z0-9-]` → 合併連續 `-`（例：`Sam Wong` → `sam-wong`）
- 重名：追加流水號 `sam-wong-2`、`-3`…
- 無英文名：用 `coach-<users.id 前 8 位>`
- **教練不可自行更改**（避免外鏈斷裂／SEO 損失）
- 改名只限管理員後台，並寫入 `coach_slug_redirects(from_slug, to_slug, created_at)`，舊 slug 永久 **301** 到新 slug
- Slug 存 `users.coach_slug`（UNIQUE），首次寫入時生成

---

## 2. API 契約（單一聚合端點）

### `GET /api/coaches/:slug/profile`
公開、唯讀、無需登入。只回傳**已核驗**資料；未核驗教練回 404（避免半成品頁被收錄）。

```jsonc
{
  "success": true,
  "coach": {
    "slug": "sam-wong",
    "name": "Sam Wong",
    "name_en": "Sam Wong",
    "avatar": "https://…",
    "headline": "芬蘭木柱／地板冰壺 註冊教練",
    "bio": "……",
    "starred": true,                // coach_credentials.status='verified' AND is_starred=1 AND 牌照未過期
    "verified": true,
    "rating": { "avg": 4.8, "count": 21 }
  },
  "trust": {                        // 信任背書數據條
    "verified_hours": 128.5,        // SUM(certificates.hours) WHERE coach_id=me AND revoked=0
    "certificates_issued": 64,      // COUNT(*) 同上
    "students_taught": 87,          // DISTINCT bookings.user_id WHERE payment_status='paid'
    "classes_active": 3
  },
  "credentials": {                  // 只回傳可公開欄位，唔回傳 license_no 全號
    "license_type": "註冊教練",
    "license_expiry": "2027-03-31",
    "first_aid": { "type": "聖約翰急救證書", "expiry": "2026-12-01", "valid": true },
    "sports": [                     // qualified_sports → 中文標籤
      { "slug": "molkky", "label": "芬蘭木柱", "level": "Level 2" }
    ]
  },
  "upcoming": [                     // 未來 60 日，status='available'，已開班
    {
      "schedule_id": "…",
      "class_id": "…",
      "title": "芬蘭木柱體驗班（週末）",
      "sport": "芬蘭木柱",
      "start_time": "2026-11-07T02:00:00.000Z",
      "end_time": "2026-11-07T03:30:00.000Z",
      "venue_name": "新興運動推廣社",
      "district": "觀塘",
      "price_hkd": 180,
      "seats_left": 6
    }
  ],
  "reviews": [                      // 最多 5 條，只顯示星級＋評語，唔顯示學員全名
    { "rating": 5, "comment": "…", "user_label": "陳太", "created_at": "2026-10-20" }
  ],
  "contact": {
    "whatsapp": "85291234567",      // 可被教練隱藏（public_contact_hidden=1）
    "prefill": "你好 Coach Sam，我在 ZenPass 看到你的課堂，想查詢…"
  },
  "og": {
    "title": "Sam Wong｜芬蘭木柱・地板冰壺教練｜ZenPass 禪流",
    "description": "128.5 小時認證授課・64 張官方證書・4.8★（21 個評價）",
    "image": "/api/coaches/sam-wong/og.png",
    "url": "https://zenpass.hk/c/sam-wong"
  }
}
```

**資料來源對照**

| 欄位 | 來源 |
|---|---|
| verified_hours / certificates_issued | `certificates`（`coach_id`, `revoked=0`, `hours`） |
| students_taught | `bookings` + `classes.coach_id`，`payment_status='paid'` |
| starred | `coach_credentials`（verified + is_starred + 牌照未過期） |
| sports | `coach_credentials.qualified_sports`（JSON array） |
| upcoming | `class_schedules`（`status='available'`, `start_time > now`）+ `classes`（`status='active'`） |
| rating | `coach_ratings`（AVG／COUNT） |
| whatsapp | `users.public_contact_phone`（新欄）→ fallback `users.phone` |

**新增欄位（idempotent migration）**
- `users.coach_slug TEXT`（UNIQUE index）
- `users.public_contact_phone TEXT`
- `users.public_contact_hidden INTEGER DEFAULT 0`
- `users.public_bio TEXT`（教練自填，覆蓋 `coach_applications.bio`）
- `coach_slug_redirects(from_slug TEXT PRIMARY KEY, to_slug TEXT, created_at TEXT)`

---

## 3. 路由與 SSR-lite（OG 關鍵）

Google／WhatsApp／IG 爬蟲**唔執行 JS**，所以 OG meta 必須由伺服器輸出。

- Express 新增 `GET /c/:slug`（**放在 `express.static` 之前**）：
  1. 查 slug（含 301 redirect 表）
  2. 讀 `frontend-v2/coach-public.html` 模板，替換佔位符：
     `{{OG_TITLE}} {{OG_DESC}} {{OG_IMAGE}} {{OG_URL}} {{CANONICAL}} {{JSONLD}}`
  3. 回傳 `text/html`，`Cache-Control: public, max-age=300, stale-while-revalidate=86400`
- 頁面其餘內容由前端 fetch `/api/coaches/:slug/profile` 渲染（爬蟲只需 meta + 基本 HTML）

**⚠️ Nginx 必須加一條規則（已核對 production 現況）**
production 嘅 `server { root /var/www/zenpass/frontend-v2; }` 係**直接由 nginx 讀靜態檔**（`location / { try_files $uri $uri/ @v1; }`），
`/c/sam-wong` 唔會去到 Node，而係搵唔到檔就 fallback 去 v1 → 404。所以要加：

```nginx
location ^~ /c/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "public, max-age=300" always;
}
```
（`^~` 前綴優先於 regex location；唔影響 `/c/*.png` 之類，因為 Express 只處理 `/c/:slug`）

替代方案（唔建議）：部署時預先為每個教練生成靜態 `c/<slug>/index.html`。可行但每次改資料要重建，且 slug 改名／新教練要重跑，維護成本高。
- `sitemap.xml` 自動加入所有已核驗教練頁（`generate-sitemap.cjs` 加一段）
- `robots.txt` 允許 `/c/`

**結構化資料（JSON-LD）**：`Person` + `hasCredential` + `offers`（Course），提升 rich result 機會。

---

## 4. OG 分享卡

- `GET /api/coaches/:slug/og.png`：1200×630，用既有 canvas 方案（參考 `assets/poster.js`）生成
  - 內容：頭像圓形裁切、姓名、⭐ 星級（如有）、`128.5 小時認證授課`、`4.8★`、ZenPass logo
  - 快取：`Cache-Control: public, max-age=86400`；教練更新資料後加 `?v=<updated_at>` 破壞快取
- Fallback（未生成／生成失敗）：`assets/og/coach-default.png`

---

## 5. 前端視圖（`coach-public.html`）

1. **頂部身份卡**：頭像、姓名（中／英）、headline、⭐ 星級徽章、⛑️ 急救有效徽章
2. **信任數據條**（4 格）：認證授課時數 · 簽發證書 · 學員人數 · 平均評分
3. **運動資質 chips**：`芬蘭木柱 Level 2`、`地板冰壺` …（帶運動 icon，已有 `assets/sport-icons.js`）
4. **近期開課**：卡片列（日期／時間、地點＋地區、價錢、剩餘名額、`立即報名` → `booking.html?schedule=…`）
   - 空狀態：`暫無公開課堂，可 WhatsApp 查詢開班`
5. **學員評價**：最多 5 條，星級 + 評語 + `陳太` 這類脫敏稱謂
6. **底部固定 CTA**：`💬 WhatsApp 查詢`（帶預填文案）＋ `查看全部課堂`
7. **SEO 區塊**：H1 = 教練名 + 主要運動；H2 = 近期開課／評價；圖片 lazy load；`lang="zh-HK"`

**私隱紅線**
- 唔顯示學員全名、電話、證書編號
- 唔顯示牌照號碼全號（`license_no` 遮罩為 `AB****89`）
- 電話可由教練隱藏 → 按鈕改為「透過平台查詢」

---

## 6. 效能

- 聚合查詢 ≤ 5 條 SQL，全部走 index：`certificates(coach_id)`, `class_schedules(class_id,start_time)`, `bookings(class_id)`, `coach_ratings(coach_id)`
- 目標：API p95 < 150ms（VPS 本地 <30ms）
- 頁面 LCP < 2.0s（4G）；圖片用 `loading="lazy"` + 固定寬高避免 CLS

---

## 7. 驗收清單（開發完成後逐項打勾）

- [ ] `/c/sam-wong` 回 200；對應教練不存在 → 404
- [ ] 未核驗教練（`coach_credentials.status != 'verified'`）→ 404 且唔會被 sitemap 收錄
- [ ] 改名後舊 slug 301 到新 slug（測試 `curl -I`）
- [ ] `curl -A "facebookexternalhit" /c/sam-wong` 見到正確 `og:title/og:description/og:image`
- [ ] `verified_hours` = `SELECT SUM(hours) FROM certificates WHERE coach_id=? AND revoked=0`（對數）
- [ ] 只列出 `status='available'` 且未開始嘅 schedule；`seats_left` 與 booking 上限一致
- [ ] WhatsApp 按鈕：預設開啟、預填文案、隱藏開關生效
- [ ] 牌照號碼遮罩；學員姓名脫敏
- [ ] 新測試 `test-coach-public-profile.js`（≥25 項）＋ 現有全套測試全綠
- [ ] Lighthouse Performance ≥ 90（mobile）

---

## 8. 上線步驟

1. Migration（新增 5 個欄位／表）→ 部署 → health 200
2. 回填 `coach_slug`（一次性 script，`scripts/backfill-coach-slug.cjs`）
3. 生成 OG 圖快取
4. 更新 sitemap + 提交 Google Search Console
5. 為首發教練（Sam）出連結，請佢放 IG Bio

**Rollback**：路由由 feature flag `COACH_PUBLIC_PROFILE=1` 控制；關 flag 即回 404，唔影響其他功能。

---

## 9. 時程（與 David 協定）

| 日期 | 工作 |
|---|---|
| 11/02 | Cloudflare 遷移 + 離線簽到抗重放（既有計劃） |
| 11/04 | Migration + 聚合 API + slug 路由 + **nginx `/c/` 規則** + 測試 |
| 11/05 | 頁面 UI + OG 生成 + sitemap |
| 11/06 | 驗收清單 + Lighthouse + 上線 + Sam 連結 |
