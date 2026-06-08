# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-audit.spec.js >> 🔍 公開頁面全面檢查 >> /profile.html loads clean
- Location: tests/e2e/frontend-audit.spec.js:81:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 9

- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+   "Failed to load resource: the server responded with a status of 403 (Forbidden)",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - heading "我的帳戶" [level=1] [ref=e3]
    - link "首頁" [ref=e4] [cursor=pointer]:
      - /url: index.html
  - generic [ref=e5]:
    - generic [ref=e6]: 早晨，訪客！👋
    - generic [ref=e7]: 今日梗係要做運動！
  - generic [ref=e9]:
    - generic [ref=e11]:
      - generic [ref=e12]: 用
      - generic [ref=e13]:
        - generic [ref=e14]: 用戶
        - generic [ref=e15]:
          - generic [ref=e16]: ★ 一般
          - generic [ref=e17]: 📅 — 加入
          - generic [ref=e18]: 🏋️ — 堂
      - generic [ref=e19]:
        - button "🚪" [ref=e20] [cursor=pointer]
        - button "⚙️" [ref=e21] [cursor=pointer]
    - generic [ref=e22]:
      - link "🔍 探索" [ref=e23] [cursor=pointer]:
        - /url: explore.html
        - generic [ref=e24]: 🔍
        - generic [ref=e25]: 探索
      - link "📅 簽到" [ref=e26] [cursor=pointer]:
        - /url: checkin.html
        - generic [ref=e27]: 📅
        - generic [ref=e28]: 簽到
      - link "💎 會籍" [ref=e29] [cursor=pointer]:
        - /url: membership.html
        - generic [ref=e30]: 💎
        - generic [ref=e31]: 會籍
      - link "🎯 積分" [ref=e32] [cursor=pointer]:
        - /url: points.html
        - generic [ref=e33]: 🎯
        - generic [ref=e34]: 積分
      - link "📋 預約" [ref=e35] [cursor=pointer]:
        - /url: my-bookings.html
        - generic [ref=e36]: 📋
        - generic [ref=e37]: 預約
      - link "🔔 通知" [ref=e38] [cursor=pointer]:
        - /url: notifications.html
        - generic [ref=e39]: 🔔
        - generic [ref=e40]: 通知
    - generic [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]: "0"
        - generic [ref=e44]: 總預約
      - generic [ref=e45]:
        - generic [ref=e46]: "0"
        - generic [ref=e47]: 待出席
      - generic [ref=e48]:
        - generic [ref=e49]: "0"
        - generic [ref=e50]: 已上堂
    - heading "總預約預約" [level=2] [ref=e52]
    - generic [ref=e54]:
      - generic [ref=e55]: 📅
      - text: 尚未預約課程
      - paragraph
      - paragraph [ref=e56]: 去探索睇睇有咩課程適合你
      - link "🔍 探索課程" [ref=e57] [cursor=pointer]:
        - /url: explore.html
    - heading "所有預約記錄" [level=2] [ref=e59]
    - generic [ref=e61]:
      - generic [ref=e62]: 📋
      - text: 尚未有預約記錄
      - paragraph
      - paragraph [ref=e63]: 第一次使用ZenPass？快來發現體驗吧
      - link "👀 睇睇有咩課" [ref=e64] [cursor=pointer]:
        - /url: explore.html
  - text: "\" ); }) .join(\"\"); }"
  - navigation "底部導航" [ref=e65]:
    - link "🏠 首頁" [ref=e66] [cursor=pointer]:
      - /url: index.html
      - generic [ref=e67]: 🏠
      - text: 首頁
    - link "🔍 探索" [ref=e68] [cursor=pointer]:
      - /url: explore.html
      - generic [ref=e69]: 🔍
      - text: 探索
    - link "💎 會籍" [ref=e70] [cursor=pointer]:
      - /url: membership.html
      - generic [ref=e71]: 💎
      - text: 會籍
    - link "👨‍🏫 成為教練" [ref=e72] [cursor=pointer]:
      - /url: coach-apply.html
      - generic [ref=e73]: 👨‍🏫
      - text: 成為教練
    - link "👤 我的" [ref=e74] [cursor=pointer]:
      - /url: my.html
      - generic [ref=e75]: 👤
      - text: 我的
  - contentinfo [ref=e76]:
    - generic [ref=e77]:
      - generic [ref=e78]:
        - generic [ref=e79]: 🧘 ZenPass 禪流
        - generic [ref=e80]:
          - text: 一個Pass，通行全城運動體驗。
          - text: 香港康樂及體育有限公司
      - generic [ref=e81]:
        - generic [ref=e82]: 探索
        - list [ref=e83]:
          - listitem [ref=e84]:
            - link "探索課程" [ref=e85] [cursor=pointer]:
              - /url: explore.html
          - listitem [ref=e86]:
            - link "星級教練" [ref=e87] [cursor=pointer]:
              - /url: coaches.html
          - listitem [ref=e88]:
            - link "會籍方案" [ref=e89] [cursor=pointer]:
              - /url: membership.html
          - listitem [ref=e90]:
            - link "成為教練" [ref=e91] [cursor=pointer]:
              - /url: coach-apply.html
          - listitem [ref=e92]:
            - link "場地加盟" [ref=e93] [cursor=pointer]:
              - /url: partner-apply.html
      - generic [ref=e94]:
        - generic [ref=e95]: 支援
        - list [ref=e96]:
          - listitem [ref=e97]:
            - link "常見問題" [ref=e98] [cursor=pointer]:
              - /url: faq.html
          - listitem [ref=e99]:
            - link "私隱政策" [ref=e100] [cursor=pointer]:
              - /url: privacy.html
          - listitem [ref=e101]:
            - link "服務條款" [ref=e102] [cursor=pointer]:
              - /url: terms.html
          - listitem [ref=e103]:
            - link "關於我們" [ref=e104] [cursor=pointer]:
              - /url: about.html
      - generic [ref=e105]:
        - generic [ref=e106]: 聯絡我們
        - list [ref=e107]:
          - listitem [ref=e108]: 📧 support@zenpass.hk
          - listitem [ref=e109]: 📞 2387 0724
          - listitem [ref=e110]: 📍 香港九龍觀塘
        - generic [ref=e111]:
          - link "📸" [ref=e112] [cursor=pointer]:
            - /url: https://www.instagram.com/zenpass_hk
          - link "👍" [ref=e113] [cursor=pointer]:
            - /url: https://www.facebook.com/zenpass.hk
          - link "💬" [ref=e114] [cursor=pointer]:
            - /url: https://wa.me/85290335538
          - link "🏛️" [ref=e115] [cursor=pointer]:
            - /url: https://hklfcl.com
    - generic [ref=e116]: © 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.
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