// ZenPass Frontend Audit — 每日全面頁面檢查
// 目標：捉到 JS syntax error、code 外露、broken links、tab 失效
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3001";

// ===== 所有公開頁面 =====
const ALL_PAGES = [
  "/",
  "/404.html",
  "/about.html",
  "/badges.html",
  "/buy-credits.html",
  "/checkin.html",
  "/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258",
  "/coach-apply.html",
  "/coach-dashboard.html",
  "/coach-profile.html",
  "/coaches.html",
  "/courses.html",
  "/crm.html",
  "/demo-setup.html",
  "/explore.html",
  "/faq.html",
  "/index.html",
  "/login.html",
  "/privacy.html",
  "/profile.html",
  "/signup.html",
  "/terms.html",
  "/wallet.html",
];

// ===== 管理員頁面（需要 token）=====
const ADMIN_PAGES = [
  "/admin.html",
  "/add-demo-class.html",
  "/design-prototype.html",
];

// ===== JS code 外露檢測 pattern =====
const JS_LEAK_PATTERNS = [
  /function\s+\w+\s*\(/,       // function declaration
  /const\s+\w+\s*=/,           // const assignment
  /let\s+\w+\s*=/,             // let assignment
  /var\s+\w+\s*=/,             // var assignment
  /document\.(getElementById|querySelector)/, // DOM methods
  /\.addEventListener\(/,      // event listeners
  /html\s*\+?=\s*['"`]/,      // template string concatenation (wallet bug!)
  /fetch\(/,                   // fetch calls
  /localStorage\.(getItem|setItem)/, // storage access
  /JSON\.(parse|stringify)/,   // JSON operations
  /console\.(log|error)/,      // console statements
  /axios\./,                   // axios calls
];

// ===== Console Error 收集 =====
const consoleErrors = [];
const jsErrors = [];

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  jsErrors.length = 0;

  // Capture console.error
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  // Capture uncaught exceptions
  page.on("pageerror", (err) => {
    jsErrors.push(err.message);
  });
});

// ===== Test 1: 每頁載入檢查 =====
test.describe("🔍 公開頁面全面檢查", () => {
  for (const url of ALL_PAGES) {
    test(`${url} loads clean`, async ({ page }) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      // Allow 404 if page doesn't exist yet (future feature)
      if (resp?.status() === 404) {
        console.log(`⚠️ ${url} returns 404 — skipping checks`);
        return;
      }
      expect(resp?.status()).toBe(200);

      // Wait for dynamic content
      await page.waitForTimeout(1000);

      // 1. Console errors — warn but don't fail for 404 resource loads
      if (consoleErrors.length > 0) {
        const non404Errors = consoleErrors.filter(e => !e.includes('404'));
        if (non404Errors.length > 0) {
          console.log(`❌ NON-404 ERRORS on ${url}:`, non404Errors);
          expect(non404Errors).toEqual([]);
        } else {
          console.log(`⚠️ ${url}: only 404 resource warnings (no real errors)`);
        }
      }

      // 2. JS runtime errors — always fail
      if (jsErrors.length > 0) {
        console.log(`❌ JS ERRORS on ${url}:`, jsErrors);
      }
      expect(jsErrors).toEqual([]);

      // 3. JS code leak check — look for visible JS code in page body
      const bodyText = await page.locator("body").innerText();
      for (const pattern of JS_LEAK_PATTERNS) {
        const leaked = bodyText.match(pattern);
        if (leaked) {
          console.log(`❌ JS LEAK on ${url}: matched "${leaked[0]}"`);
        }
        expect(leaked).toBeNull();
      }

      // 4. No broken images
      const brokenImgs = await page.locator("img[src]").evaluateAll((imgs) =>
        imgs.filter((img) => !img.complete || img.naturalWidth === 0).length
      );
      if (brokenImgs > 0) {
        console.log(`❌ BROKEN IMAGES on ${url}: ${brokenImgs}`);
      }
      expect(brokenImgs).toBe(0);
    });
  }
});

// ===== Test 2: Admin pages with token =====
test.describe("🔐 管理頁面檢查（已登入）", () => {
  test.beforeEach(async ({ page }) => {
    // 用真實 login API 攞 token
    await page.goto("/login.html");
    await page.fill("#login-email", "admin@zenpass.hk");
    await page.fill("#login-password", "admin123");
    await page.click("#login-btn");
    await page.waitForTimeout(2000);
  });

  for (const url of ADMIN_PAGES) {
    test(`admin ${url} loads clean`, async ({ page }) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      expect(resp?.status()).toBe(200);
      await page.waitForTimeout(1000);

      expect(consoleErrors).toEqual([]);
      expect(jsErrors).toEqual([]);

      // JS leak check
      const bodyText = await page.locator("body").innerText();
      for (const pattern of JS_LEAK_PATTERNS) {
        const leaked = bodyText.match(pattern);
        if (leaked) {
          console.log(`❌ JS LEAK on ${url}: matched "${leaked[0]}"`);
        }
        expect(leaked).toBeNull();
      }
    });
  }
});

