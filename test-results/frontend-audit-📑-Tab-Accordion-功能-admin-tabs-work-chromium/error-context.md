# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 📑 Tab & Accordion 功能 >> admin tabs work
- Location: tests/e2e/frontend-audit.spec.js:223:3

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
> 267 |     expect(adminNon404).toEqual([]);
      |                         ^ Error: expect(received).toEqual(expected) // deep equality
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
  300 |     expect(walletNon404).toEqual([]);
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
```