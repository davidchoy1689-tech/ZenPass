const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  const resp = await page.request.post("http://localhost:3998/api/auth/login", { data: { email: "student@zenpass.hk", password: "Test1234!" } });
  const j = await resp.json();
  await page.goto("http://localhost:3998/index.html");
  await page.evaluate((d) => { localStorage.setItem("zenpass_token", d.token); localStorage.setItem("zenpass_user", JSON.stringify(d.user)); }, j);

  await page.goto("http://localhost:3998/booking.html?id=0028eeb3-9926-4fa8-ad67-2fafd3eb7c52", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // select a second/last session only (avoid dup with credits booking)
  const boxes = await page.$$("input[data-sid]");
  console.log("sessions shown:", boxes.length);
  await page.evaluate(() => { document.querySelectorAll("input[data-sid]").forEach((c, i) => { if (c.checked) c.click(); }); });
  await page.waitForTimeout(200);
  // pick last checkbox
  await page.evaluate(() => { const a = document.querySelectorAll("input[data-sid]"); a[a.length - 1].click(); });
  await page.waitForTimeout(200);
  await page.click("#barNext");
  await page.waitForTimeout(300);
  await page.click('[data-pm-card="single"]');
  await page.waitForTimeout(150);
  console.log("single checked:", await page.isChecked('input[name=pm][value="single"]'));
  await page.check("#consent");
  await page.click("#toStep3");
  await page.waitForTimeout(300);
  console.log("hold banner:", (await page.textContent("#holdBanner")).replace(/\s+/g, " "));
  await page.click("#payNow");
  await page.waitForTimeout(2500);
  console.log("pay visible:", await page.isVisible("#pay"));
  console.log("tabs:", (await page.textContent("#payTabs")).replace(/\s+/g, "|"));
  await page.screenshot({ path: "/tmp/member-pay-fps.png", fullPage: true });

  // timeout relock (user path)
  await page.evaluate(() => showTimeoutModal());
  await page.waitForTimeout(300);
  page.once("dialog", async d => { console.log("RELOCK DIALOG:", d.message().slice(0, 120)); await d.accept(); });
  await page.click("#relockBtn");
  await page.waitForTimeout(2000);
  console.log("modal hidden:", !(await page.isVisible("#timeoutModal")));
  console.log("countdown:", await page.textContent("#payCountdown"));

  await page.fill("#payRef", "USER-FPS-001");
  page.once("dialog", async d => { console.log("PAY DIALOG:", d.message().slice(0,120)); await d.accept(); });
  await page.click("#paySubmit");
  await page.waitForTimeout(2500);
  console.log("done:", await page.isVisible("#done"), await page.textContent("#doneTitle"));
  await page.screenshot({ path: "/tmp/member-pay-done.png", fullPage: true });
  console.log("ERRORS:", errs.length ? errs.slice(0,5) : "none");
  await browser.close();
})();
