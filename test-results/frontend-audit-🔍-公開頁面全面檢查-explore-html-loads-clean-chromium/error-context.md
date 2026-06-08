# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 🔍 公開頁面全面檢查 >> /explore.html loads clean
- Location: tests/e2e/frontend-audit.spec.js:81:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 6
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "←" [ref=e3] [cursor=pointer]:
      - /url: index.html
    - heading "探索課程" [level=1] [ref=e4]
    - generic [ref=e5]:
      - textbox "🔍 搜尋課程、教練、運動類型..." [ref=e6]
      - button "☰ 篩選" [ref=e7] [cursor=pointer]
  - generic [ref=e9]:
    - generic [ref=e10]:
      - generic [ref=e11] [cursor=pointer]: 🏠 全部
      - generic [ref=e12] [cursor=pointer]: 新興運動
      - generic [ref=e13] [cursor=pointer]: 健身
      - generic [ref=e14] [cursor=pointer]: 瑜伽
      - generic [ref=e15] [cursor=pointer]: 伸展
      - generic [ref=e16] [cursor=pointer]: 舞蹈
      - generic [ref=e17] [cursor=pointer]: 長者體適能
      - generic [ref=e18] [cursor=pointer]: TRX 懸吊訓練
      - generic [ref=e19] [cursor=pointer]: 乒乓球
      - generic [ref=e20] [cursor=pointer]: 保齡球
      - generic [ref=e21] [cursor=pointer]: 兒童體適能
      - generic [ref=e22] [cursor=pointer]: 冥想
      - generic [ref=e23] [cursor=pointer]: 劍擊
      - generic [ref=e24] [cursor=pointer]: 單車
      - generic [ref=e25] [cursor=pointer]: 太極養生
      - generic [ref=e26] [cursor=pointer]: 射箭
      - generic [ref=e27] [cursor=pointer]: 心肺訓練
      - generic [ref=e28] [cursor=pointer]: 拳擊搏擊
      - generic [ref=e29] [cursor=pointer]: 攀岩
      - generic [ref=e30] [cursor=pointer]: 水中運動
      - generic [ref=e31] [cursor=pointer]: 泰拳搏擊
      - generic [ref=e32] [cursor=pointer]: 溜冰
      - generic [ref=e33] [cursor=pointer]: 產後修復
      - generic [ref=e34] [cursor=pointer]: 皮拉提斯
      - generic [ref=e35] [cursor=pointer]: 空中瑜伽
      - generic [ref=e36] [cursor=pointer]: 網球
      - generic [ref=e37] [cursor=pointer]: 羽毛球
      - generic [ref=e38] [cursor=pointer]: 肌力訓練
      - generic [ref=e39] [cursor=pointer]: 芭蕾塑形
      - generic [ref=e40] [cursor=pointer]: 詠春
      - generic [ref=e41] [cursor=pointer]: 遠足行山
      - generic [ref=e42] [cursor=pointer]: 露營戶外
      - generic [ref=e43] [cursor=pointer]: 高爾夫球
    - generic [ref=e45] [cursor=pointer]:
      - generic [ref=e46]: "06"
      - generic [ref=e47]: 今天
    - generic [ref=e50] [cursor=pointer]: 📅 全部
    - generic [ref=e51]:
      - generic [ref=e52] [cursor=pointer]: 🌱全部
      - generic [ref=e53] [cursor=pointer]: 🌱初級
      - generic [ref=e54] [cursor=pointer]: 🔥中級
      - generic [ref=e55] [cursor=pointer]: 💎高級
      - generic [ref=e57] [cursor=pointer]: 💰全部
      - generic [ref=e58] [cursor=pointer]: $0-100
      - generic [ref=e59] [cursor=pointer]: $100-200
      - generic [ref=e60] [cursor=pointer]: $200-300
      - generic [ref=e61] [cursor=pointer]: $300+
      - generic [ref=e63] [cursor=pointer]: 📍全部
      - generic [ref=e64] [cursor=pointer]: 港島
      - generic [ref=e65] [cursor=pointer]: 九龍
      - generic [ref=e66] [cursor=pointer]: 新界
      - generic [ref=e67] [cursor=pointer]: 線上
      - generic [ref=e69] [cursor=pointer]: 🔥熱門
      - generic [ref=e70] [cursor=pointer]: 💵低→高
      - generic [ref=e71] [cursor=pointer]: 💵高→低
      - generic [ref=e72] [cursor=pointer]: ⭐評分
    - generic [ref=e73]:
      - generic [ref=e74]: 20 / 109 個課程
      - button "🔄 清除" [ref=e75]
  - generic [ref=e76]:
    - generic [ref=e77] [cursor=pointer]:
      - img "辦公室伸展舒壓" [ref=e79]
      - generic [ref=e80]:
        - generic [ref=e81]: 伸展
        - generic [ref=e82]:
          - generic [ref=e83]: 辦公室伸展舒壓
          - button "♡" [ref=e84]
        - generic [ref=e85]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e86]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e87]: HK$90
    - generic [ref=e88] [cursor=pointer]:
      - img "頌缽療癒 Sound Bath" [ref=e90]
      - generic [ref=e91]:
        - generic [ref=e92]: 冥想
        - generic [ref=e93]:
          - generic [ref=e94]: 頌缽療癒 Sound Bath
          - button "♡" [ref=e95]
        - generic [ref=e96]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e97]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e98]: HK$120
    - generic [ref=e99] [cursor=pointer]:
      - img "產後修復 Pilates" [ref=e101]
      - generic [ref=e102]:
        - generic [ref=e103]: 產後修復
        - generic [ref=e104]:
          - generic [ref=e105]: 產後修復 Pilates
          - button "♡" [ref=e106]
        - generic [ref=e107]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e108]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e109]: HK$180
    - generic [ref=e110] [cursor=pointer]:
      - img "空中瑜伽 Aerial Yoga" [ref=e112]
      - generic [ref=e113]:
        - generic [ref=e114]: 空中瑜伽
        - generic [ref=e115]:
          - generic [ref=e116]: 空中瑜伽 Aerial Yoga
          - button "♡" [ref=e117]
        - generic [ref=e118]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e119]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e120]: HK$200
    - generic [ref=e121] [cursor=pointer]:
      - img "空中舞韻 Aerial Dance" [ref=e123]
      - generic [ref=e124]:
        - generic [ref=e125]: 空中瑜伽
        - generic [ref=e126]:
          - generic [ref=e127]: 空中舞韻 Aerial Dance
          - button "♡" [ref=e128]
        - generic [ref=e129]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e130]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e131]: HK$220
    - generic [ref=e132] [cursor=pointer]:
      - img "戶外露營體驗營" [ref=e134]
      - generic [ref=e135]:
        - generic [ref=e136]: 露營戶外
        - generic [ref=e137]:
          - generic [ref=e138]: 戶外露營體驗營
          - button "♡" [ref=e139]
        - generic [ref=e140]: 📍 西貢露營區
        - generic [ref=e141]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e142]: HK$350
    - generic [ref=e143] [cursor=pointer]:
      - img "拳擊有氧 Boxing Fitness" [ref=e145]
      - generic [ref=e146]:
        - generic [ref=e147]: 拳擊搏擊
        - generic [ref=e148]:
          - generic [ref=e149]: 拳擊有氧 Boxing Fitness
          - button "♡" [ref=e150]
        - generic [ref=e151]: 📍 ZenSpace 健身室
        - generic [ref=e152]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e153]: HK$140
    - generic [ref=e154] [cursor=pointer]:
      - img "Kpop 舞蹈班" [ref=e156]
      - generic [ref=e157]:
        - generic [ref=e158]: 舞蹈
        - generic [ref=e159]:
          - generic [ref=e160]: Kpop 舞蹈班
          - button "♡" [ref=e161]
        - generic [ref=e162]: 📍 ZenSpace 舞蹈室
        - generic [ref=e163]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e164]: HK$140
    - generic [ref=e165] [cursor=pointer]:
      - img "室內攀岩體驗" [ref=e167]
      - generic [ref=e168]:
        - generic [ref=e169]: 攀岩
        - generic [ref=e170]:
          - generic [ref=e171]: 室內攀岩體驗
          - button "♡" [ref=e172]
        - generic [ref=e173]: 📍 香港攀岩中心
        - generic [ref=e174]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e175]: HK$180
    - generic [ref=e176] [cursor=pointer]:
      - img "太極養生基礎班" [ref=e178]
      - generic [ref=e179]:
        - generic [ref=e180]: 太極養生
        - generic [ref=e181]:
          - generic [ref=e182]: 太極養生基礎班
          - button "♡" [ref=e183]
        - generic [ref=e184]: 📍 維多利亞公園
        - generic [ref=e185]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e186]: HK$100
    - generic [ref=e187] [cursor=pointer]:
      - img "晨跑訓練班" [ref=e189]
      - generic [ref=e190]:
        - generic [ref=e191]: 心肺訓練
        - generic [ref=e192]:
          - generic [ref=e193]: 晨跑訓練班
          - button "♡" [ref=e194]
        - generic [ref=e195]: 📍 維多利亞公園
        - generic [ref=e196]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e197]: HK$60
    - generic [ref=e198] [cursor=pointer]:
      - img "週末行山團 Hiking" [ref=e200]
      - generic [ref=e201]:
        - generic [ref=e202]: 遠足行山
        - generic [ref=e203]:
          - generic [ref=e204]: 週末行山團 Hiking
          - button "♡" [ref=e205]
        - generic [ref=e206]: 📍 港島龍脊
        - generic [ref=e207]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e208]: HK$50
    - generic [ref=e209] [cursor=pointer]:
      - img "睡前三分鐘冥想" [ref=e211]
      - generic [ref=e212]:
        - generic [ref=e213]: 冥想
        - generic [ref=e214]:
          - generic [ref=e215]: 睡前三分鐘冥想
          - button "♡" [ref=e216]
        - generic [ref=e217]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e218]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e219]: HK$50
    - generic [ref=e220] [cursor=pointer]:
      - img "長者平衡防跌班" [ref=e222]
      - generic [ref=e223]:
        - generic [ref=e224]: 長者體適能
        - generic [ref=e225]:
          - generic [ref=e226]: 長者平衡防跌班
          - button "♡" [ref=e227]
        - generic [ref=e228]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e229]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e230]: HK$70
    - generic [ref=e231] [cursor=pointer]:
      - img "長者健體伸展班" [ref=e233]
      - generic [ref=e234]:
        - generic [ref=e235]: 長者體適能
        - generic [ref=e236]:
          - generic [ref=e237]: 長者健體伸展班
          - button "♡" [ref=e238]
        - generic [ref=e239]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e240]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e241]: HK$80
    - generic [ref=e242] [cursor=pointer]:
      - img "夜間行山探險" [ref=e244]
      - generic [ref=e245]:
        - generic [ref=e246]: 遠足行山
        - generic [ref=e247]:
          - generic [ref=e248]: 夜間行山探險
          - button "♡" [ref=e249]
        - generic [ref=e250]: 📍 太平山頂
        - generic [ref=e251]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e252]: HK$80
    - generic [ref=e253] [cursor=pointer]:
      - img "八段錦養生功" [ref=e255]
      - generic [ref=e256]:
        - generic [ref=e257]: 太極養生
        - generic [ref=e258]:
          - generic [ref=e259]: 八段錦養生功
          - button "♡" [ref=e260]
        - generic [ref=e261]: 📍 維多利亞公園
        - generic [ref=e262]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e263]: HK$90
    - generic [ref=e264] [cursor=pointer]:
      - img "全身筋膜放鬆伸展" [ref=e266]
      - generic [ref=e267]:
        - generic [ref=e268]: 伸展
        - generic [ref=e269]:
          - generic [ref=e270]: 全身筋膜放鬆伸展
          - button "♡" [ref=e271]
        - generic [ref=e272]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e273]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e274]: HK$120
    - generic [ref=e275] [cursor=pointer]:
      - img "皮拉提斯脊椎保健" [ref=e277]
      - generic [ref=e278]:
        - generic [ref=e279]: 皮拉提斯
        - generic [ref=e280]:
          - generic [ref=e281]: 皮拉提斯脊椎保健
          - button "♡" [ref=e282]
        - generic [ref=e283]: 📍 ZenSpace 瑜伽教室
        - generic [ref=e284]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e285]: HK$150
    - generic [ref=e286] [cursor=pointer]:
      - img "女子防衛術班" [ref=e288]
      - generic [ref=e289]:
        - generic [ref=e290]: 拳擊搏擊
        - generic [ref=e291]:
          - generic [ref=e292]: 女子防衛術班
          - button "♡" [ref=e293]
        - generic [ref=e294]: 📍 ZenSpace 健身室
        - generic [ref=e295]: ⏱ 60min · ⭐4.8 · 👤 靜儀導師
        - generic [ref=e296]: HK$160
  - navigation "底部導航" [ref=e297]:
    - link "🏠 首頁" [ref=e298] [cursor=pointer]:
      - /url: index.html
      - generic [ref=e299]: 🏠
      - text: 首頁
    - link "🔍 探索" [ref=e300] [cursor=pointer]:
      - /url: explore.html
      - generic [ref=e301]: 🔍
      - text: 探索
    - link "💎 會籍" [ref=e302] [cursor=pointer]:
      - /url: membership.html
      - generic [ref=e303]: 💎
      - text: 會籍
    - link "👨‍🏫 成為教練" [ref=e304] [cursor=pointer]:
      - /url: coach-apply.html
      - generic [ref=e305]: 👨‍🏫
      - text: 成為教練
    - link "👤 我的" [ref=e306] [cursor=pointer]:
      - /url: my.html
      - generic [ref=e307]: 👤
      - text: 我的
  - contentinfo [ref=e308]:
    - generic [ref=e309]:
      - generic [ref=e310]:
        - generic [ref=e311]: 🧘 ZenPass 禪流
        - generic [ref=e312]:
          - text: 一個Pass，通行全城運動體驗。
          - text: 香港康樂及體育有限公司
      - generic [ref=e313]:
        - generic [ref=e314]: 探索
        - list [ref=e315]:
          - listitem [ref=e316]:
            - link "探索課程" [ref=e317] [cursor=pointer]:
              - /url: explore.html
          - listitem [ref=e318]:
            - link "星級教練" [ref=e319] [cursor=pointer]:
              - /url: coaches.html
          - listitem [ref=e320]:
            - link "會籍方案" [ref=e321] [cursor=pointer]:
              - /url: membership.html
          - listitem [ref=e322]:
            - link "成為教練" [ref=e323] [cursor=pointer]:
              - /url: coach-apply.html
          - listitem [ref=e324]:
            - link "場地加盟" [ref=e325] [cursor=pointer]:
              - /url: partner-apply.html
      - generic [ref=e326]:
        - generic [ref=e327]: 支援
        - list [ref=e328]:
          - listitem [ref=e329]:
            - link "常見問題" [ref=e330] [cursor=pointer]:
              - /url: faq.html
          - listitem [ref=e331]:
            - link "私隱政策" [ref=e332] [cursor=pointer]:
              - /url: privacy.html
          - listitem [ref=e333]:
            - link "服務條款" [ref=e334] [cursor=pointer]:
              - /url: terms.html
          - listitem [ref=e335]:
            - link "關於我們" [ref=e336] [cursor=pointer]:
              - /url: about.html
      - generic [ref=e337]:
        - generic [ref=e338]: 聯絡我們
        - list [ref=e339]:
          - listitem [ref=e340]: 📧 support@zenpass.hk
          - listitem [ref=e341]: 📞 2387 0724
          - listitem [ref=e342]: 📍 香港九龍觀塘
        - generic [ref=e343]:
          - link "📸" [ref=e344] [cursor=pointer]:
            - /url: https://www.instagram.com/zenpass_hk
          - link "👍" [ref=e345] [cursor=pointer]:
            - /url: https://www.facebook.com/zenpass.hk
          - link "💬" [ref=e346] [cursor=pointer]:
            - /url: https://wa.me/85290335538
          - link "🏛️" [ref=e347] [cursor=pointer]:
            - /url: https://hklfcl.com
    - generic [ref=e348]: © 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.
  - button "返回頂部": ↑
```

# Test source

```ts
  27  |   "/privacy.html",
  28  |   "/profile.html",
  29  |   "/signup.html",
  30  |   "/terms.html",
  31  |   "/wallet.html",
  32  | ];
  33  | 
  34  | // ===== 管理員頁面（需要 token）=====
  35  | const ADMIN_PAGES = [
  36  |   "/admin.html",
  37  |   "/add-demo-class.html",
  38  |   "/design-prototype.html",
  39  | ];
  40  | 
  41  | // ===== JS code 外露檢測 pattern =====
  42  | const JS_LEAK_PATTERNS = [
  43  |   /function\s+\w+\s*\(/,       // function declaration
  44  |   /const\s+\w+\s*=/,           // const assignment
  45  |   /let\s+\w+\s*=/,             // let assignment
  46  |   /var\s+\w+\s*=/,             // var assignment
  47  |   /document\.(getElementById|querySelector)/, // DOM methods
  48  |   /\.addEventListener\(/,      // event listeners
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
> 127 |       expect(brokenImgs).toBe(0);
      |                          ^ Error: expect(received).toBe(expected) // Object.is equality
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
  149 |       expect(consoleErrors).toEqual([]);
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
```