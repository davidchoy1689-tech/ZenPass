/**
 * ZenPass — 商戶加盟系統測試
 *
 * 測試：申請 → 審批 → Dashboard → 開班 → 預約 → 結算
 *
 * 運行：node backend/tests/test-partner.js
 */

const http = require("http");
const assert = require("assert");

const BASE = "http://localhost:3001";
const API = BASE + "/api";

// ===== 輔助 =====
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (token) options.headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const api = {
  get: (path, token) => request("GET", path, null, token),
  post: (path, body, token) => request("POST", path, body, token),
};

// ===== Test Data =====
const ts = Date.now();
const PARTNER_EMAIL = `partner-venue-${ts}@test.com`;
const PARTNER_NAME = `Zen Yoga Studio ${ts}`;
let adminToken = null;
let venueId = null;
let classId = null;
let scheduleId = null;
let bookingId = null;

// ===== Test Runner =====
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`   ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`   ❌ ${name}: ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log("\n🧪 ZenPass 商戶加盟系統測試");
  console.log("═══════════════════════════════════\n");

  // ====== Admin Login ======
  await test("Admin 登入", async () => {
    const res = await api.post(API + "/auth/login", {
      email: "admin@zenpass.hk",
      password: "admin123",
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token, "應該有 token");
    adminToken = res.body.token;
  });

  // ====== 1. 商戶申請 ======
  await test("POST /api/partner/apply — 提交申請", async () => {
    const res = await api.post(API + "/partner/apply", {
      name: PARTNER_NAME,
      email: PARTNER_EMAIL,
      phone: "98765432",
      contact_person: "王經理",
      category: "瑜伽",
      district: "九龍",
      address: "九龍旺角彌敦道100號",
      description: "專業瑜伽場地，設備齊全",
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.success, "申請應該成功");
    assert.ok(res.body.data.id, "應該有 venue id");
    venueId = res.body.data.id;
    console.log(`      venue_id: ${venueId}`);
  });

  // ====== 2. 重複申請 ======
  await test("POST /api/partner/apply — 重複申請應該被拒絕", async () => {
    const res = await api.post(API + "/partner/apply", {
      name: PARTNER_NAME,
      email: PARTNER_EMAIL,
      phone: "98765432",
      category: "瑜伽",
    });
    assert.strictEqual(res.status, 409);
    assert.ok(!res.body.success || res.body.error);
  });

  // ====== 3. 申請缺少必要欄位 ======
  await test("POST /api/partner/apply — 缺少必要欄位", async () => {
    const res = await api.post(API + "/partner/apply", {
      name: "No Email Studio",
    });
    assert.strictEqual(res.status, 400);
    assert.ok(!res.body.success || res.body.error);
  });

  // ====== 4. Admin 睇 pending 申請 ======
  await test("GET /api/admin/partner-applications — pending 列表", async () => {
    const res = await api.get(
      API + "/partner/admin/partner-applications",
      adminToken,
    );
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data) || Array.isArray(res.body));
    const data = Array.isArray(res.body.data) ? res.body.data : res.body;
    const found = data.find((v) => v.id === venueId);
    assert.ok(found, "應該喺 pending list 見到新申請");
    assert.strictEqual(found.status, "pending");
  });

  // ====== 5. Admin 審批通過 ======
  await test("POST /api/admin/partner-approve — 通過申請", async () => {
    const res = await api.post(
      API + "/partner/admin/partner-approve",
      {
        venue_id: venueId,
        action: "accept",
        commission_rate: 0.25,
      },
      adminToken,
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data?.status || res.body.status, "active");
  });

  // ====== 6. Admin 商戶列表 ======
  await test("GET /api/admin/partner-list — 全部商戶列表", async () => {
    const res = await api.get(API + "/partner/admin/partner-list", adminToken);
    assert.strictEqual(res.status, 200);
    const data = Array.isArray(res.body.data) ? res.body.data : res.body;
    const found = data.find((v) => v.id === venueId);
    assert.ok(found, "應該喺列表見到已通過嘅商戶");
    assert.strictEqual(found.status, "active");
    assert.strictEqual(found.commission_rate, 0.25);
  });

  // ====== 7. 未授權存取 ======
  await test("GET /api/admin/partner-applications — 未登入", async () => {
    const res = await api.get(API + "/partner/admin/partner-applications");
    assert.strictEqual(res.status, 401);
  });

  console.log(
    `\n   📊 結果: ${passed} passed / ${failed} failed / ${passed + failed} total\n`,
  );
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  failed++;
  console.log(
    `\n   📊 結果: ${passed} passed / ${failed} failed / ${passed + failed} total\n`,
  );
});
