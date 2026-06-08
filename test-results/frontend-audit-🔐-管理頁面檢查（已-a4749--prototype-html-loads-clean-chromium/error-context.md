# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 🔐 管理頁面檢查（已登入） >> admin /design-prototype.html loads clean
- Location: tests/e2e/frontend-audit.spec.js:144:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 6

- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 400 ()",
+   "[GSI_LOGGER]: The given origin is not allowed for the given client ID.",
+   "The request has been aborted.",
+   "[GSI_LOGGER]: FedCM get() rejects with AbortError: signal is aborted without reason",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation [ref=e2]:
    - generic [ref=e3]:
      - link "禪流" [ref=e4] [cursor=pointer]:
        - /url: "#"
      - generic [ref=e5]:
        - link "首頁" [ref=e6] [cursor=pointer]:
          - /url: "#"
        - link "課程" [ref=e7] [cursor=pointer]:
          - /url: "#"
        - link "會籍" [ref=e8] [cursor=pointer]:
          - /url: "#"
        - link "教練" [ref=e9] [cursor=pointer]:
          - /url: "#"
      - generic [ref=e10]:
        - button "登入" [ref=e11] [cursor=pointer]
        - button "註冊" [ref=e12] [cursor=pointer]
        - generic [ref=e13]: 🧘
  - generic [ref=e14]:
    - generic [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]:
          - text: ZenPass 設計系統 v2
          - heading "設計預覽 · Design Prototype" [level=1] [ref=e18]
          - paragraph [ref=e19]: 參考 ClassPass、PURE、Mindbody 嘅現代設計語言，為 ZenPass 打造一套統一、清新、專業嘅 UI 系統。
        - generic [ref=e20]:
          - generic [ref=e21]: 🟢 獨立檔案
          - generic [ref=e22]: 🗑️ 可隨時刪除
      - generic [ref=e24]:
        - heading "🎨 色板系統" [level=2] [ref=e25]
        - paragraph [ref=e26]: 品牌色以溫暖嘅橙色為主軸，配搭中性灰階
        - generic [ref=e27]:
          - generic [ref=e28]:
            - generic [ref=e30]: "#FF6B35"
            - generic [ref=e31]: Primary / Orange
          - generic [ref=e32]:
            - generic [ref=e34]: "#E55A2B"
            - generic [ref=e35]: Orange Dark
          - generic [ref=e36]:
            - generic [ref=e38]: "#FFF3ED"
            - generic [ref=e39]: Orange Light
          - generic [ref=e40]:
            - generic [ref=e42]: "#059669"
            - generic [ref=e43]: Success / Green
          - generic [ref=e44]:
            - generic [ref=e46]: "#F59E0B"
            - generic [ref=e47]: Amber
          - generic [ref=e48]:
            - generic [ref=e50]: "#EF4444"
            - generic [ref=e51]: Error / Red
          - generic [ref=e52]:
            - generic [ref=e54]: "#8B5CF6"
            - generic [ref=e55]: Purple
          - generic [ref=e56]:
            - generic [ref=e58]: "#1A1A2E"
            - generic [ref=e59]: Dark bg
      - generic [ref=e61]:
        - heading "🔤 字型系統" [level=2] [ref=e62]
        - paragraph [ref=e63]: 中英：Noto Sans TC + Inter，清晰現代
        - generic [ref=e64]:
          - generic [ref=e65]:
            - generic [ref=e66]: 禪流 ZenPass
            - generic [ref=e67]: 禪流 ZenPass
            - generic [ref=e68]: 禪流 ZenPass
            - generic [ref=e69]: Heading Large · 22px
            - generic [ref=e70]: Heading Medium · 18px
            - generic [ref=e71]: Heading Small · 15px
          - generic [ref=e72]:
            - generic [ref=e73]: Body Large · 16px — 禪流透過新興運動促進身心靈健康
            - generic [ref=e74]: Body Medium · 14px — 禪流透過新興運動促進身心靈健康
            - generic [ref=e75]: Body Small · 13px — 禪流透過新興運動促進身心靈健康
            - generic [ref=e76]: Caption · 12px — 僅作輔助說明使用
            - generic [ref=e77]: LABEL · 11px uppercase — 用於分類標籤
      - generic [ref=e79]:
        - heading "🔘 按鈕" [level=2] [ref=e80]
        - generic [ref=e81]:
          - button "主要按鈕" [ref=e82] [cursor=pointer]
          - button "次要按鈕" [ref=e83] [cursor=pointer]
          - button "文字按鈕" [ref=e84] [cursor=pointer]
          - button "小按鈕" [ref=e85] [cursor=pointer]
          - button "大按鈕" [ref=e86] [cursor=pointer]
          - button "全寬按鈕" [ref=e87] [cursor=pointer]
          - generic [ref=e88]:
            - button "👤" [ref=e89] [cursor=pointer]
            - button "🔔" [ref=e90] [cursor=pointer]
            - button "⚙️" [ref=e91] [cursor=pointer]
      - generic [ref=e93]:
        - heading "🏷️ 標籤 · 卡片 · 表單" [level=2] [ref=e94]
        - generic [ref=e95]:
          - generic [ref=e96]: 🔥 熱門
          - generic [ref=e97]: ✅ 可預約
          - generic [ref=e98]: 🈵 滿額
          - generic [ref=e99]: 💡 初級
          - generic [ref=e100]: ⭐ 推薦
        - generic [ref=e101]:
          - generic [ref=e102]:
            - generic [ref=e103]:
              - generic [ref=e104]: 標準卡片
              - generic [ref=e105]: New
            - paragraph [ref=e106]: 用於課程列表、教練資料、資訊展示等場景。支援 hover 陰影效果。
            - generic [ref=e107]:
              - button "立即預約" [ref=e108] [cursor=pointer]
              - button "詳細" [ref=e109] [cursor=pointer]
          - generic [ref=e110]:
            - generic [ref=e112]: 表單範例
            - generic [ref=e113]:
              - textbox "請輸入姓名" [ref=e114]
              - textbox "請輸入電話號碼" [ref=e115]
              - generic [ref=e116]:
                - textbox "電郵" [ref=e117]
                - button "提交" [ref=e118] [cursor=pointer]
    - generic [ref=e120]:
      - generic [ref=e121]:
        - heading "📱 頁面預覽" [level=2] [ref=e122]
        - generic [ref=e123]: 新設計應用示範
      - paragraph [ref=e124]: 以下係如果用新 Design System 改寫後嘅主要頁面 mockup
      - generic [ref=e125]:
        - text: 首頁 · Home
        - generic [ref=e127]:
          - generic [ref=e128]: 新興運動推廣
          - heading "探索身心靈 全新運動體驗" [level=1] [ref=e129]:
            - text: 探索身心靈
            - text: 全新運動體驗
          - paragraph [ref=e130]: 由芬蘭木柱到圓網球，超過 10 種新興運動等你體驗。禪流 — 讓運動成為你生活嘅一部分。
          - generic [ref=e131]:
            - button "開始探索 →" [ref=e132] [cursor=pointer]
            - button "了解更多" [ref=e133] [cursor=pointer]
        - generic [ref=e134]:
          - generic [ref=e135]:
            - generic [ref=e136]: 🏃
            - generic [ref=e137]: 2,400+
            - generic [ref=e138]: 已服務人次
          - generic [ref=e139]:
            - generic [ref=e140]: 🧘
            - generic [ref=e141]: "27"
            - generic [ref=e142]: 精選課程
          - generic [ref=e143]:
            - generic [ref=e144]: ⭐
            - generic [ref=e145]: "4.8"
            - generic [ref=e146]: 平均評分
        - heading "熱門課程" [level=3] [ref=e147]
        - generic [ref=e148]:
          - generic [ref=e149] [cursor=pointer]:
            - generic [ref=e151]: 🔥 熱門
            - generic [ref=e152]:
              - heading "芬蘭木柱 Mölkky" [level=4] [ref=e153]
              - generic [ref=e154]:
                - generic [ref=e155]: 🧑‍🏫 Marco Sir
                - generic [ref=e156]: 📍 佐敦
              - generic [ref=e157]:
                - generic [ref=e158]: HK$120
                - button "預約" [ref=e159]
          - generic [ref=e160] [cursor=pointer]:
            - generic [ref=e162]: ✅ 新課程
            - generic [ref=e163]:
              - heading "地板冰壺 Floor Curling" [level=4] [ref=e164]
              - generic [ref=e165]:
                - generic [ref=e166]: 🧑‍🏫 靜儀教練
                - generic [ref=e167]: 📍 旺角
              - generic [ref=e168]:
                - generic [ref=e169]: HK$150
                - button "預約" [ref=e170]
          - generic [ref=e171] [cursor=pointer]:
            - generic [ref=e173]: 🌟 初級
            - generic [ref=e174]:
              - heading "圓網球 Roundnet" [level=4] [ref=e175]
              - generic [ref=e176]:
                - generic [ref=e177]: 🧑‍🏫 David Coach
                - generic [ref=e178]: 📍 尖沙咀
              - generic [ref=e179]:
                - generic [ref=e180]: HK$130
                - button "預約" [ref=e181]
      - generic [ref=e182]:
        - text: 課程詳情 · Class Detail
        - generic [ref=e183]:
          - generic [ref=e184]:
            - generic [ref=e185]: 🎯
            - generic [ref=e186]:
              - generic [ref=e187]:
                - heading "芬蘭木柱 Mölkky" [level=2] [ref=e188]
                - generic [ref=e189]:
                  - generic [ref=e190]: 🧑‍🏫 Marco Sir
                  - generic [ref=e191]: 📍 佐敦 · 室內運動場
                  - generic [ref=e192]: ⏱ 60 分鐘
              - generic [ref=e193]:
                - generic [ref=e194]: HK$120
                - generic [ref=e195]: 已包括器材
            - paragraph [ref=e196]: 芬蘭木柱（Mölkky）源自芬蘭嘅傳統投擲遊戲，結合策略同精準度。適合任何年齡人士參與，促進團隊合作同手眼協調。
            - generic [ref=e197]:
              - generic [ref=e198]: 🔥 熱門
              - generic [ref=e199]: ✅ 器材提供
              - generic [ref=e200]: 🌟 初級
              - generic [ref=e201]: 👥 最多 20 人
          - generic [ref=e203]:
            - heading "可預約時間" [level=4] [ref=e204]
            - generic [ref=e205]:
              - generic [ref=e206]:
                - generic [ref=e207]: 10:00
                - generic [ref=e208]:
                  - generic [ref=e209]: 週六 5月16日
                  - generic [ref=e210]: 剩餘 8/20 位
                - button "預約" [ref=e211] [cursor=pointer]
              - generic [ref=e212]:
                - generic [ref=e213]: 14:00
                - generic [ref=e214]:
                  - generic [ref=e215]: 週六 5月16日
                  - generic [ref=e216]: 剩餘 12/20 位
                - button "預約" [ref=e217] [cursor=pointer]
              - generic [ref=e218]:
                - generic [ref=e219]: 10:00
                - generic [ref=e220]:
                  - generic [ref=e221]: 週日 5月17日
                  - generic [ref=e222]: 🈵 已滿額
                - button "滿額" [disabled] [ref=e223] [cursor=pointer]
      - generic [ref=e224]:
        - text: 課程列表 · Courses
        - generic [ref=e225]:
          - generic [ref=e226]:
            - generic [ref=e227] [cursor=pointer]: 全部
            - generic [ref=e228] [cursor=pointer]: 🧘 瑜伽
            - generic [ref=e229] [cursor=pointer]: 🏋️ 健身
            - generic [ref=e230] [cursor=pointer]: 🎯 新興運動
            - generic [ref=e231] [cursor=pointer]: 🧘 冥想
          - textbox "搜尋課程..." [ref=e232]
        - generic [ref=e233]:
          - generic [ref=e234]:
            - generic [ref=e235]: 🎯
            - generic [ref=e236]:
              - generic [ref=e237]:
                - heading "芬蘭木柱 Mölkky" [level=4] [ref=e238]
                - generic [ref=e239]: HK$120
              - generic [ref=e240]:
                - generic [ref=e241]: 🧑‍🏫 Marco Sir
                - generic [ref=e242]: 📍 佐敦
          - generic [ref=e243]:
            - generic [ref=e244]: 🧊
            - generic [ref=e245]:
              - generic [ref=e246]:
                - heading "地板冰壺" [level=4] [ref=e247]
                - generic [ref=e248]: HK$150
              - generic [ref=e249]:
                - generic [ref=e250]: 🧑‍🏫 靜儀教練
                - generic [ref=e251]: 📍 旺角
          - generic [ref=e252]:
            - generic [ref=e253]: 🔴
            - generic [ref=e254]:
              - generic [ref=e255]:
                - heading "圓網球 Roundnet" [level=4] [ref=e256]
                - generic [ref=e257]: HK$130
              - generic [ref=e258]:
                - generic [ref=e259]: 🧑‍🏫 David Coach
                - generic [ref=e260]: 📍 尖沙咀
          - generic [ref=e261]:
            - generic [ref=e262]: 🏏
            - generic [ref=e263]:
              - generic [ref=e264]:
                - heading "布袋球 Cornhole" [level=4] [ref=e265]
                - generic [ref=e266]: HK$100
              - generic [ref=e267]:
                - generic [ref=e268]: 🧑‍🏫 David Coach
                - generic [ref=e269]: 📍 佐敦
      - generic [ref=e270]:
        - text: 會籍方案 · Membership
        - generic [ref=e271]:
          - generic [ref=e272]:
            - generic [ref=e273]: 🎯
            - heading "試玩體驗" [level=4] [ref=e274]
            - generic [ref=e275]: HK$399
            - paragraph [ref=e276]: 4 堂體驗課
            - paragraph [ref=e277]: 30 日有效期
            - paragraph [ref=e278]: 🎫 無限自助簽到
            - button "了解更多" [ref=e279] [cursor=pointer]
          - generic [ref=e280]:
            - generic [ref=e281]: 🔥 最受歡迎
            - generic [ref=e282]: 🏆
            - heading "標準月費" [level=4] [ref=e283]
            - generic [ref=e284]: HK$699
            - paragraph [ref=e285]: 無限次上課
            - paragraph [ref=e286]: 每月自動續費
            - paragraph [ref=e287]: 🎫 無限自助簽到 + 🎁 每月 2 張朋友券
            - button "立即訂閱" [ref=e288] [cursor=pointer]
          - generic [ref=e289]:
            - generic [ref=e290]: ⭐
            - heading "年度計劃" [level=4] [ref=e291]
            - generic [ref=e292]: HK$5,999
            - paragraph [ref=e293]: 全年無限次上課
            - paragraph [ref=e294]: 送 2 個月（等於 HK$834/月）
            - paragraph [ref=e295]: 🎫 無限簽到 + 🎁 教練 1:1 咨詢
            - button "了解更多" [ref=e296] [cursor=pointer]
      - generic [ref=e297]:
        - text: 個人資料 · My Profile
        - generic [ref=e298]:
          - generic [ref=e299]: 🧘
          - generic [ref=e300]:
            - heading "David Choy" [level=3] [ref=e301]
            - generic [ref=e302]:
              - generic [ref=e303]: 📧 david@zenpass.hk
              - generic [ref=e304]: 📱 9033 5538
            - generic [ref=e305]:
              - generic [ref=e306]: ✅ 已驗證
              - generic [ref=e307]: 🎖️ 推薦人
              - generic [ref=e308]: ⭐ 累計 150 Credits
          - button "編輯資料" [ref=e309] [cursor=pointer]
        - generic [ref=e311]:
          - generic [ref=e312]:
            - generic [ref=e313]: 📅
            - generic [ref=e314]: "12"
            - generic [ref=e315]: 已預約課堂
          - generic [ref=e316]:
            - generic [ref=e317]: 🏆
            - generic [ref=e318]: "5"
            - generic [ref=e319]: 獲得勳章
          - generic [ref=e320]:
            - generic [ref=e321]: ❤️
            - generic [ref=e322]: "150"
            - generic [ref=e323]: 推薦積分
      - generic [ref=e325]:
        - heading "準備好開始你嘅 Zen 旅程未？" [level=3] [ref=e326]
        - paragraph [ref=e327]: 首次體驗只需 HK$120，立即預約你嘅第一堂課！
        - button "立即預約 🎯" [ref=e328] [cursor=pointer]
  - contentinfo [ref=e330]:
    - generic [ref=e331]:
      - generic [ref=e332]:
        - generic [ref=e333]: 🧘 ZenPass 禪流
        - generic [ref=e334]:
          - text: 一個Pass，通行全城運動體驗。
          - text: 香港康樂及體育有限公司
      - generic [ref=e335]:
        - generic [ref=e336]: 探索
        - list [ref=e337]:
          - listitem [ref=e338]:
            - link "探索課程" [ref=e339] [cursor=pointer]:
              - /url: explore.html
          - listitem [ref=e340]:
            - link "星級教練" [ref=e341] [cursor=pointer]:
              - /url: coaches.html
          - listitem [ref=e342]:
            - link "會籍方案" [ref=e343] [cursor=pointer]:
              - /url: membership.html
          - listitem [ref=e344]:
            - link "成為教練" [ref=e345] [cursor=pointer]:
              - /url: coach-apply.html
          - listitem [ref=e346]:
            - link "場地加盟" [ref=e347] [cursor=pointer]:
              - /url: partner-apply.html
      - generic [ref=e348]:
        - generic [ref=e349]: 支援
        - list [ref=e350]:
          - listitem [ref=e351]:
            - link "常見問題" [ref=e352] [cursor=pointer]:
              - /url: faq.html
          - listitem [ref=e353]:
            - link "私隱政策" [ref=e354] [cursor=pointer]:
              - /url: privacy.html
          - listitem [ref=e355]:
            - link "服務條款" [ref=e356] [cursor=pointer]:
              - /url: terms.html
          - listitem [ref=e357]:
            - link "關於我們" [ref=e358] [cursor=pointer]:
              - /url: about.html
      - generic [ref=e359]:
        - generic [ref=e360]: 聯絡我們
        - list [ref=e361]:
          - listitem [ref=e362]: 📧 support@zenpass.hk
          - listitem [ref=e363]: 📞 2387 0724
          - listitem [ref=e364]: 📍 香港九龍觀塘
        - generic [ref=e365]:
          - link "📸" [ref=e366] [cursor=pointer]:
            - /url: https://www.instagram.com/zenpass_hk
          - link "👍" [ref=e367] [cursor=pointer]:
            - /url: https://www.facebook.com/zenpass.hk
          - link "💬" [ref=e368] [cursor=pointer]:
            - /url: https://wa.me/85290335538
          - link "🏛️" [ref=e369] [cursor=pointer]:
            - /url: https://hklfcl.com
    - generic [ref=e370]: © 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.
  - button "返回頂部": ↑