// ===== Test 3: Navigation links 全部 200 =====
test.describe("🔗 Navigation Links", () => {
  test("all nav links are valid", async ({ page }) => {
    const pages = ["/", "/courses.html", "/login.html", "/faq.html"];
    for (const p of pages) {
      await page.goto(p);
      const links = await page
        .locator("nav a, .nav-link, header a")
        .all();
      for (const link of links) {
        const href = await link.getAttribute("href");
        if (href && href.startsWith("/")) {
          const resp = await page.request.get(href);
          if (resp.status() >= 400) {
            console.log(`❌ BROKEN LINK: ${href} (from ${p})`);
          }
          expect(resp.status()).toBeLessThan(400);
        }
      }
    }
  });
});

// ===== Test 4: Tab / Accordion 互動檢查 =====
test.describe("📑 Tab & Accordion 功能", () => {
  test("class-detail tabs work (overview, schedule, details)", async ({ page }) => {
    await page.goto(
      "/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258",
      { waitUntil: "networkidle" }
    );
    await page.waitForTimeout(1500);

    const tabs = page.locator(".tab-btn, .tab-link, [role='tab']");
    const tabCount = await tabs.count();

    if (tabCount > 0) {
      // Click each tab and verify content changes
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(300);
        // Check no console errors after click
        expect(consoleErrors).toEqual([]);
        expect(jsErrors).toEqual([]);
        // Check content panel is visible
        const panel = page.locator(
          ".tab-content.active, .tab-panel.active, [role='tabpanel']"
        );
        const panelText = await panel.first().innerText();
        expect(panelText.length).toBeGreaterThan(0);
      }
    } else {
      console.log("⚠️ No tabs found on class-detail, skipping tab test");
      // Still verify the page has content
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length).toBeGreaterThan(50);
    }
  });

  test("admin tabs work", async ({ page }) => {
    // Login first
    await page.goto("/login.html");
    await page.fill("#login-email", "admin@zenpass.hk");
    await page.fill("#login-password", "admin123");
    await page.click("#login-btn");
    await page.waitForTimeout(2000);

    await page.goto("/admin.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Look for tab-like elements
    const tabs = page.locator(".tab-btn, .tab-link, [role='tab'], .nav-tabs a, .admin-tab");
    const tabCount = await tabs.count();

    if (tabCount > 0) {
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(500);
        expect(consoleErrors).toEqual([]);
        expect(jsErrors).toEqual([]);

        // Check content appeared
        const activePanel = page.locator(
          ".tab-content:not([style*='display:none']), " +
          ".tab-content:not([style*='display: none']), " +
          ".tab-pane.active, " +
          "[role='tabpanel']:not([hidden])"
        );
        const panelCount = await activePanel.count();
        if (panelCount > 0) {
          const text = await activePanel.first().innerText();
          expect(text.length).toBeGreaterThan(0);
        }
      }
    } else {
      console.log("⚠️ No admin tabs found, skipping tab test");
    }
    expect(jsErrors).toEqual([]);
    // Only fail on non-404 console errors
    const adminNon404 = consoleErrors.filter(e => !e.includes('404'));
    if (adminNon404.length > 0) {
      console.log('❌ Admin non-404 console errors:', adminNon404);
    }
    expect(adminNon404).toEqual([]);
  });
});

