# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 🔐 管理頁面檢查（已登入） >> admin /add-demo-class.html loads clean
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
    - link "←" [ref=e3] [cursor=pointer]:
      - /url: coach-dashboard.html
    - heading "➕ 新增課堂時間" [level=1] [ref=e4]
  - generic [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]: 選擇課程
      - combobox [ref=e8]:
        - option "— 暫無課程，請先建立課程 —" [selected]
    - generic [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]: 日期
        - textbox [ref=e12]: 2026-06-09
      - generic [ref=e13]:
        - generic [ref=e14]: 開始時間
        - textbox [ref=e15]: 09:00
    - generic [ref=e16]:
      - generic [ref=e17]:
        - generic [ref=e18]: 結束時間
        - textbox [ref=e19]: 10:00
      - generic [ref=e20]:
        - generic [ref=e21]: 名額
        - spinbutton [ref=e22]: "20"
    - generic [ref=e24]:
      - checkbox "每週重複" [ref=e25]
      - text: 每週重複
    - button "✅ 新增課堂時間" [ref=e26] [cursor=pointer]
    - button "← 返回" [ref=e27] [cursor=pointer]
  - contentinfo [ref=e29]:
    - generic [ref=e30]:
      - generic [ref=e31]:
        - generic [ref=e32]: 🧘 ZenPass 禪流
        - generic [ref=e33]:
          - text: 一個Pass，通行全城運動體驗。
          - text: 香港康樂及體育有限公司
      - generic [ref=e34]:
        - generic [ref=e35]: 探索
        - list [ref=e36]:
          - listitem [ref=e37]:
            - link "探索課程" [ref=e38] [cursor=pointer]:
              - /url: explore.html
          - listitem [ref=e39]:
            - link "星級教練" [ref=e40] [cursor=pointer]:
              - /url: coaches.html
          - listitem [ref=e41]:
            - link "會籍方案" [ref=e42] [cursor=pointer]:
              - /url: membership.html
          - listitem [ref=e43]:
            - link "成為教練" [ref=e44] [cursor=pointer]:
              - /url: coach-apply.html
          - listitem [ref=e45]:
            - link "場地加盟" [ref=e46] [cursor=pointer]:
              - /url: partner-apply.html
      - generic [ref=e47]:
        - generic [ref=e48]: 支援
        - list [ref=e49]:
          - listitem [ref=e50]:
            - link "常見問題" [ref=e51] [cursor=pointer]:
              - /url: faq.html
          - listitem [ref=e52]:
            - link "私隱政策" [ref=e53] [cursor=pointer]:
              - /url: privacy.html
          - listitem [ref=e54]:
            - link "服務條款" [ref=e55] [cursor=pointer]:
              - /url: terms.html
          - listitem [ref=e56]:
            - link "關於我們" [ref=e57] [cursor=pointer]:
              - /url: about.html
      - generic [ref=e58]:
        - generic [ref=e59]: 聯絡我們
        - list [ref=e60]:
          - listitem [ref=e61]: 📧 support@zenpass.hk
          - listitem [ref=e62]: 📞 2387 0724
          - listitem [ref=e63]: 📍 香港九龍觀塘
        - generic [ref=e64]:
          - link "📸" [ref=e65] [cursor=pointer]:
            - /url: https://www.instagram.com/zenpass_hk
          - link "👍" [ref=e66] [cursor=pointer]:
            - /url: https://www.facebook.com/zenpass.hk
          - link "💬" [ref=e67] [cursor=pointer]:
            - /url: https://wa.me/85290335538
          - link "🏛️" [ref=e68] [cursor=pointer]:
            - /url: https://hklfcl.com
    - generic [ref=e69]: © 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.
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