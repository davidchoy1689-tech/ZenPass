/**
 * ZenPass 禪流 — Points & Waiver 整合測試
 *
 * 測試：
 * 1. 獎勵列表 GET /api/points/rewards
 * 2. 積分兌換 POST /api/points/redeem
 * 3. 兌換記錄 GET /api/points/redemptions
 * 4. 每日簽到 POST /api/points/checkin
 * 5. 積分歷史 GET /api/points/history
 * 6. Waiver submit POST /api/crm/waiver
 */

const http = require("http");

const API_BASE = "http://127.0.0.1:3001";
let passed = 0;
let failed = 0;
let token = "";
let userId = "";

function request(method, path, body, authToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = "Bearer " + authToken;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label} — ${detail || "assertion failed"}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n🧪 ZenPass Points & Waiver Tests\n");
  console.log("─".repeat(50));

  // ===== 0. Health Check =====
  console.log("\n📡 Health Check");
  try {
    const health = await request("GET", "/api/health");
    assert("API 伺服器正常", health.status === 200, `status=${health.status}`);
  } catch (e) {
    assert("API 伺服器正常", false, `無法連接: ${e.message}`);
    console.log("\n⚠️  無法連接 API server，結束測試");
    printSummary();
    process.exit(1);
  }

  // ===== 1. Login / Get Token =====
  console.log("\n🔐 Login");
  try {
    const login = await request("POST", "/api/auth/login", {
      email: "admin@zenpass.hk",
      password: "admin123",
    });
    assert("管理員登入成功", login.status === 200, `status=${login.status}`);
    if (login.body && login.body.token) {
      token = login.body.token;
      userId = login.body.user?.id || "";
    }
  } catch (e) {
    assert("管理員登入成功", false, e.message);
  }

  if (!token) {
    // Try demo login
    try {
      const demo = await request("POST", "/api/auth/demo-login", {});
      assert("Demo 登入成功", demo.status === 200, `status=${demo.status}`);
      if (demo.body && demo.body.token) {
        token = demo.body.token;
        userId = demo.body.user?.id || "";
      }
    } catch (e) {
      assert("Demo 登入成功", false, e.message);
    }
  }

  // ===== 2. Points Rewards =====
  console.log("\n🎁 Points Rewards");
  try {
    const rewards = await request("GET", "/api/points/rewards", null, token);
    assert(
      "GET /api/points/rewards 回傳 200",
      rewards.status === 200,
      `status=${rewards.status}`,
    );
    const rewardCount = (rewards.body?.rewards || []).length;
    assert(
      `獎勵目錄有 ${rewardCount} 項`,
      rewardCount > 0,
      `count=${rewardCount}`,
    );
    if (rewardCount > 0) {
      const first = rewards.body.rewards[0];
      assert(
        "獎勵有 id, name, points_cost, icon",
        first.id && first.name && first.points_cost !== undefined && first.icon,
        JSON.stringify(first),
      );
    }
  } catch (e) {
    assert("GET /api/points/rewards", false, e.message);
  }

  // ===== 3. Points Tier Info =====
  console.log("\n🏆 Points Tiers");
  try {
    const tiers = await request("GET", "/api/points/tiers", null, token);
    assert(
      "GET /api/points/tiers 回傳 200",
      tiers.status === 200,
      `status=${tiers.status}`,
    );
    const tierCount = (tiers.body?.tiers || []).length;
    assert(
      `等級定義有 ${tierCount} 級 (bronze/silver/gold/diamond)`,
      tierCount >= 4,
      `count=${tierCount}`,
    );
  } catch (e) {
    assert("GET /api/points/tiers", false, e.message);
  }

  // ===== 4. Points Summary =====
  console.log("\n📊 Points Summary");
  try {
    const summary = await request("GET", "/api/points", null, token);
    assert(
      "GET /api/points 回傳 200",
      summary.status === 200,
      `status=${summary.status}`,
    );
    if (summary.status === 200) {
      assert(
        "回傳 points, tier, checkinStreak 等欄位",
        summary.body.points !== undefined &&
          summary.body.tier &&
          summary.body.checkinStreak !== undefined,
        JSON.stringify(summary.body).slice(0, 100),
      );
    }
  } catch (e) {
    assert("GET /api/points", false, e.message);
  }

  // ===== 5. Points Checkin =====
  console.log("\n📅 Points Checkin");
  try {
    // First checkin of the day may fail if already checked in
    const checkin = await request("POST", "/api/points/checkin", {}, token);
    if (checkin.status === 200) {
      assert(
        "POST /api/points/checkin 成功",
        checkin.body.success === true,
        JSON.stringify(checkin.body),
      );
      assert(
        "回傳 points, streak, balance",
        checkin.body.points > 0 && checkin.body.streak > 0,
        JSON.stringify(checkin.body),
      );
    } else if (checkin.status === 400 && checkin.body.alreadyCheckedIn) {
      assert("簽到：今日已簽到", true, "alreadyCheckedIn");
    } else {
      assert(
        "POST /api/points/checkin",
        false,
        `status=${checkin.status} ${JSON.stringify(checkin.body)}`,
      );
    }
  } catch (e) {
    assert("POST /api/points/checkin", false, e.message);
  }

  // ===== 6. Points History =====
  console.log("\n📋 Points History");
  try {
    const history = await request("GET", "/api/points/history", null, token);
    assert(
      "GET /api/points/history 回傳 200",
      history.status === 200,
      `status=${history.status}`,
    );
    if (history.status === 200) {
      assert(
        "回傳 transactions array",
        Array.isArray(history.body.transactions),
        typeof history.body.transactions,
      );
    }
  } catch (e) {
    assert("GET /api/points/history", false, e.message);
  }

  // ===== 7. Points Leaderboard =====
  console.log("\n🏅 Points Leaderboard");
  try {
    const lb = await request("GET", "/api/points/leaderboard");
    assert(
      "GET /api/points/leaderboard 回傳 200",
      lb.status === 200,
      `status=${lb.status}`,
    );
    assert(
      "leaderboard 為 array",
      Array.isArray(lb.body?.leaderboard),
      typeof lb.body?.leaderboard,
    );
  } catch (e) {
    assert("GET /api/points/leaderboard", false, e.message);
  }

  // ===== 8. Redeem (test with insufficient points) =====
  console.log("\n🎯 Points Redeem");
  try {
    const redeem = await request(
      "POST",
      "/api/points/redeem",
      { reward_id: "rwd_01" },
      token,
    );
    // We expect either success (if user has enough points) or "積分不足" error
    if (redeem.status === 200) {
      assert(
        "兌換 API 成功",
        redeem.body.success === true,
        JSON.stringify(redeem.body),
      );
      assert("回傳 redemption id", !!redeem.body.redemption?.id, "missing id");
    } else if (redeem.status === 400) {
      assert(
        "兌換 API：積分不足（expected 如果冇足夠分）",
        (redeem.body.error || "").includes("積分不足"),
        `status=400: ${redeem.body.error}`,
      );
    } else {
      assert(
        "POST /api/points/redeem",
        false,
        `status=${redeem.status} ${JSON.stringify(redeem.body)}`,
      );
    }
  } catch (e) {
    assert("POST /api/points/redeem", false, e.message);
  }

  // ===== 9. Redemption History =====
  console.log("\n📦 Redemption History");
  try {
    const redems = await request("GET", "/api/points/redemptions", null, token);
    assert(
      "GET /api/points/redemptions 回傳 200",
      redems.status === 200,
      `status=${redems.status}`,
    );
    assert(
      "redemptions 為 array",
      Array.isArray(redems.body?.redemptions),
      typeof redems.body?.redemptions,
    );
  } catch (e) {
    assert("GET /api/points/redemptions", false, e.message);
  }

  // ===== 10. Waiver Submit =====
  console.log("\n📝 Waiver Submit");
  try {
    const waiver = await request(
      "POST",
      "/api/crm/waiver",
      {
        name: "Test User",
        age: "25",
        gender: "男",
        phone: "98765432",
        conditions: "",
        other: "測試用 waiver submission",
      },
      token,
    );
    assert(
      "POST /api/crm/waiver 回傳 200",
      waiver.status === 200,
      `status=${waiver.status}`,
    );
  } catch (e) {
    // Waiver endpoint might not exist yet - this is okay
    console.log("  ⚠️  /api/crm/waiver 可能未實作 (optional)");
    // Don't count this as fail since it's optional
  }

  // ===== 11. Waiver Frontend Checkbox check =====
  console.log("\n📋 Waiver Frontend Checkbox");
  // Check class-detail.html has the waiver checkbox
  const fs = require("fs");
  const PROJ_ROOT = __dirname + "/../../";
  const classDetailPath = PROJ_ROOT + "frontend/class-detail.html";
  if (fs.existsSync(classDetailPath)) {
    const content = fs.readFileSync(classDetailPath, "utf-8");
    assert(
      "class-detail.html 有 waiver checkbox",
      content.includes('id="waiver-agree"') && content.includes("免責聲明"),
      "Waiver checkbox 或 label 缺失",
    );
    assert(
      "class-detail.html 有 waiver error display",
      content.includes('id="waiver-error"'),
      "waiver-error element 缺失",
    );
    assert(
      "handleBooking 檢查 waiver checkbox",
      content.includes("waiverEl.checked") ||
        content.includes("waiver-agree.checked"),
      "handleBooking 未檢查 waiver agreement",
    );
  } else {
    console.log(
      "  ⚠️  class-detail.html 未找到 (path: " + classDetailPath + ")",
    );
  }

  // ===== 12. CSS file exists =====
  console.log("\n🎨 CSS File Check");
  const cssPath = PROJ_ROOT + "frontend/css/zenpass.css";
  if (fs.existsSync(cssPath)) {
    const cssContent = fs.readFileSync(cssPath, "utf-8");
    assert(
      "frontend/css/zenpass.css 存在",
      cssContent.length > 1000,
      `only ${cssContent.length} bytes`,
    );
    assert(
      "CSS 包含 CSS variables",
      cssContent.includes(":root") && cssContent.includes("--orange-500"),
      "Missing CSS variables",
    );
    assert(
      "CSS 包含 bottom-nav",
      cssContent.includes("bottom-nav") && cssContent.includes(".nav-item"),
      "Missing bottom-nav styles",
    );
    assert(
      "CSS 包含 dark mode",
      cssContent.includes("prefers-color-scheme: dark"),
      "Missing dark mode",
    );
  } else {
    assert("frontend/css/zenpass.css 存在", false, "File not found");
  }

  // ===== 13. DEPLOY.md exists =====
  console.log("\n📄 DEPLOY.md Check");
  const deployPath = PROJ_ROOT + "DEPLOY.md";
  if (fs.existsSync(deployPath)) {
    const deployContent = fs.readFileSync(deployPath, "utf-8");
    assert(
      "DEPLOY.md 存在",
      deployContent.length > 500,
      `only ${deployContent.length} bytes`,
    );
    assert(
      "包含 VPS/Nginx/PM2 部署步驟",
      deployContent.includes("Nginx") &&
        deployContent.includes("PM2") &&
        deployContent.includes("SSL"),
      "Missing deployment sections",
    );
    assert(
      "包含維護 checklist",
      deployContent.includes("checklist") ||
        deployContent.includes("Checklist"),
      "Missing maintenance checklist",
    );
  } else {
    assert("DEPLOY.md 存在", false, "File not found");
  }

  // ===== 14. Git hook exists =====
  console.log("\n🔧 Git Hook Check");
  const hookPath = PROJ_ROOT + ".githooks/pre-commit";
  if (fs.existsSync(hookPath)) {
    const hookContent = fs.readFileSync(hookPath, "utf-8");
    assert(
      ".githooks/pre-commit 存在",
      hookContent.length > 200,
      `only ${hookContent.length} bytes`,
    );
    assert(
      "pre-commit 包含 npm test",
      hookContent.includes("npm test") || hookContent.includes("backend/tests"),
      "Missing test execution in pre-commit",
    );
    // Check executable
    const stats = fs.statSync(hookPath);
    const isExecutable = (stats.mode & 0o111) !== 0;
    assert(
      "pre-commit 為可執行",
      isExecutable,
      `mode=${stats.mode.toString(8)}`,
    );
  } else {
    assert(".githooks/pre-commit 存在", false, "File not found");
  }

  // Print summary
  printSummary();
}

function printSummary() {
  const total = passed + failed;
  console.log("\n" + "═".repeat(50));
  console.log(
    `\n📊 結果: ${passed}/${total} passed, ${failed}/${total} failed\n`,
  );
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("\n💥 測試執行異常:", e.message);
  process.exit(1);
});
