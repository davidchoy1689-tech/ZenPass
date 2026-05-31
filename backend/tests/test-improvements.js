/**
 * ZenPass 改善任務測試
 * 測試：健康檢查、Admin payout、Waitlist、Notification
 */

const assert = require("assert");
const http = require("http");
const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== 輔助函數 =====
function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: 3001,
      path,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(opts, (res) => {
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
    req.end();
  });
}

function apiPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: "localhost",
      port: 3001,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(opts, (res) => {
      let response = "";
      res.on("data", (chunk) => (response += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(response) });
        } catch {
          resolve({ status: res.statusCode, body: response });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

let adminToken = null;

// ===== 1. Test Health Check =====
async function testHealthCheck() {
  console.log("\n🧪 Test 1: Health Check Endpoint");
  const res = await apiGet("/api/health");

  assert.strictEqual(res.status, 200, "Health check should return 200");
  const data = res.body.data || res.body;
  assert.ok(data.status, "Should have status field");
  assert.ok(data.database, "Should have database field");
  assert.ok(data.memory, "Should have memory field");
  assert.ok(data.uptime, "Should have uptime field");

  console.log("  ✅ Health check returns comprehensive status");
  console.log("     Status:", data.status);
  console.log(
    "     Database:",
    data.database.connected ? "✅ connected" : "❌ disconnected",
  );
  console.log("     Tables:", data.database.tables);
  console.log("     Memory:", data.memory.usage);
  console.log("     Uptime:", data.uptime_human);
}

// ===== 2. Test Admin Payout Process =====
async function testAdminPayout() {
  console.log("\n🧪 Test 2: Admin Payout System");

  // First, try with no auth
  const noAuth = await apiPost("/api/admin/process-payouts", {});
  assert.ok(
    noAuth.status === 401 || noAuth.status === 403,
    "Should reject unauthenticated requests (got " + noAuth.status + ")",
  );
  console.log("  ✅ Unauthenticated request correctly rejected");

  // Try with non-admin token
  if (adminToken) {
    const adminRes = await apiPost(
      "/api/admin/process-payouts",
      {},
      adminToken,
    );
    // Should work or return appropriate message
    console.log(
      "  ✅ Admin payout endpoint responds (status:",
      adminRes.status + ")",
    );
    if (adminRes.body && adminRes.body.processed !== undefined) {
      console.log("     Processed:", adminRes.body.processed + " coach(es)");
    }
  }

  // Test GET /api/admin/payouts
  if (adminToken) {
    const payoutsRes = await apiGet("/api/admin/payouts", adminToken);
    if (payoutsRes.status === 200) {
      assert.ok(
        payoutsRes.body.payouts !== undefined,
        "Should have payouts array",
      );
      console.log("  ✅ Admin payouts list works");
      console.log("     Total payouts:", payoutsRes.body.total);
    }
  }
}

// ===== 3. Test Waitlist =====
async function testWaitlist() {
  console.log("\n🧪 Test 3: Waitlist System");

  // Test waitlist status endpoint without auth
  const noAuth = await apiGet("/api/waitlist/status?schedule_id=test");
  assert.ok(
    noAuth.status === 401 || noAuth.status === 403,
    "Should reject unauthenticated waitlist requests",
  );
  console.log("  ✅ Waitlist status correctly requires auth");

  // Test notify-next without auth
  const noAuth2 = await apiPost("/api/waitlist/notify-next", {
    schedule_id: "test",
  });
  assert.ok(
    noAuth2.status === 401 || noAuth2.status === 403,
    "Should reject unauthenticated notify-next",
  );
  console.log("  ✅ Waitlist notify-next correctly requires auth");
}

// ===== 4. Test Notification System =====
async function testNotifications() {
  console.log("\n🧪 Test 4: Notification System");

  // Test notification config endpoint
  const configRes = await apiGet("/api/notifications/config");
  if (configRes.status === 200) {
    assert.ok(configRes.body.config, "Should have config object");
    assert.ok(
      configRes.body.config.db === true,
      "DB notifications should be enabled",
    );
    console.log("  ✅ Notification config endpoint works");
    console.log("     DB enabled:", configRes.body.config.db);
    console.log(
      "     Telegram:",
      configRes.body.config.telegram.enabled ? "✅" : "⚙️ not configured",
    );
  } else {
    console.log("  ⚠️ Config endpoint requires auth, testing fallback");
  }

  // Test sendNotification can be called (via console.log)
  const {
    sendNotification,
    dbNotification,
  } = require("../src/services/notification");

  // DB notification with valid user_id (if available in test DB)
  const {
    sendNotification: sendNotif,
  } = require("../src/services/notification");
  console.log("  ✅ sendNotification module loads correctly");

  // Verify email notification falls back to console.log when SMTP not configured
  const { emailNotification } = require("../src/services/notification");
  const emailResult = await emailNotification(
    "test@example.com",
    "Test Subject",
    "<p>Test body</p>",
  );
  assert.strictEqual(
    emailResult,
    true,
    "Email notification should return true in dev mode (console fallback)",
  );
  console.log("  ✅ Email notification falls back to console.log in dev mode");

  const result = await sendNotification("booking.confirmed", {
    recipient: "test-id",
    data: {
      class_title: "測試課程",
      date: "2026-05-16",
      time: "10:00",
      venue: "測試場地",
      coach_name: "測試教練",
    },
  });
  assert.ok(
    result.db !== undefined,
    "Send notification should return results for each channel",
  );
  console.log("  ✅ sendNotification unified API works");
}

// ===== 5. Test Coach Payout API =====
async function testCoachPayout() {
  console.log("\n🧪 Test 5: Coach Payout API");

  // Test the earnings/calculate endpoint
  const calcRes = await apiPost("/api/coach/earnings/calculate", {});
  console.log(
    "  ✅ Earnings calculate endpoint responds (status:",
    calcRes.status + ")",
  );

  // Test settings endpoint
  const settingsRes = await apiGet("/api/coach/settings");
  if (settingsRes.status === 200) {
    assert.ok(settingsRes.body.settings, "Should return settings array");
    console.log("  ✅ Coach settings endpoint works");
    console.log("     Settings count:", settingsRes.body.settings.length);
  }

  // Test effective rate
  const rateRes = await apiGet("/api/coach/settings/effective-rate");
  if (rateRes.status === 200) {
    assert.ok(rateRes.body.coach_rate !== undefined, "Should have coach_rate");
    console.log(
      "  ✅ Effective rate endpoint works (coach:",
      rateRes.body.coach_rate + ")",
    );
  }
}

// ===== Main =====
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  ZenPass 改善任務測試");
  console.log("═══════════════════════════════════════");

  // Try to get admin token
  try {
    const loginRes = await apiPost("/api/auth/login", {
      email: "david@zenpass.hk",
      password: "admin123",
    });
    if (loginRes.status === 200 && loginRes.body.token) {
      adminToken = loginRes.body.token;
      console.log("🔑 Admin token obtained");
    }
  } catch (e) {
    console.log("⚠️  Could not get admin token (some tests will be limited)");
  }

  await testHealthCheck();
  await testWaitlist();
  await testNotifications();
  await testCoachPayout();
  await testAdminPayout();

  console.log("\n═══════════════════════════════════════");
  console.log("  ✅ All tests completed!");
  console.log("═══════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
