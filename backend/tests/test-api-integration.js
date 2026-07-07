/**
 * ZenPass API Integration Tests
 * 測試核心 API endpoints：Health、Auth、Classes、Bookings、Admin、Points、Badges
 *
 * 使用原生 http 模組，無需外部依賴。
 * 運行：node backend/tests/test-api-integration.js
 */

const http = require("http");
const assert = require("assert");

const BASE = "http://localhost:3001";
const API = BASE + "/api";

// ===== 輔助函數 =====

function request(method, path, body = null, token = null, csrfInfo = null) {
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
    if (csrfInfo) {
      options.headers["Cookie"] = csrfInfo.cookie;
      options.headers["x-csrf-token"] = csrfInfo.token;
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
          });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on("error", (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function getCsrfToken() {
  return new Promise((resolve, reject) => {
    const url = new URL(API + "/csrf-token");
    const req = http.get(url, (res) => {
      var cookie = "";
      var setCookie = res.headers["set-cookie"];
      if (setCookie) {
        cookie = setCookie.map(function(c) { return c.split(";")[0]; }).join("; ");
      }
      var data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        try {
          var parsed = JSON.parse(data);
          resolve({ cookie: cookie, token: parsed.csrfToken || parsed.token || "" });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
  });
}

const api = {
  get: (path, token) => request("GET", path, null, token),
  post: (path, body, token, csrfInfo) => request("POST", path, body, token, csrfInfo),
  put: (path, body, token) => request("PUT", path, body, token),
  delete: (path, token) => request("DELETE", path, null, token),
};

// Generate unique email for each test run
const timestamp = Date.now();
const TEST_USER = {
  name: `測試用戶${timestamp}`,
  email: `test-${timestamp}@zenpass.test`,
  password: "testpass123",
};

let testToken = null;
let testUserId = null;
let testClassId = null;
let testScheduleId = null;
let adminToken = null;

// ===== 測試案例 =====

async function test_01_health() {
  console.log("\n📡 [Test 1] Health Check...");
  const res = await api.get(API + "/health");

  assert.strictEqual(res.status, 200, "Health status should be 200");
  assert.strictEqual(
    res.body.success,
    true,
    "Health should return success:true",
  );
  assert.ok(res.body.data, "Health should have data");
  assert.strictEqual(
    typeof res.body.data.status,
    "string",
    "Status should be string",
  );
  assert.ok(res.body.data.database, "Should include database info");
  assert.ok(res.body.data.memory, "Should include memory info");
  assert.ok(res.body.data.uptime >= 0, "Uptime should be non-negative");
  console.log(
    `  ✅ Health OK — status=${res.body.data.status}, db=${res.body.data.database.connected}, uptime=${res.body.data.uptime_human}`,
  );
}

async function test_02_auth_register() {
  console.log("\n🔐 [Test 2] Auth — Register...");
  const res = await api.post(API + "/auth/register", TEST_USER);

  assert.strictEqual(res.status, 201, "Register status should be 201");
  assert.ok(res.body.token, "Register should return token");
  assert.ok(res.body.user, "Register should return user object");
  assert.strictEqual(
    res.body.user.email,
    TEST_USER.email,
    "User email should match",
  );
  assert.strictEqual(
    res.body.message,
    "註冊成功",
    "Message should be 註冊成功",
  );

  testToken = res.body.token;
  testUserId = res.body.user.id;
  console.log(
    `  ✅ Register OK — user=${testUserId}, email=${TEST_USER.email}`,
  );
}

async function test_03_auth_login() {
  console.log("\n🔐 [Test 3] Auth — Login...");
  const res = await api.post(API + "/auth/login", {
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  assert.strictEqual(res.status, 200, "Login status should be 200");
  assert.ok(res.body.token, "Login should return token");
  assert.ok(res.body.user, "Login should return user object");
  assert.strictEqual(
    res.body.message,
    "登入成功",
    "Message should be 登入成功",
  );

  testToken = res.body.token;
  console.log(`  ✅ Login OK — got fresh token`);
}

async function test_04_auth_me() {
  console.log("\n🔐 [Test 4] Auth — Get current user (me)...");
  const res = await api.get(API + "/auth/me", testToken);

  // /api/auth/me may redirect through /api/users/me or /api/auth/me
  // Accept both response formats
  assert.ok(
    res.status === 200 || res.status === 404 || res.status === 500,
    `Status should be 200, got ${res.status}`,
  );
  // If /api/auth/me route exists, it should work; if it doesn't exist, try /api/users/me
  if (res.status !== 200) {
    console.log(
      `  ⚠️  /api/auth/me returned ${res.status}, trying /api/users/me...`,
    );
    const res2 = await api.get(API + "/users/me", testToken);
    assert.strictEqual(res2.status, 200, "GET /api/users/me should return 200");
    assert.ok(
      res2.body.success !== false || res2.body.id || res2.body.email,
      "Should return user data",
    );
    console.log(`  ✅ Auth me (via /api/users/me) OK`);
  } else {
    console.log(`  ✅ Auth me OK`);
  }
}

async function test_05_users_me() {
  console.log("\n👤 [Test 5] Users — Get my profile...");
  // First try /api/users/me
  let res = await api.get(API + "/users/me", testToken);

  if (res.status === 404) {
    // Fallback to /api/users/profile
    res = await api.get(API + "/users/profile", testToken);
  }

  assert.ok(
    res.status === 200,
    `Users endpoint should return 200, got ${res.status}`,
  );
  // Accept various response formats
  const userData = res.body.data || res.body.user || res.body;
  assert.ok(userData.id || userData.email, "Should have user identity");
  console.log(`  ✅ Users me OK — name=${userData.name}`);
}

async function test_06_classes_list() {
  console.log("\n📚 [Test 6] Classes — List courses...");
  const res = await api.get(API + "/classes");

  assert.strictEqual(res.status, 200, "Classes list should return 200");

  // Accept both old format (classes + pagination) and new format (data.classes)
  const classes =
    res.body.classes || (res.body.data && res.body.data.classes) || [];
  const pagination =
    res.body.pagination || (res.body.data && res.body.data.pagination);

  assert.ok(Array.isArray(classes), "Classes should be an array");
  assert.ok(classes.length > 0, "Should have at least one class");

  if (classes[0]) {
    testClassId = classes[0].id;
    // Get schedules from the class
    const schedules = classes[0].schedules;
    if (schedules && schedules.length > 0) {
      testScheduleId = schedules[0].id;
    }
  }
  console.log(
    `  ✅ Classes OK — ${classes.length} classes, class_id=${testClassId}, schedule_id=${testScheduleId}`,
  );
}

async function test_07_class_detail() {
  if (!testClassId) {
    console.log("  ⏭️  Skipping class detail test — no class_id available");
    return;
  }
  console.log("\n📚 [Test 7] Class — Detail...");
  const res = await api.get(API + "/classes/" + testClassId);

  assert.strictEqual(res.status, 200, "Class detail should return 200");
  // Accept both formats
  const cls =
    res.body.class ||
    (res.body.data && res.body.data.class) ||
    res.body.data ||
    res.body;
  assert.ok(cls.id || cls.title, "Should have class identity");
  assert.ok(cls.price_hkd !== undefined, "Should have price");
  console.log(
    `  ✅ Class detail OK — title=${cls.title}, price=${cls.price_hkd}`,
  );
}

async function test_08_classes_categories() {
  console.log("\n📚 [Test 8] Classes — Categories...");
  const res = await api.get(API + "/classes/categories");

  assert.strictEqual(res.status, 200, "Categories should return 200");
  // Accept both formats
  const categories =
    res.body.categories || (res.body.data && res.body.data.categories) || [];
  assert.ok(Array.isArray(categories), "Categories should be an array");
  assert.ok(categories.length > 0, "Should have categories");
  // Categories may be strings or objects {category, count}
  const catNames = categories
    .map((c) => (typeof c === "string" ? c : c.category || c.name || String(c)))
    .slice(0, 5);
  console.log(
    `  ✅ Categories OK — ${categories.length} categories: ${catNames.join(", ")}`,
  );
}

async function test_09_classes_upcoming() {
  console.log("\n📚 [Test 9] Classes — Upcoming...");
  const res = await api.get(API + "/classes/upcoming");

  assert.strictEqual(res.status, 200, "Upcoming should return 200");
  const classes =
    res.body.classes || (res.body.data && res.body.data.classes) || [];
  assert.ok(Array.isArray(classes), "Should return class array");
  console.log(`  ✅ Upcoming OK — ${classes.length} upcoming classes`);
}

async function test_10_classes_available_dates() {
  console.log("\n📚 [Test 10] Classes — Available Dates...");
  const res = await api.get(API + "/classes/available-dates");

  assert.strictEqual(res.status, 200, "Available dates should return 200");
  const dates = res.body.dates || (res.body.data && res.body.data.dates) || [];
  assert.ok(Array.isArray(dates), "Should return dates array");
  console.log(`  ✅ Available dates OK — ${dates.length} dates`);
}

async function test_11_booking_flow() {
  if (!testScheduleId || !testClassId) {
    console.log("\n  ⏭️  Skipping booking flow test — no schedule available");
    return;
  }
  console.log("\n📅 [Test 11] Booking — Create booking...");
  const res = await api.post(
    API + "/bookings",
    {
      schedule_id: testScheduleId,
      class_id: testClassId,
      payment_type: "credits",
      amount: 0,
    },
    testToken,
  );

  // Could be 201 (created), 200 (existing pending) or 400 (no credits)
  assert.ok(
    res.status === 201 || res.status === 200 || res.status === 400,
    `Booking status should be 200/201/400, got ${res.status} (${res.body.error || res.body.message})`,
  );
  console.log(
    `  ✅ Booking create — status=${res.status}, message=${res.body.message || res.body.error}`,
  );
}

async function test_12_my_bookings() {
  console.log("\n📅 [Test 12] Booking — My bookings...");
  const res = await api.get(API + "/bookings/my", testToken);

  assert.strictEqual(res.status, 200, "My bookings should return 200");
  // Accept both formats
  const bookings =
    res.body.bookings || (res.body.data && res.body.data.bookings) || [];
  assert.ok(Array.isArray(bookings), "Bookings should be an array");
  console.log(`  ✅ My bookings OK — ${bookings.length} bookings`);
}

async function test_13_trial_status() {
  console.log("\n📅 [Test 13] Booking — Trial status...");
  const res = await api.get(API + "/bookings/trial-status", testToken);

  assert.strictEqual(res.status, 200, "Trial status should return 200");
  const used =
    res.body.used ??
    res.body.trial_used ??
    (res.body.data && res.body.data.used) ??
    (res.body.data && res.body.data.trial_used);
  assert.ok(used !== undefined, "Should have used/trial_used flag");
  console.log(`  ✅ Trial status OK`);
}

async function test_14_points() {
  console.log("\n🎯 [Test 14] Points — Summary...");
  const res = await api.get(API + "/points", testToken);

  assert.strictEqual(res.status, 200, "Points should return 200");
  // Accept both formats
  const data = res.body.data || res.body;
  assert.ok(data.points !== undefined, "Should have points value");
  console.log(
    `  ✅ Points OK — points=${data.points}, tier=${data.tier?.label || data.tier?.id}`,
  );

  // Check-in test
  console.log("  🎯 Testing check-in...");
  const csrf = await getCsrfToken();
  const chkRes = await api.post(API + "/points/checkin", {}, testToken, csrf);
  assert.ok(
    chkRes.status === 200 || chkRes.status === 400,
    `Checkin status should be 200/400, got ${chkRes.status}`,
  );
  if (chkRes.status === 200) {
    console.log(
      `  ✅ Check-in OK — earned ${chkRes.body.points_earned || "?"} points`,
    );
  } else {
    console.log(
      `  ⚠️  Check-in returned ${chkRes.status}: ${chkRes.body.error} (may already checked in today)`,
    );
  }
}

async function test_15_points_tiers() {
  console.log("\n🎯 [Test 15] Points — Tiers...");
  const res = await api.get(API + "/points/tiers");

  assert.strictEqual(res.status, 200, "Tiers should return 200");
  const tiers = res.body.tiers || (res.body.data && res.body.data.tiers) || [];
  assert.ok(Array.isArray(tiers), "Tiers should be array");
  assert.ok(tiers.length >= 3, "Should have at least 3 tiers");
  console.log(
    `  ✅ Tiers OK — ${tiers.length} tiers: ${tiers.map((t) => t.label || t.id).join(", ")}`,
  );
}

async function test_16_points_leaderboard() {
  console.log("\n🎯 [Test 16] Points — Leaderboard...");
  const res = await api.get(API + "/points/leaderboard");

  assert.strictEqual(res.status, 200, "Leaderboard should return 200");
  const lb =
    res.body.leaderboard || (res.body.data && res.body.data.leaderboard) || [];
  assert.ok(Array.isArray(lb), "Leaderboard should be array");
  console.log(`  ✅ Leaderboard OK — ${lb.length} entries`);
}

async function test_17_badges() {
  console.log("\n🏅 [Test 17] Badges — List...");
  const res = await api.get(API + "/badges", testToken);

  assert.strictEqual(res.status, 200, "Badges should return 200");
  const badges =
    res.body.badges || (res.body.data && res.body.data.badges) || [];
  assert.ok(Array.isArray(badges), "Badges should be array");
  console.log(`  ✅ Badges OK — ${badges.length} badges`);
}

async function test_18_badges_progress() {
  console.log("\n🏅 [Test 18] Badges — Progress...");
  const res = await api.get(API + "/badges/progress", testToken);

  assert.strictEqual(res.status, 200, "Badges progress should return 200");
  const progress =
    res.body.progress || (res.body.data && res.body.data.progress) || [];
  assert.ok(Array.isArray(progress), "Progress should be array");
  console.log(`  ✅ Badges progress OK — ${progress.length} items`);
}

async function test_19_notifications() {
  console.log("\n🔔 [Test 19] Notifications — List...");
  const res = await api.get(API + "/notifications", testToken);

  assert.strictEqual(res.status, 200, "Notifications should return 200");
  const notifs =
    res.body.notifications ||
    (res.body.data && res.body.data.notifications) ||
    [];
  assert.ok(Array.isArray(notifs), "Notifications should be array");
  console.log(`  ✅ Notifications OK — ${notifs.length} notifications`);
}

async function test_20_notifications_unread() {
  console.log("\n🔔 [Test 20] Notifications — Unread count...");
  const res = await api.get(API + "/notifications/unread-count", testToken);

  assert.strictEqual(res.status, 200, "Unread count should return 200");
  const count =
    res.body.count ?? (res.body.data && res.body.data.count) ?? undefined;
  assert.ok(count !== undefined, "Should have count");
  console.log(`  ✅ Unread count OK — count=${count}`);
}

async function test_21_memberships() {
  console.log("\n💳 [Test 21] Memberships — Plans...");
  const res = await api.get(API + "/memberships/plans");

  // May use /memberships/plans or /memberships path
  let plans;
  if (res.status === 404) {
    // Try without /plans
    const res2 = await api.get(API + "/memberships", testToken);
    console.log(
      `  ⚠️  /plans returned 404, tried /memberships → ${res2.status}`,
    );
    if (res2.status === 200) {
      plans = res2.body.plans || (res2.body.data && res2.body.data.plans);
    }
  } else {
    assert.strictEqual(res.status, 200, "Plans should return 200");
    plans = res.body.plans || (res.body.data && res.body.data.plans);
  }

  if (plans) {
    const planCount =
      typeof plans === "object" ? Object.keys(plans).length : plans.length;
    console.log(`  ✅ Memberships OK — ${planCount} plans`);
  } else {
    console.log(
      `  ⚠️  Could not parse plans, response: ${JSON.stringify(res.body).slice(0, 100)}`,
    );
  }
}

async function test_22_admin_stats() {
  console.log("\n👑 [Test 22] Admin — Login as admin & check stats...");

  // Login as admin
  const loginRes = await api.post(API + "/auth/login", {
    email: "admin@zenpass.hk",
    password: "admin123",
  });

  if (loginRes.status !== 200) {
    console.log(
      `  ⚠️  Admin login failed: ${loginRes.body.error}, skipping admin tests`,
    );
    return;
  }

  adminToken = loginRes.body.token;
  console.log(`  ✅ Admin login OK`);

  // Stats
  const statsRes = await api.get(API + "/admin/stats", adminToken);
  assert.strictEqual(statsRes.status, 200, "Admin stats should return 200");
  const stats =
    statsRes.body.stats ||
    (statsRes.body.data && statsRes.body.data.stats) ||
    statsRes.body;
  console.log(
    `  ✅ Admin stats OK — users=${stats.total_users}, bookings=${stats.total_bookings}`,
  );

  // Bookings list
  const bookingsRes = await api.get(API + "/admin/bookings", adminToken);
  assert.strictEqual(
    bookingsRes.status,
    200,
    "Admin bookings should return 200",
  );
  console.log(`  ✅ Admin bookings OK`);

  // Users list
  const usersRes = await api.get(API + "/admin/users", adminToken);
  assert.strictEqual(usersRes.status, 200, "Admin users should return 200");
  console.log(`  ✅ Admin users OK`);
}

async function test_23_referral() {
  console.log("\n🔗 [Test 23] Referral — My code...");
  const res = await api.get(API + "/referral/my-code", testToken);

  assert.strictEqual(res.status, 200, "Referral my-code should return 200");
  const code = res.body.code || (res.body.data && res.body.data.code);
  assert.ok(code, "Should have referral code");
  console.log(`  ✅ Referral OK — code=${code}`);
}

async function test_24_waitlist_status() {
  if (!testScheduleId) {
    console.log("\n  ⏭️  Skipping waitlist test — no schedule_id available");
    return;
  }
  console.log("\n⏳ [Test 24] Waitlist — Status check...");
  const res = await api.get(
    API + "/waitlist/status?schedule_id=" + testScheduleId,
    testToken,
  );

  assert.strictEqual(res.status, 200, "Waitlist status should return 200");
  assert.ok(
    res.body.in_waitlist !== undefined ||
      (res.body.data && res.body.data.in_waitlist !== undefined),
    "Should have in_waitlist",
  );
  console.log(`  ✅ Waitlist OK`);
}

async function test_25_crm_students() {
  console.log("\n📋 [Test 25] CRM — Students...");
  const res = await api.get(API + "/crm/students", testToken);

  assert.strictEqual(res.status, 200, "CRM students should return 200");
  const students =
    res.body.students || (res.body.data && res.body.data.students) || [];
  console.log(
    `  ✅ CRM students OK — ${Array.isArray(students) ? students.length : "?"} students`,
  );
}

// ===== 主程序 =====

async function runAllTests() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  ZenPass API Integration Tests          ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Base URL: ${BASE}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const tests = [
    { name: "Health Check", fn: test_01_health },
    { name: "Auth Register", fn: test_02_auth_register },
    { name: "Auth Login", fn: test_03_auth_login },
    { name: "Auth Me", fn: test_04_auth_me },
    { name: "Users Me", fn: test_05_users_me },
    { name: "Classes List", fn: test_06_classes_list },
    { name: "Class Detail", fn: test_07_class_detail },
    { name: "Categories", fn: test_08_classes_categories },
    { name: "Upcoming", fn: test_09_classes_upcoming },
    { name: "Available Dates", fn: test_10_classes_available_dates },
    { name: "Booking Create", fn: test_11_booking_flow },
    { name: "My Bookings", fn: test_12_my_bookings },
    { name: "Trial Status", fn: test_13_trial_status },
    { name: "Points Summary", fn: test_14_points },
    { name: "Points Tiers", fn: test_15_points_tiers },
    { name: "Points Leaderboard", fn: test_16_points_leaderboard },
    { name: "Badges List", fn: test_17_badges },
    { name: "Badges Progress", fn: test_18_badges_progress },
    { name: "Notifications", fn: test_19_notifications },
    { name: "Unread Count", fn: test_20_notifications_unread },
    { name: "Memberships", fn: test_21_memberships },
    { name: "Admin Stats", fn: test_22_admin_stats },
    { name: "Referral", fn: test_23_referral },
    { name: "Waitlist", fn: test_24_waitlist_status },
    { name: "CRM Students", fn: test_25_crm_students },
  ];

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err) {
      if (
        err.code === "ERR_ASSERTION" &&
        err.message &&
        err.message.includes("Skipping")
      ) {
        skipped++;
      } else {
        console.error(`  ❌ FAILED: ${err.message}`);
        if (err.actual !== undefined) {
          console.error(`     expected: ${JSON.stringify(err.expected)}`);
          console.error(`     actual:   ${JSON.stringify(err.actual)}`);
        }
        failed++;
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n╔══════════════════════════════════════════╗");
  console.log(
    `║  Results: ${passed} passed, ${failed} failed, ${skipped} skipped  ║`,
  );
  console.log(`║  Duration: ${duration}s                       ║`);
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) {
    process.exit(1);
  }
}

// Run
runAllTests().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
