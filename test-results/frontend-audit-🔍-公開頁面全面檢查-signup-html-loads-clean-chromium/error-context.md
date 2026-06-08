# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 🔍 公開頁面全面檢查 >> /signup.html loads clean
- Location: tests/e2e/frontend-audit.spec.js:81:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 5

- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 400 ()",
+   "[GSI_LOGGER]: The given origin is not allowed for the given client ID.",
+   "Provider's accounts list is empty.",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]: 🧘
      - heading "ZenPass 禪流" [level=1] [ref=e5]
      - paragraph [ref=e6]: 解鎖全城 運動體驗
    - generic [ref=e7]:
      - generic [ref=e8] [cursor=pointer]: 登入
      - generic [ref=e9] [cursor=pointer]: 註冊
    - generic [ref=e10]:
      - generic [ref=e11]:
        - generic [ref=e12]: 電郵
        - textbox "your@email.com" [ref=e13]
      - generic [ref=e14]:
        - generic [ref=e15]: 密碼
        - textbox "••••••" [ref=e16]
      - button "登入" [ref=e17] [cursor=pointer]
      - generic [ref=e18]: 快速登入
      - generic [ref=e21]:
        - button "使用 Google 帳戶登入。在新分頁中開啟" [ref=e23] [cursor=pointer]:
          - generic [ref=e25]:
            - img [ref=e27]
            - generic [ref=e34]: 使用 Google 帳戶登入
        - iframe
      - button " Apple 登入" [ref=e35] [cursor=pointer]:
        - generic [ref=e36]: 
        - text: Apple 登入
      - generic [ref=e37]: 開發模式
      - button "🔑 快速登入 (管理員)" [ref=e38] [cursor=pointer]
      - button "🔑 快速登入 (教練)" [ref=e39] [cursor=pointer]
      - button "🔑 快速登入 (學生)" [ref=e40] [cursor=pointer]
  - contentinfo [ref=e41]:
    - generic [ref=e42]:
      - generic [ref=e43]:
        - generic [ref=e44]: 🧘 ZenPass 禪流
        - generic [ref=e45]:
          - text: 一個Pass，通行全城運動體驗。
          - text: 香港康樂及體育有限公司
      - generic [ref=e46]:
        - generic [ref=e47]: 探索
        - list [ref=e48]:
          - listitem [ref=e49]:
            - link "探索課程" [ref=e50] [cursor=pointer]:
              - /url: explore.html
          - listitem [ref=e51]:
            - link "星級教練" [ref=e52] [cursor=pointer]:
              - /url: coaches.html
          - listitem [ref=e53]:
            - link "會籍方案" [ref=e54] [cursor=pointer]:
              - /url: membership.html
          - listitem [ref=e55]:
            - link "成為教練" [ref=e56] [cursor=pointer]:
              - /url: coach-apply.html
          - listitem [ref=e57]:
            - link "場地加盟" [ref=e58] [cursor=pointer]:
              - /url: partner-apply.html
      - generic [ref=e59]:
        - generic [ref=e60]: 支援
        - list [ref=e61]:
          - listitem [ref=e62]:
            - link "常見問題" [ref=e63] [cursor=pointer]:
              - /url: faq.html
          - listitem [ref=e64]:
            - link "私隱政策" [ref=e65] [cursor=pointer]:
              - /url: privacy.html
          - listitem [ref=e66]:
            - link "服務條款" [ref=e67] [cursor=pointer]:
              - /url: terms.html
          - listitem [ref=e68]:
            - link "關於我們" [ref=e69] [cursor=pointer]:
              - /url: about.html
      - generic [ref=e70]:
        - generic [ref=e71]: 聯絡我們
        - list [ref=e72]:
          - listitem [ref=e73]: 📧 support@zenpass.hk
          - listitem [ref=e74]: 📞 2387 0724
          - listitem [ref=e75]: 📍 香港九龍觀塘
        - generic [ref=e76]:
          - link "📸" [ref=e77] [cursor=pointer]:
            - /url: https://www.instagram.com/zenpass_hk
          - link "👍" [ref=e78] [cursor=pointer]:
            - /url: https://www.facebook.com/zenpass.hk
          - link "💬" [ref=e79] [cursor=pointer]:
            - /url: https://wa.me/85290335538
          - link "🏛️" [ref=e80] [cursor=pointer]:
            - /url: https://hklfcl.com
    - generic [ref=e81]: © 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.
  - button "返回頂部": ↑
```

# Test source

```ts
  1   | // ZenPass Frontend Audit — 每日全面頁面檢查
  2   | // 目標：捉到 JS syntax error、code 外露、broken links、tab 失效
  3   | import { test, expect } from "@playwright/test";
  4   | 
  5   | const BASE = "http://localhost:3001";
  6   | 
  7   | // ===== 所有公開頁面 =====
  8   | const ALL_PAGES = [
  9   |   "/",
  10  |   "/404.html",
  11  |   "/about.html",
  12  |   "/badges.html",
  13  |   "/buy-credits.html",
  14  |   "/checkin.html",
  15  |   "/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258",
  16  |   "/coach-apply.html",
  17  |   "/coach-dashboard.html",
  18  |   "/coach-profile.html",
  19  |   "/coaches.html",
  20  |   "/courses.html",
  21  |   "/crm.html",
  22  |   "/demo-setup.html",
  23  |   "/explore.html",
  24  |   "/faq.html",
  25  |   "/index.html",
  26  |   "/login.html",
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
> 98  |           expect(non404Errors).toEqual([]);
      |                                ^ Error: expect(received).toEqual(expected) // deep equality
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
```