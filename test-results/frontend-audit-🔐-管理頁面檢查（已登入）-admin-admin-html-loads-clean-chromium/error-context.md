# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 🔐 管理頁面檢查（已登入） >> admin /admin.html loads clean
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
+   "[GSI_LOGGER]: FedCM get() rejects with AbortError: signal is aborted without reason",
+   "The request has been aborted.",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - text: 🧘 ZenPass
        - generic [ref=e5]: 管理後台
      - button "📊 儀表板" [ref=e6] [cursor=pointer]:
        - generic [ref=e7]: 📊
        - generic [ref=e8]: 儀表板
      - button "📎 付款確認" [ref=e9] [cursor=pointer]:
        - generic [ref=e10]: 📎
        - generic [ref=e11]: 付款確認
      - button "📅 預約管理" [ref=e12] [cursor=pointer]:
        - generic [ref=e13]: 📅
        - generic [ref=e14]: 預約管理
      - button "👤 用戶管理" [ref=e15] [cursor=pointer]:
        - generic [ref=e16]: 👤
        - generic [ref=e17]: 用戶管理
      - button "📚 課程管理" [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: 📚
        - generic [ref=e20]: 課程管理
      - button "📝 課程內容" [ref=e21] [cursor=pointer]:
        - generic [ref=e22]: 📝
        - generic [ref=e23]: 課程內容
      - button "⚙️ 資料庫更新" [ref=e24] [cursor=pointer]:
        - generic [ref=e25]: ⚙️
        - generic [ref=e26]: 資料庫更新
      - button "📣 行銷推廣" [ref=e27] [cursor=pointer]:
        - generic [ref=e28]: 📣
        - generic [ref=e29]: 行銷推廣
      - button "📊 進階報表" [ref=e30] [cursor=pointer]:
        - generic [ref=e31]: 📊
        - generic [ref=e32]: 進階報表
      - button "🏪 商戶管理" [ref=e33] [cursor=pointer]:
        - generic [ref=e34]: 🏪
        - generic [ref=e35]: 商戶管理
      - button "📋 教練申請" [ref=e36] [cursor=pointer]:
        - generic [ref=e37]: 📋
        - generic [ref=e38]: 教練申請
      - button "🪙 錢包管理" [ref=e39] [cursor=pointer]:
        - generic [ref=e40]: 🪙
        - generic [ref=e41]: 錢包管理
      - button "📋 審計日誌" [ref=e42] [cursor=pointer]:
        - generic [ref=e43]: 📋
        - generic [ref=e44]: 審計日誌
      - button "💰 定價設定" [ref=e45] [cursor=pointer]:
        - generic [ref=e46]: 💰
        - generic [ref=e47]: 定價設定
      - button "⚠️ 缺席罰款" [ref=e48] [cursor=pointer]:
        - generic [ref=e49]: ⚠️
        - generic [ref=e50]: 缺席罰款
      - generic [ref=e51] [cursor=pointer]:
        - generic [ref=e52]: 🚪
        - generic [ref=e53]: 登出
    - generic [ref=e54]:
      - generic [ref=e55]:
        - generic [ref=e56]:
          - heading "📊 儀表板" [level=1] [ref=e57]
          - generic [ref=e58]: 2026年6月8日星期一
        - generic [ref=e59]: admin@zenpass.hk
      - generic [ref=e60]:
        - generic [ref=e61]:
          - generic [ref=e62]: 👤
          - generic [ref=e63]: "28"
          - generic [ref=e64]: 總用戶
        - generic [ref=e65]:
          - generic [ref=e66]: 📚
          - generic [ref=e67]: "109"
          - generic [ref=e68]: 課程數
        - generic [ref=e69]:
          - generic [ref=e70]: 📅
          - generic [ref=e71]: "0"
          - generic [ref=e72]: 已確認預約
        - generic [ref=e73]:
          - generic [ref=e74]: 💰
          - generic [ref=e75]: HK$100
          - generic [ref=e76]: 總收入
      - generic [ref=e78]:
        - heading "📈 收入走勢" [level=3] [ref=e79]
        - button "📥 匯出 CSV" [ref=e80] [cursor=pointer]
      - generic [ref=e82]:
        - heading "⏳ 待處理項目" [level=3] [ref=e84]
        - paragraph [ref=e85]:
          - text: 待確認付款：
          - strong [ref=e86]: "0"
          - text: 筆
        - paragraph [ref=e87]:
          - text: 總預約：
          - strong [ref=e88]: "4"
          - text: 筆
  - contentinfo [ref=e89]:
    - generic [ref=e90]:
      - generic [ref=e91]:
        - generic [ref=e92]: 🧘 ZenPass 禪流
        - generic [ref=e93]:
          - text: 一個Pass，通行全城運動體驗。
          - text: 香港康樂及體育有限公司
      - generic [ref=e94]:
        - generic [ref=e95]: 探索
        - list [ref=e96]:
          - listitem [ref=e97]:
            - link "探索課程" [ref=e98] [cursor=pointer]:
              - /url: explore.html
          - listitem [ref=e99]:
            - link "星級教練" [ref=e100] [cursor=pointer]:
              - /url: coaches.html
          - listitem [ref=e101]:
            - link "會籍方案" [ref=e102] [cursor=pointer]:
              - /url: membership.html
          - listitem [ref=e103]:
            - link "成為教練" [ref=e104] [cursor=pointer]:
              - /url: coach-apply.html
          - listitem [ref=e105]:
            - link "場地加盟" [ref=e106] [cursor=pointer]:
              - /url: partner-apply.html
      - generic [ref=e107]:
        - generic [ref=e108]: 支援
        - list [ref=e109]:
          - listitem [ref=e110]:
            - link "常見問題" [ref=e111] [cursor=pointer]:
              - /url: faq.html
          - listitem [ref=e112]:
            - link "私隱政策" [ref=e113] [cursor=pointer]:
              - /url: privacy.html
          - listitem [ref=e114]:
            - link "服務條款" [ref=e115] [cursor=pointer]:
              - /url: terms.html
          - listitem [ref=e116]:
            - link "關於我們" [ref=e117] [cursor=pointer]:
              - /url: about.html
      - generic [ref=e118]:
        - generic [ref=e119]: 聯絡我們
        - list [ref=e120]:
          - listitem [ref=e121]: 📧 support@zenpass.hk
          - listitem [ref=e122]: 📞 2387 0724
          - listitem [ref=e123]: 📍 香港九龍觀塘
        - generic [ref=e124]:
          - link "📸" [ref=e125] [cursor=pointer]:
            - /url: https://www.instagram.com/zenpass_hk
          - link "👍" [ref=e126] [cursor=pointer]:
            - /url: https://www.facebook.com/zenpass.hk
          - link "💬" [ref=e127] [cursor=pointer]:
            - /url: https://wa.me/85290335538
          - link "🏛️" [ref=e128] [cursor=pointer]:
            - /url: https://hklfcl.com
    - generic [ref=e129]: © 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.
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