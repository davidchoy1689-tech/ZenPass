// Debug: check what homepage loads
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();

// Listen for console messages
page.on("console", (msg) => console.log("BROWSER:", msg.type(), msg.text()));

// Listen for failed requests
page.on("requestfailed", (req) =>
  console.log("FAIL:", req.url(), req.failure()?.errorText),
);

await page.goto("http://localhost:3001/");
await page.waitForTimeout(5000);

const html = await page.content();
console.log("=== HTML SNIPPET (categories section) ===");
const idx = html.indexOf("運動分類");
if (idx >= 0) {
  console.log(html.substring(Math.max(0, idx - 200), idx + 500));
} else {
  console.log('"運動分類" not found in page');
}

const chipCount = await page.locator(".category-chip").count();
console.log("Category chips:", chipCount);

await browser.close();
