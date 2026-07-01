/**
 * ZenPass 禪流 — 新功能測試入口
 *
 * 這是新功能測試的統一入口點。
 * 每次添加新功能時請在此檔案或 tests/new/ 下新增測試用例。
 *
 * Usage: node tests/test-new-features.js
 *        npm run test:new
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const TIMEOUT_MS = 5000;

let passed = 0;
let failed = 0;

async function check(description, fn) {
  try {
    const result = await fn();
    if (result === true || result === undefined) {
      console.log(`  ✅ ${description}`);
      passed++;
    } else {
      console.log(`  ❌ ${description} — expected truthy, got:`, result);
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ ${description} — ${err.message}`);
    failed++;
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function runAll() {
  console.log("\n🧪 ZenPass 新功能測試");
  console.log("======================");
  console.log(`Target: ${BASE_URL}\n`);

  // —— Health check ——
  console.log("── API Health ──");
  await check("GET /api/health returns 200", async () => {
    const { status, body } = await fetchJson(`${BASE_URL}/api/health`);
    return status === 200 && body.status === "ok";
  });

  // —— CSRF ——
  console.log("\n── CSRF ──");
  await check("GET /api/csrf-token returns 200", async () => {
    const { status } = await fetchJson(`${BASE_URL}/api/csrf-token`);
    return status === 200;
  });

  // Placeholder for further new-feature tests
  console.log("\n  更多測試可以添加到此檔案");

  // —— Summary ——
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
