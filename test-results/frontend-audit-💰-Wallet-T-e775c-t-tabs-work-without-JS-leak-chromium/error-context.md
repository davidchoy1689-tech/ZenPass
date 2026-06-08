# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 💰 Wallet Tab Integration >> wallet tabs work without JS leak
- Location: tests/e2e/frontend-audit.spec.js:273:3

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
  - generic [ref=e3]:
    - link "← 返回" [ref=e4] [cursor=pointer]:
      - /url: my.html
    - heading "💰 錢包" [level=1] [ref=e5]
  - generic [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]: 🎫 Credits 餘額
      - generic [ref=e9]: 0 cr
      - link "➕ 加購" [ref=e10] [cursor=pointer]:
        - /url: buy-credits.html
    - generic [ref=e11]:
      - generic [ref=e12]: 💰 銀包結餘
      - generic [ref=e13]: HK$0.00
      - generic [ref=e14]: 教練／夥伴專用
  - generic [ref=e15]:
    - generic [ref=e16] [cursor=pointer]: 🎫 Credits
    - generic [ref=e17] [cursor=pointer]: 💰 銀包
  - generic [ref=e19]:
    - generic [ref=e20]: 🎫
    - generic [ref=e21]:
      - text: 尚未有交易記錄
      - text: 預約課程後會喺呢度顯示
  - generic [ref=e22]:
    - link "🏠 首頁" [ref=e23] [cursor=pointer]:
      - /url: index.html
      - generic [ref=e24]: 🏠
      - text: 首頁
    - link "📋 課程" [ref=e25] [cursor=pointer]:
      - /url: courses.html
      - generic [ref=e26]: 📋
      - text: 課程
    - link "📅 我的預約" [ref=e27] [cursor=pointer]:
      - /url: my-bookings.html
      - generic [ref=e28]: 📅
      - text: 我的預約
    - link "👤 帳戶" [ref=e29] [cursor=pointer]:
      - /url: my.html
      - generic [ref=e30]: 👤
      - text: 帳戶
```

# Test source

```ts
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
  250 |           "[role='tabpanel']:not([hidden])"
  251 |         );
  252 |         const panelCount = await activePanel.count();
  253 |         if (panelCount > 0) {
  254 |           const text = await activePanel.first().innerText();
  255 |           expect(text.length).toBeGreaterThan(0);
  256 |         }
  257 |       }
  258 |     } else {
  259 |       console.log("⚠️ No admin tabs found, skipping tab test");
  260 |     }
  261 |     expect(jsErrors).toEqual([]);
  262 |     // Only fail on non-404 console errors
  263 |     const adminNon404 = consoleErrors.filter(e => !e.includes('404'));
  264 |     if (adminNon404.length > 0) {
  265 |       console.log('❌ Admin non-404 console errors:', adminNon404);
  266 |     }
  267 |     expect(adminNon404).toEqual([]);
  268 |   });
  269 | });
  270 | 
  271 | // ===== Test 5: Wallet page (特别容易出事) =====
  272 | test.describe("💰 Wallet Tab Integration", () => {
  273 |   test("wallet tabs work without JS leak", async ({ page }) => {
  274 |     // Login
  275 |     await page.goto("/login.html");
  276 |     await page.fill("#login-email", "admin@zenpass.hk");
  277 |     await page.fill("#login-password", "admin123");
  278 |     await page.click("#login-btn");
  279 |     await page.waitForTimeout(2000);
  280 | 
  281 |     const respW = await page.goto("/wallet.html", { waitUntil: "networkidle" });
  282 |     if (respW?.status() === 404) {
  283 |       console.log("⚠️ wallet.html returns 404 — skipping wallet tab test");
  284 |       return;
  285 |     }
  286 |     await page.waitForTimeout(1500);
  287 | 
  288 |     // Check no JS leak
  289 |     const bodyText = await page.locator("body").innerText();
  290 |     for (const pattern of JS_LEAK_PATTERNS) {
  291 |       const leaked = bodyText.match(pattern);
  292 |       if (leaked) {
  293 |         console.log(`❌ JS LEAK on wallet: matched "${leaked[0]}"`);
  294 |       }
  295 |       expect(leaked).toBeNull();
  296 |     }
  297 | 
  298 |     // No console errors (allow 404 resource loads)
  299 |     const walletNon404 = consoleErrors.filter(e => !e.includes('404'));
> 300 |     expect(walletNon404).toEqual([]);
      |                          ^ Error: expect(received).toEqual(expected) // deep equality
  301 |     expect(jsErrors).toEqual([]);
  302 | 
  303 |     // Click wallet tabs
  304 |     const tabs = page.locator(".wallet-tab, .tab-btn, [role='tab']");
  305 |     const tabCount = await tabs.count();
  306 |     if (tabCount > 0) {
  307 |       for (let i = 0; i < tabCount; i++) {
  308 |         await tabs.nth(i).click();
  309 |         await page.waitForTimeout(500);
  310 |         expect(consoleErrors).toEqual([]);
  311 |         expect(jsErrors).toEqual([]);
  312 |       }
  313 |     }
  314 | 
  315 |     // Verify wallet data loaded (no raw template text)
  316 |     const bodyViewText = await page.locator("body").innerText();
  317 |     // Check no raw template literals visible
  318 |     expect(bodyViewText).not.toContain("html += ");
  319 |     expect(bodyViewText).not.toContain("+= '<tr");
  320 |   });
  321 | });
  322 | 
  323 | // ===== Test 6: Class detail tab wallet-like bug check =====
  324 | test.describe("📋 特別檢查：JS code 外露 Bug", () => {
  325 |   test("no html += template leak on any page", async ({ page }) => {
  326 |     // Check a subset of heavy JS pages
  327 |     const heavyPages = [
  328 |       "/admin.html",
  329 |       "/wallet.html",
  330 |       "/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258",
  331 |       "/coach-dashboard.html",
  332 |       "/crm.html",
  333 |       "/buy-credits.html",
  334 |     ];
  335 |     for (const url of heavyPages) {
  336 |       const resp = await page.goto(url, { waitUntil: "networkidle" });
  337 |       if (!resp || resp.status() >= 400) continue;
  338 |       await page.waitForTimeout(1000);
  339 | 
  340 |       // Use innerText (visible text only) instead of innerHTML to exclude <script> content
  341 |       const bodyText = await page.locator("body").innerText();
  342 |       // Check for JS code that escaped the <script> tag
  343 |       const leakIndicators = [
  344 |         "html += '",
  345 |         'html += "',
  346 |         "html += `",
  347 |         "+= '<tr",
  348 |         '+= "<tr',
  349 |         "+= `<tr",
  350 |         "function loadWalletData",
  351 |         "function loadTransactions",
  352 |         "function login()",
  353 |         "function logout()",
  354 |       ];
  355 |       for (const indicator of leakIndicators) {
  356 |         if (bodyText.includes(indicator)) {
  357 |           console.log(`❌ JS LEAK on ${url}: found "${indicator}" in viewable text`);
  358 |         }
  359 |         expect(bodyText).not.toContain(indicator);
  360 |       }
  361 |       // Only fail on non-404 console errors
  362 |       const non404CE = consoleErrors.filter(e => !e.includes('404'));
  363 |       expect(non404CE).toEqual([]);
  364 |       expect(jsErrors).toEqual([]);
  365 |     }
  366 |   });
  367 | });
  368 | 
```