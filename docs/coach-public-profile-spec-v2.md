# 教練公開專頁 — 整合規格 v2（單一真相版）

> **本文件取代** `coach-public-profile-mvp.md`（v1）同 `coach-public-profile-mvp-v1.1-senior.md`（v1.1 addendum）。
> 兩份舊文件保留作歷史紀錄，**日後開發一律照本文件**。
> 整合日期：2026-11-01 ｜ 狀態：**代碼凍結中，11/04 開工** ｜ 決策：David
> 目標頁：`https://zenpass.hk/c/<slug>`（例：`/c/sam-wong`）

---

## 0. 現況快照（2026-11-01 12:40 HKT，production 實查）

| 項目 | 實測 |
|---|---|
| API 健康 | `ok`，uptime 3d15h，DB 93 tables、7 bookings、16 users |
| 首發班狀態 | 10/31 15:00 芬蘭木柱、11/01 14:00 地板冰壺 → 仍 `available`、`enrolled_count=0`（平台內無報名紀錄） |
| PLI 閘門 | 10 個場地**全部 `unverified`**；`platform_settings['venue.pli_gate']` **未存在**（= 未 enforce） |
| 2FA | `david@zenpass.hk`、`primary@zenpass.hk` 兩者 `totp_enabled = 0`（未綁定） |
| PM2 | `zenpass-api` online，↺1147（歷史累積，`unstable restarts=0`，uptime 3D，非當前重啟循環）；error log 最後寫入 2026-06-22 |
| Git | HEAD `5840c1c`（v1.1 docs），working tree 只有 sitemap + 舊備份殘留 |

**含意**：首發班若係線下收款／WhatsApp 招生，**必須回填報名**，否則證書簽發、80/20 對賬、學員 portfolio 全部缺資料，之後補做成本高。

---

## 1. 目標與定位

| 項目 | 內容 |
|---|---|
| 目的（雙軌） | ① 用教練私域流量帶動冷啟動 ② 建立 Google 香港本地長尾 SEO 資產 |
| 定位 | 由「泛教練名片」收窄為 **「香港銀髮樂齡 × 痛症伸展 × 1對1 PT」獲客引擎**，保留新興運動作差異化資歷 |
| 核心客群 | 55–70 歲退休人士、長俸公務員、腰膝痛／需深層伸展及防肌少症人士 |
| 主力場景 | 週一至五 10:00–16:00（HKT）長者小班 4–6 人 ／ 1 對 1 PT |
| 平台價值 | 填補平日日間閒置場地與教練檔期；把「手停口停」變成月費型穩定收入 |
| 成功指標（30 日） | 每頁 ≥50 外部 referrer 到訪；≥10% 進課堂詳情；Google 收錄 ≥80% 已核驗教練頁 |
| 非目標（本期） | 自訂主題／域名、教練自編排版、拼團、課堂相簿 |

---

## 2. 資料模型（一次過 idempotent migration）

### 2.1 新增欄位

| 表 | 欄位 | 型別 | 說明 |
|---|---|---|---|
| users | `coach_slug` | TEXT UNIQUE | 系統派生，教練不可自改 |
| users | `public_bio` | TEXT | 教練自填簡介（覆蓋 `coach_applications.bio`） |
| users | `public_contact_phone` | TEXT | 公開工作號；NULL → fallback `phone` |
| users | `public_contact_hidden` | INTEGER DEFAULT 0 | 1 = 只顯示「透過平台查詢」 |
| users | `service_types` | TEXT (JSON) | `stretching / senior_fitness / pt_1on1 / niche_sports / rehab_posture` |
| users | `target_audiences` | TEXT (JSON) | `seniors / retirees / adults / kids` |
| users | `service_districts` | TEXT (JSON) | **存中文值**（同 `partner_venues.district` 對齊，見 §7 決策 3） |
| users | `service_types_pending` | TEXT (JSON) | 高危項（senior_fitness／rehab_posture）待管理員核實 |
| class_schedules | `intensity_level` | TEXT DEFAULT 'moderate' | `gentle / moderate / high`（CHECK 約束） |
| — | `coach_slug_redirects` | 新表 | `from_slug PK, to_slug, created_at` → 永久 301 |

**唔加** `class_schedules.is_offpeak`（查詢時計算，見 §4.3）。

### 2.2 為何放 `users` 而唔放 `coach_credentials`
`coach_credentials` 一個教練可以有多筆（換證／多牌照），公開頁要 `ORDER BY created_at DESC LIMIT 1`，易攞錯舊紀錄。公開檔案資料一對一，放 `users` join 永遠有值，API 少一個 subquery。`coach_credentials.qualified_sports` 繼續做「可發證項目」唯一來源。

