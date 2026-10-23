const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  // login via API
  const resp = await page.request.post("http://localhost:3998/api/auth/login", {
    data: { email: "student@zenpass.hk", password: "Test1234!" },
  });
  const j = await resp.json();
  console.log("login:", j.success, !!j.token);

  await page.goto("http://localhost:3998/index.html");
  await page.evaluate((d) => {
    localStorage.setItem("zenpass_token", d.token);
    localStorage.setItem("zenpass_user", JSON.stringify(d.user));
  }, j);

  await page.goto("http://localhost:3998/booking.html?id=0028eeb3-9926-4fa8-ad67-2fafd3eb7c52", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.click("#barNext");
  await page.waitForTimeout(300);
  console.log("guestBox hidden for logged-in:", !(await page.isVisible("#guestBox")));
  console.log("credits visible:", await page.isVisible('[data-pm-card="credits"]'));
  page.on("dialog", async d => { console.log("DIALOG:", d.message().slice(0,160)); await d.accept(); });
  await page.check("#consent");
  await page.click("#toStep3");
  await page.waitForTimeout(200);
  console.log("step3 visible:", await page.isVisible("#step3"));
  console.log("guarantee:", await page.isVisible("#guarantee1"));
  await page.screenshot({ path: "/tmp/member-step3.png", fullPage: true });

  // credits path
  await page.click("#payNow");
  await page.waitForTimeout(2500);
  const done = await page.isVisible("#done");
  console.log("credits booking done:", done);
  if (done) console.log("title:", await page.textContent("#doneTitle"));
  else console.log("alert/err:", (await page.textContent("body")).slice(0, 200));
  await page.screenshot({ path: "/tmp/member-done.png", fullPage: true });
  console.log("ERRORS:", errs.length ? errs.slice(0, 5) : "none");
  await browser.close();
})();
