const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  await page.goto("http://localhost:3998/booking.html?id=0028eeb3-9926-4fa8-ad67-2fafd3eb7c52", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.click("#barNext");
  await page.waitForTimeout(200);
  const phone = "9" + String(Date.now()).slice(-7);
  await page.fill("#gName", "逾時測試");
  await page.fill("#gPhone", phone);
  await page.check("#consent");
  await page.click("#toStep3");
  await page.waitForTimeout(200);
  await page.click("#payNow");
  await page.waitForTimeout(2000);
  console.log("pay visible:", await page.isVisible("#pay"));

  // trigger timeout
  await page.evaluate(() => showTimeoutModal());
  await page.waitForTimeout(300);
  console.log("modal visible:", await page.isVisible("#timeoutModal"));
  await page.screenshot({ path: "/tmp/timeout-modal.png" });

  page.once("dialog", async (d) => { console.log("dialog:", d.message()); await d.accept(); });
  await page.click("#relockBtn");
  await page.waitForTimeout(1500);
  console.log("modal hidden after relock:", !(await page.isVisible("#timeoutModal")));
  console.log("countdown reset:", await page.textContent("#payCountdown"));

  // step3 (pre-booking) relock path: go back, clear payIds is not possible; skip

  console.log("ERRORS:", errs.length ? errs : "none");
  await browser.close();
})();