### 2.3 已存在可重用（唔重複造）
`classes.target_audience`、`classes.sport_slug`、`classes.district`、`classes.course_type`、`classes.partner_venue_id`、`coach_credentials.is_starred / status / first_aid_*`、`coach_ratings`、`certificates`。

---

## 3. Slug 規則

- 後端派生：英文名 → lowercase → 空白轉 `-` → 去非 `[a-z0-9-]` → 合併連續 `-`（`Sam Wong` → `sam-wong`）
- 重名：`sam-wong-2`、`-3`…；無英文名：`coach-<id 前 8 位>`
- **教練不可自改**（名片／IG／Google 收錄後改名 = 斷鏈）
- 改名只限後台，寫 `coach_slug_redirects`，舊 slug 永久 301
- 回填 script：`scripts/backfill-coach-slug.cjs`（dry-run → 確認 → 寫入）

---

## 4. API：`GET /api/coaches/:slug/profile`

公開、唯讀、免登入。只回**已核驗**資料；未核驗／停用 → **404**（避免半成品頁被 Google 收錄）。

```jsonc
{
  "success": true,
  "coach": { "slug": "sam-wong", "name": "Sam Wong", "headline": "…", "bio": "…",
             "avatar": "https://…", "starred": true, "verified": true },
  "positioning": {
    "service_types":   [{ "key": "senior_fitness", "label": "銀髮體適能" }],
    "target_audiences":[{ "key": "seniors", "label": "銀髮樂齡" }],
    "districts":       [{ "key": "觀塘", "label": "觀塘" }]
  },
  "trust": {
    "verified_teaching_hours": 128.5,   // A：真實授課（對外顯示）
    "certified_hours": 120.0,           // B：證書認證時數（內部對賬，可唔對外）
    "certificates_issued": 64,
    "students_taught": 87,
    "rating": { "avg": 4.8, "count": 21 }
  },
  "credentials": { "license_type": "註冊教練", "license_expiry": "2027-03-31",
                   "license_masked": "AB****89",
                   "first_aid": { "type": "聖約翰急救證書", "expiry": "2026-12-01", "valid": true },
                   "sports": [{ "slug": "molkky", "label": "芬蘭木柱", "level": "Level 2" }] },
  "upcoming": [{ "schedule_id": "…", "class_id": "…", "title": "長者深層伸展班",
                 "start_time": "2026-11-07T02:00:00Z", "hk_time_label": "11/07（六）10:00–11:15",
                 "intensity_level": "gentle", "is_offpeak": true,
                 "price_hkd": 180, "seats_left": 6,
                 "venue_name": "新興運動推廣社", "district": "觀塘" }],
  "reviews": [{ "rating": 5, "comment": "…", "user_label": "陳太", "created_at": "2026-10-20" }],
  "contact": { "whatsapp": "85291234567", "hidden": false,
               "prefill": "你好 Coach Sam，我在 ZenPass 看到你平日日間嘅長者伸展課堂，想查詢…" },
  "faq": [{ "q": "防肌少症幾歲開始？", "a": "…" }],
  "og": { "title": "…", "description": "…", "image": "/api/coaches/sam-wong/og.png",
          "url": "https://zenpass.hk/c/sam-wong" }
}
```

### 4.1 資料來源對照

| 欄位 | 來源 |
|---|---|
| verified_teaching_hours（A） | `class_schedules`(start<now) JOIN `classes.coach_id`，Σ(end−start) |
| certified_hours（B） | `certificates.hours` WHERE coach_id=? AND revoked=0 |
| certificates_issued | 同上 COUNT(*) |
| students_taught | `bookings` JOIN `classes`，`payment_status='paid'`，DISTINCT user_id |
| starred | `coach_credentials` verified + is_starred + 牌照未過期 |
| sports | `coach_credentials.qualified_sports`（最新一筆 verified） |
| upcoming | `class_schedules.status='available' AND start_time > now`，60 日內，JOIN `classes`(status='active') + `partner_venues` |
| rating | `coach_ratings` |
| whatsapp | `users.public_contact_phone` → `users.phone` |
| is_offpeak | 查詢時計算（§4.3） |

### 4.2 授課時數定義（v1 vs v1.1 分歧已解決）
對外顯示 **A（真實授課）**——反映真實付出，未發證的班不被低估，教練唔會質疑造假；**B（證書時數）**留內部對賬。

### 4.3 `is_offpeak` 查詢時計算（⚠️ 時區坑）
`class_schedules.start_time` 存 **UTC**。直接 `strftime('%H', start_time)` 會全部差 8 小時，平日 10:00 會被判成 off-peak=false。