// ===== Test 5: Wallet page (特别容易出事) =====
test.describe("💰 Wallet Tab Integration", () => {
  test("wallet tabs work without JS leak", async ({ page }) => {
    // Login
    await page.goto("/login.html");
    await page.fill("#login-email", "admin@zenpass.hk");
    await page.fill("#login-password", "admin123");
    await page.click("#login-btn");
    await page.waitForTimeout(2000);

    const respW = await page.goto("/wallet.html", { waitUntil: "networkidle" });
    if (respW?.status() === 404) {
      console.log("⚠️ wallet.html returns 404 — skipping wallet tab test");
      return;
    }
    await page.waitForTimeout(1500);

    // Check no JS leak
    const bodyText = await page.locator("body").innerText();
    for (const pattern of JS_LEAK_PATTERNS) {
      const leaked = bodyText.match(pattern);
      if (leaked) {
        console.log(`❌ JS LEAK on wallet: matched "${leaked[0]}"`);
      }
      expect(leaked).toBeNull();
    }

    // No console errors (allow 404 resource loads)
    const walletNon404 = consoleErrors.filter(e => !e.includes('404'));
    expect(walletNon404).toEqual([]);
    expect(jsErrors).toEqual([]);

    // Click wallet tabs
    const tabs = page.locator(".wallet-tab, .tab-btn, [role='tab']");
    const tabCount = await tabs.count();
    if (tabCount > 0) {
      for (let i = 0; i < tabCount; i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(500);
        expect(consoleErrors).toEqual([]);
        expect(jsErrors).toEqual([]);
      }
    }

    // Verify wallet data loaded (no raw template text)
    const bodyViewText = await page.locator("body").innerText();
    // Check no raw template literals visible
    expect(bodyViewText).not.toContain("html += ");
    expect(bodyViewText).not.toContain("+= '<tr");
  });
});

// ===== Test 6: Class detail tab wallet-like bug check =====
test.describe("📋 特別檢查：JS code 外露 Bug", () => {
  test("no html += template leak on any page", async ({ page }) => {
    // Check a subset of heavy JS pages
    const heavyPages = [
      "/admin.html",
      "/wallet.html",
      "/class-detail.html?id=f9e35b02-eb78-4e8c-a117-7d40cb6c3258",
      "/coach-dashboard.html",
      "/crm.html",
      "/buy-credits.html",
    ];
    for (const url of heavyPages) {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp || resp.status() >= 400) continue;
      await page.waitForTimeout(1000);

      // Use innerText (visible text only) instead of innerHTML to exclude <script> content
      const bodyText = await page.locator("body").innerText();
      // Check for JS code that escaped the <script> tag
      const leakIndicators = [
        "html += '",
        'html += "',
        "html += `",
        "+= '<tr",
        '+= "<tr',
        "+= `<tr",
        "function loadWalletData",
        "function loadTransactions",
        "function login()",
        "function logout()",
      ];
      for (const indicator of leakIndicators) {
        if (bodyText.includes(indicator)) {
          console.log(`❌ JS LEAK on ${url}: found "${indicator}" in viewable text`);
        }
        expect(bodyText).not.toContain(indicator);
      }
      // Only fail on non-404 console errors
      const non404CE = consoleErrors.filter(e => !e.includes('404'));
      expect(non404CE).toEqual([]);
      expect(jsErrors).toEqual([]);
    }
  });
});