```

# Test source

```ts
  49  |   /html\s*\+?=\s*['"`]/,      // template string concatenation (wallet bug!)
  50  |   /fetch\(/,                   // fetch calls
  51  |   /localStorage\.(getItem|setItem)/, // storage access
  52  |   /JSON\.(parse|stringify)/,   // JSON operations
  53  |   /console\.(log|error)/,      // console statements
  54  |   /axios\./,                   // axios calls
  55  | ];
  56  | 
  57  | // ===== Console Error 收集 =====
  58  | const consoleErrors = [];
  59  | const jsErrors = [];
  60  | 
  61  | test.beforeEach(async ({ page }) => {
  62  |   consoleErrors.length = 0;
  63  |   jsErrors.length = 0;
  64  | 
  65  |   // Capture console.error
  66  |   page.on("console", (msg) => {
  67  |     if (msg.type() === "error") {
  68  |       consoleErrors.push(msg.text());
  69  |     }
  70  |   });
  71  | 
  72  |   // Capture uncaught exceptions
  73  |   page.on("pageerror", (err) => {
  74  |     jsErrors.push(err.message);
  75  |   });
  76  | });
  77  | 
  78  | // ===== Test 1: 每頁載入檢查 =====
  79  | test.describe("🔍 公開頁面全面檢查", () => {
  80  |   for (const url of ALL_PAGES) {
  81  |     test(`${url} loads clean`, async ({ page }) => {
  82  |       const resp = await page.goto(url, { waitUntil: "networkidle" });
  83  |       // Allow 404 if page doesn't exist yet (future feature)
  84  |       if (resp?.status() === 404) {
  85  |         console.log(`⚠️ ${url} returns 404 — skipping checks`);
  86  |         return;
  87  |       }
  88  |       expect(resp?.status()).toBe(200);
  89  | 
  90  |       // Wait for dynamic content
  91  |       await page.waitForTimeout(1000);
  92  | 
  93  |       // 1. Console errors — warn but don't fail for 404 resource loads
  94  |       if (consoleErrors.length > 0) {
  95  |         const non404Errors = consoleErrors.filter(e => !e.includes('404'));
  96  |         if (non404Errors.length > 0) {
  97  |           console.log(`❌ NON-404 ERRORS on ${url}:`, non404Errors);
  98  |           expect(non404Errors).toEqual([]);
  99  |         } else {
  100 |           console.log(`⚠️ ${url}: only 404 resource warnings (no real errors)`);
  101 |         }
  102 |       }
  103 | 
  104 |       // 2. JS runtime errors — always fail
  105 |       if (jsErrors.length > 0) {
  106 |         console.log(`❌ JS ERRORS on ${url}:`, jsErrors);
  107 |       }
  108 |       expect(jsErrors).toEqual([]);
  109 | 
  110 |       // 3. JS code leak check — look for visible JS code in page body
  111 |       const bodyText = await page.locator("body").innerText();
  112 |       for (const pattern of JS_LEAK_PATTERNS) {
  113 |         const leaked = bodyText.match(pattern);
  114 |         if (leaked) {
  115 |           console.log(`❌ JS LEAK on ${url}: matched "${leaked[0]}"`);
  116 |         }
  117 |         expect(leaked).toBeNull();
  118 |       }
  119 | 
  120 |       // 4. No broken images
  121 |       const brokenImgs = await page.locator("img[src]").evaluateAll((imgs) =>
  122 |         imgs.filter((img) => !img.complete || img.naturalWidth === 0).length
  123 |       );
  124 |       if (brokenImgs > 0) {
  125 |         console.log(`❌ BROKEN IMAGES on ${url}: ${brokenImgs}`);
  126 |       }
  127 |       expect(brokenImgs).toBe(0);
  128 |     });
  129 |   }
  130 | });
  131 | 
  132 | // ===== Test 2: Admin pages with token =====
  133 | test.describe("🔐 管理頁面檢查（已登入）", () => {
  134 |   test.beforeEach(async ({ page }) => {
  135 |     // 用真實 login API 攞 token
  136 |     await page.goto("/login.html");
  137 |     await page.fill("#login-email", "admin@zenpass.hk");
  138 |     await page.fill("#login-password", "admin123");
  139 |     await page.click("#login-btn");
  140 |     await page.waitForTimeout(2000);
  141 |   });
  142 | 
  143 |   for (const url of ADMIN_PAGES) {
  144 |     test(`admin ${url} loads clean`, async ({ page }) => {
  145 |       const resp = await page.goto(url, { waitUntil: "networkidle" });
  146 |       expect(resp?.status()).toBe(200);
  147 |       await page.waitForTimeout(1000);
  148 | 
> 149 |       expect(consoleErrors).toEqual([]);
      |                             ^ Error: expect(received).toEqual(expected) // deep equality
  150 |       expect(jsErrors).toEqual([]);
  151 | 
  152 |       // JS leak check
  153 |       const bodyText = await page.locator("body").innerText();
  154 |       for (const pattern of JS_LEAK_PATTERNS) {
  155 |         const leaked = bodyText.match(pattern);
  156 |         if (leaked) {
  157 |           console.log(`❌ JS LEAK on ${url}: matched "${leaked[0]}"`);
  158 |         }
  159 |         expect(leaked).toBeNull();
  160 |       }
  161 |     });
  162 |   }
  163 | });
  164 | 
  165 | // ===== Test 3: Navigation links 全部 200 =====
  166 | test.describe("🔗 Navigation Links", () => {
  167 |   test("all nav links are valid", async ({ page }) => {
  168 |     const pages = ["/", "/courses.html", "/login.html", "/faq.html"];
  169 |     for (const p of pages) {
  170 |       await page.goto(p);
  171 |       const links = await page
  172 |         .locator("nav a, .nav-link, header a")
  173 |         .all();
  174 |       for (const link of links) {
  175 |         const href = await link.getAttribute("href");
  176 |         if (href && href.startsWith("/")) {
  177 |           const resp = await page.request.get(href);
  178 |           if (resp.status() >= 400) {
  179 |             console.log(`❌ BROKEN LINK: ${href} (from ${p})`);
  180 |           }
  181 |           expect(resp.status()).toBeLessThan(400);
  182 |         }
  183 |       }
  184 |     }
  185 |   });
  186 | });
  187 | 
  188 | // ===== Test 4: Tab / Accordion 互動檢查 =====
  189 | test.describe("📑 Tab & Accordion 功能", () => {
  190 |   test("class-detail tabs work (overview, schedule, details)", async ({ page }) => {
  191 |     await page.goto(
  192 |       "/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258",
  193 |       { waitUntil: "networkidle" }
  194 |     );
  195 |     await page.waitForTimeout(1500);
  196 | 
  197 |     const tabs = page.locator(".tab-btn, .tab-link, [role='tab']");
  198 |     const tabCount = await tabs.count();
  199 | 
  200 |     if (tabCount > 0) {
  201 |       // Click each tab and verify content changes
  202 |       for (let i = 0; i < tabCount; i++) {
  203 |         await tabs.nth(i).click();
  204 |         await page.waitForTimeout(300);
  205 |         // Check no console errors after click
  206 |         expect(consoleErrors).toEqual([]);
  207 |         expect(jsErrors).toEqual([]);
  208 |         // Check content panel is visible
  209 |         const panel = page.locator(
  210 |           ".tab-content.active, .tab-panel.active, [role='tabpanel']"
  211 |         );
  212 |         const panelText = await panel.first().innerText();
  213 |         expect(panelText.length).toBeGreaterThan(0);
  214 |       }
  215 |     } else {
  216 |       console.log("⚠️ No tabs found on class-detail, skipping tab test");
  217 |       // Still verify the page has content
  218 |       const bodyText = await page.locator("body").innerText();
  219 |       expect(bodyText.length).toBeGreaterThan(50);
  220 |     }
  221 |   });
  222 | 
  223 |   test("admin tabs work", async ({ page }) => {
  224 |     // Login first
  225 |     await page.goto("/login.html");
  226 |     await page.fill("#login-email", "admin@zenpass.hk");
  227 |     await page.fill("#login-password", "admin123");
  228 |     await page.click("#login-btn");
  229 |     await page.waitForTimeout(2000);
  230 | 
  231 |     await page.goto("/admin.html", { waitUntil: "networkidle" });
  232 |     await page.waitForTimeout(1500);
  233 | 
  234 |     // Look for tab-like elements
  235 |     const tabs = page.locator(".tab-btn, .tab-link, [role='tab'], .nav-tabs a, .admin-tab");
  236 |     const tabCount = await tabs.count();
  237 | 
  238 |     if (tabCount > 0) {
  239 |       for (let i = 0; i < tabCount; i++) {
  240 |         await tabs.nth(i).click();
  241 |         await page.waitForTimeout(500);
  242 |         expect(consoleErrors).toEqual([]);
  243 |         expect(jsErrors).toEqual([]);
  244 | 
  245 |         // Check content appeared
  246 |         const activePanel = page.locator(
  247 |           ".tab-content:not([style*='display:none']), " +
  248 |           ".tab-content:not([style*='display: none']), " +
  249 |           ".tab-pane.active, " +
```