```sql
CAST(strftime('%w',  cs.start_time, '+8 hours') AS INTEGER) BETWEEN 1 AND 5
AND CAST(strftime('%H%M', cs.start_time, '+8 hours') AS INTEGER) BETWEEN 900 AND 1630
```
測試必須用 UTC 輸入驗證（例：`2026-11-02T02:00:00Z` = HKT 週一 10:00 → true）。

---

## 5. 路由與 SEO（SSR-lite）

### 5.1 Express 路由
`GET /c/:slug`（**必須註冊在 `express.static` 之前**）：
1. 查 slug（含 redirect 表 → 301）
2. 讀 `frontend-v2/coach-public.html` 模板，替換 `{{OG_TITLE}} {{OG_DESC}} {{OG_IMAGE}} {{OG_URL}} {{CANONICAL}} {{JSONLD}} {{FAQ_JSONLD}}`
3. 回 `text/html`，`Cache-Control: public, max-age=300, stale-while-revalidate=86400`
4. 頁面其餘內容由前端 fetch API 渲染（爬蟲只需 meta + HTML）

### 5.2 ⚠️ Nginx 必加（已核對 production 現況）
production 由 nginx 直接 serve `root /var/www/zenpass/frontend-v2`（`location / { try_files $uri $uri/ @v1; }`），`/c/sam-wong` **唔會**去 Node，會 fallback 去 v1 → 404。

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
（唔建議預生成靜態頁：每次改資料要重建，slug 改名／新教練要重跑。）

### 5.3 Meta 標題（v1.1 已修正長度）
- 有地區＋服務：`{Name}｜{區}銀髮伸展・1對1 PT教練｜ZenPass`
- 無地區：`{Name}｜長者伸展・防肌少症教練｜ZenPass`
- Description（≤80 中文字）：`{區}長者伸展／防肌少症／1對1 PT。{hours} 小時認證授課、{certs} 張官方證書、{rating}★（{n} 評價）。平日日間班招生中。`
- **唔用 meta keywords**（Google 已忽略）；關鍵字自然分佈於 H1/H2/FAQ

### 5.4 JSON-LD（`@graph`）
`Person`(+hasCredential) → `SportsActivityLocation` → `Service`(+offers) → `FAQPage`（搶 featured snippet，比堆關鍵字有效 3–5 倍）

### 5.5 OG 分享卡
`GET /api/coaches/:slug/og.png` 1200×630（複用 `assets/poster.js` canvas 方案）：頭像、姓名、⭐、`128.5 小時認證授課`、`4.8★`、ZenPass logo。
`Cache-Control: public, max-age=86400`；資料更新後 `?v=<updated_at>` 破緩存。Fallback `assets/og/coach-default.png`。

### 5.6 Sitemap / robots
`generate-sitemap.cjs` 加入所有已核驗教練頁；`robots.txt` 允許 `/c/`。

---

## 6. 前端（`coach-public.html`，長者友善）

### 6.1 結構（7 段）
1. **身份卡**：頭像、中英文名、headline、⭐ 星級、⛑️ 急救有效徽章
2. **信任數據條**：認證授課 N 小時 · 簽發證書 M 張 · 學員人數 · 平均評分
3. **定位 chips**：`👵 銀髮樂齡友好` `🧘 深層筋膜伸展` `💪 關節防跌強肌` `🎯 1對1 私人定制` + 運動資歷（`assets/sport-icons.js`）
4. **近期開課**：日期時間、地點＋地區、價錢、剩餘名額、`🌤 平日日間班`、`🟢 溫和 / 🟡 適中 / 🔴 高強`；CTA → `booking.html?schedule=…`；空狀態「暫無公開課堂，可 WhatsApp 查詢開班」
5. **學員評價**：最多 5 條，星級＋評語＋脫敏稱謂
6. **FAQ**（4–6 條，配 FAQPage JSON-LD）
7. **固定底部 CTA**：`💬 WhatsApp 諮詢教練`（綠，主）＋ `📅 預約體驗時段`（次）

### 6.2 長者友善規格
正文 16px（主要段落 ≥18px）、標題 24–28px；對比 ≥7:1；點擊區 ≥48×48px、間距 ≥12px；停用視差／自動輪播、尊重 `prefers-reduced-motion`；`lang="zh-HK"`。

### 6.3 私隱紅線（硬性）
- 唔顯示學員全名／電話／證書編號（只「陳太」）
- 牌照號碼遮罩 `AB****89`（內部保留全號）
- `public_contact_hidden=1` → 按鈕改「透過平台查詢」，API 唔回傳電話

---

## 7. 決策（v1.1 四項未定 → 我的建議，David 可 veto）

