const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

  const url = "http://localhost:3998/booking.html?id=0028eeb3-9926-4fa8-ad67-2fafd3eb7c52";
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // step1
  const groups = await page.textContent("#groups");
  console.log("STEP1 has sessions:", /剩/.test(groups));
  console.log("selected count:", await page.textContent("#barCount"));
  await page.click("#barNext");
  await page.waitForTimeout(300);

  console.log("guestBox visible:", await page.isVisible("#guestBox"));
  console.log("credits card hidden:", !(await page.isVisible('[data-pm-card="credits"]')));
  console.log("single checked:", await page.isChecked('input[name=pm][value="single"]'));

  await page.fill("#gName", "陳大文");
  const phone = "9" + String(Date.now()).slice(-7);
  await page.fill("#gPhone", phone);
  await page.check("#consent");
  await page.click("#toStep3");
  await page.waitForTimeout(300);
  console.log("step3 visible:", await page.isVisible("#step3"));
  console.log("countdown:", await page.textContent("#countdown"));
  console.log("guarantee visible:", await page.isVisible("#guarantee1"));

  await page.click("#payNow");
  await page.waitForTimeout(2500);
  console.log("pay step visible:", await page.isVisible("#pay"));
  console.log("fps panel:", (await page.textContent("#payPanels")).replace(/\s+/g, " ").slice(0, 120));
  console.log("pay tabs:", (await page.textContent("#payTabs")).replace(/\s+/g, " "));
  console.log("countdown2:", await page.textContent("#payCountdown"));

  // copy button
  await page.click('[data-copy="741293856838"]');
  await page.waitForTimeout(300);
  console.log("copy btn after click:", (await page.textContent('[data-copy="741293856838"]')).trim());

  await page.screenshot({ path: "/tmp/guest-pay.png", fullPage: true });

  // PayMe tab
  await page.click('#payTabs .chip[data-pm="payme"]');
  await page.waitForTimeout(300);
  console.log("payme panel:", (await page.textContent("#payPanels")).replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: "/tmp/guest-payme.png", fullPage: true });

  // submit payment
  await page.fill("#payRef", "TEST-REF-999");
  await page.click("#paySubmit");
  await page.waitForTimeout(2500);
  console.log("done visible:", await page.isVisible("#done"));
  console.log("done title:", await page.textContent("#doneTitle"));
  console.log("done summary:", (await page.textContent("#doneSummary")).replace(/\s+/g, " "));
  console.log("guest note visible:", await page.isVisible("#guestDoneNote"));
  await page.screenshot({ path: "/tmp/guest-done.png", fullPage: true });

  console.log("ERRORS:", errs.length ? errs.slice(0, 8) : "none");
  await browser.close();
})();