| # | 問題 | 建議（預設執行） | 理由 |
|---|---|---|---|
| 1 | 「平日日間優惠」 | **11/04 只出標籤，唔出折扣**；12 月有成交量後再用現有 promo code 機制做，**唔加 `price_offpeak` 欄位** | 未定義價錢會前後不一、對賬／審計複雜；標籤已足夠做 SEO 與心理暗示 |
| 2 | 1對1 PT 定價 | 用 `classes.course_type='pt_1on1'` + `max_participants=1`，`price_hkd` 就是每節價 | 避免雙軌定價（`price_per_session`）造成兩個真相 |
| 3 | 地區 key | `service_districts` **直接存中文**（觀塘／荔枝角／太子／沙田），與 `partner_venues.district` 20 個值對齊 | 現有 `classes.district` 已係中文，join 直接、SEO 直接；唔使維護 mapping |
| 4 | 誰可自選長者／痛症 | 教練可自選，但 `senior_fitness`／`rehab_posture` 入 `service_types_pending`，管理員核實才公開 | 無資歷接長者／痛症客有法律風險 |

---

## 8. 測試（`backend/tests/test-coach-profile.js`，≥30 項）

- slug 派生／重名 `-2`／改名 → 301（唔係 404）
- 未核驗 / 停用教練 → 404，且不入 sitemap
- `verified_teaching_hours` 對數（含跨日班）；`certificates_issued` 排除 `revoked=1`
- **off-peak 時區**：UTC 輸入測 HKT 週一 10:00=true、週六 10:00=false、週一 17:00=false
- `intensity_level` 預設 moderate、非法值被拒
- 牌照遮罩、學員脫敏、`hidden=1` 唔回傳電話
- `curl -A "facebookexternalhit"` 見到正確 OG；JSON-LD `JSON.parse` 通過
- 名額 `seats_left` 與 booking 上限一致
- 現有全套 backend + vitest 全綠

---

## 9. 時程與上線

| 日期 | 工作 |
|---|---|
| 11/01–11/02 | 代碼凍結；**回填首發班報名**（如線下成交） |
| 11/02 | 解凍：Cloudflare 遷移 + 離線簽到抗重放 |
| 11/04 | Migration（8 欄 + 1 表）＋ 聚合 API ＋ slug 路由 ＋ **nginx `/c/` 規則** ＋ 測試 |
| 11/05 | 頁面（長者友善）＋ OG 卡 ＋ JSON-LD/FAQ ＋ sitemap |
| 11/06 | 驗收清單 10 項 ＋ Lighthouse（Perf ≥90、A11y ≥95）＋ Sam 連結上 IG |

**Rollback**：feature flag `COACH_PUBLIC_PROFILE=1`；關 flag → 全 `/c/*` 404，唔影響其他功能。

**開工前檢查**：`2026-11-04` 當日再跑一次 §0 快照，確認 PLI gate 與 2FA 狀態（見下）。

---

## 10. Roadmap（已整合 David 10/28 路線圖 + 主頁優先決議）

| 期 | 內容 | 現狀 |
|---|---|---|
| 已完成 | 教練酬勞自動對賬 + FPS 批次 CSV（80/20 + 場租） | ✅ 已有（`/api/admin/ops/payout-list`） |
| 已完成 | 拼班底層（`group_size` / `group_invite_code` / 團隊預訂） | ✅ 缺前端流程 |
| **第 1 期 11/04–11/06** | 教練公開專頁（銀髮／伸展／PT + SEO + OG） | 本文件 |
| 第 1 期後 | 課堂相簿分發（水印 + 權限 + 一鍵分享） | 未做 |
| 第 2 期 12 月 | 續報推薦引擎（技能關聯 + 優惠碼）／學校機構 Excel 批次 + 月結 invoice／Cloudflare WAF | 未做 |
| 第 3 期 明年初 | 家長拼單組班（等 5–10 活躍教練、100+ 學員種子後）／微保險 API／賽事系統 | 未做 |

次序理由（維持 10/28 決議）：主頁 = 加數 + SEO 資產 + 教練私域導流；拼單 = 乘數，需要種子客先有效，湊不夠人會連全費客一齊流失。

---

## 11. 附帶待辦（與本專頁無關但影響首發閉環）

1. **PLI gate**：3 個使用中場地需填 BR／保單號／到期日 → 全部變綠 → 撳 enforce → 之後跑 `scripts/verify-pli-gate.cjs` 4 項覆核
2. **2FA**：`david@` / `primary@` 兩個 super_admin 都未綁 TOTP
3. **首發班報名回填**：10/31、11/01 兩班平台內 `enrolled_count=0`，如線下成交要補 booking（否則證書／對賬／portfolio 缺資料）
4. **pm2 error log 停寫**（最後 2026-06-22）→ logrotate 或路徑問題，需查
