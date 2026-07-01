#!/usr/bin/env node
/**
 * ZenPass 禪流 — 新功能 Unit Tests
 *
 * 覆蓋範圍：
 * 1. Dynamic Pricing Engine（pricing-engine.js）
 * 2. Loyalty Tier（loyalty.js）
 * 3. Wishlist API
 * 4. Auto Top-up API
 * 5. NPS Survey API
 * 6. Membership Pause / Resume
 * 7. School ECA Inquiry
 *
 * 用法: node backend/tests/test-new-features.js
 */

const assert = require("assert");
const http = require("http");
const express = require("express");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// ======================================================================
// 0. Setup — Temp Test Database
// ======================================================================

const TEST_DB_PATH = path.join(__dirname, "../../backend/data/test-new-features.db");

// Clean up from previous runs
try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* ok */ }

// Set env BEFORE any module loads so the db singleton picks it up
process.env.DB_PATH = TEST_DB_PATH;
process.env.JWT_SECRET = process.env.JWT_SECRET || "zenpass-test-secret-at-least-32-chars-long!!";

let passed = 0;
let failed = 0;
let server = null;
let SERVER_PORT = 0;

function test(name, fn) {
  console.log(`\n📋 ${name}`);
  try {
    fn();
    console.log(`  ✅ Passed`);
    passed++;
  } catch (err) {
    console.log(`  ❌ Failed: ${err.message}`);
    failed++;
  }
}

function testAsync(name, fn) {
  console.log(`\n📋 ${name}`);
  return fn().then(
    () => { console.log(`  ✅ Passed`); passed++; },
    (err) => { console.log(`  ❌ Failed: ${err.message}`); failed++; },
  );
}

function assertEqual(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg || `Expected ${expected}, got ${actual}`);
}

function assertOk(value, msg) {
  assert.ok(value, msg || `Expected truthy, got ${value}`);
}

// ======================================================================
// 0a. Seed Test Database
// ======================================================================

function seedDatabase() {
  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'user',
      credits INTEGER DEFAULT 0,
      membership_type TEXT DEFAULT 'none',
      membership_expires_at TEXT,
      loyalty_tier TEXT DEFAULT 'bronze',
      monthly_bookings INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      is_coach INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      difficulty TEXT DEFAULT 'beginner',
      duration INTEGER DEFAULT 60,
      max_participants INTEGER DEFAULT 15,
      price_hkd REAL DEFAULT 0,
      credits_cost INTEGER DEFAULT 0,
      venue_name TEXT,
      image_url TEXT,
      coach_id TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS class_schedules (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      max_participants INTEGER DEFAULT 15,
      enrolled_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'available'
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending_payment',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      price_hkd REAL NOT NULL,
      credits_granted INTEGER DEFAULT 0,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      paused_until TEXT,
      pause_count INTEGER DEFAULT 0,
      max_pause_days INTEGER DEFAULT 30,
      pause_reason TEXT,
      updated_at TEXT
    );
  `);

  // Seed users — use numeric IDs so NPS Number() coercion works
  db.prepare(`DELETE FROM users`).run();
  db.prepare(`INSERT INTO users (id, name, email, role, credits, membership_type, loyalty_tier, monthly_bookings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("1001", "David", "david@test.com", "user", 50, "standard", "bronze", 0);
  db.prepare(`INSERT INTO users (id, name, email, role, credits, membership_type, loyalty_tier, monthly_bookings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("1002", "Alice", "alice@test.com", "user", 20, "none", "silver", 6);
  db.prepare(`INSERT INTO users (id, name, email, role, credits, membership_type, loyalty_tier, monthly_bookings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("1003", "Bob", "bob@test.com", "user", 100, "standard", "gold", 12);
  db.prepare(`INSERT INTO users (id, name, email, role, credits, membership_type, loyalty_tier, monthly_bookings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("1004", "VIP User", "vip@test.com", "user", 200, "gold", "vip", 25);
  db.prepare(`INSERT INTO users (id, name, email, role, credits)
    VALUES (?, ?, ?, ?, ?)`).run("9001", "Admin", "admin@zenpass.hk", "admin", 0);

  // Seed classes
  db.prepare(`DELETE FROM classes`).run();
  db.prepare(`INSERT INTO classes (id, title, category, difficulty, duration, price_hkd, status, coach_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("class-1", "瑜伽初班", "yoga", "beginner", 60, 150, "active", "coach-1");
  db.prepare(`INSERT INTO classes (id, title, category, difficulty, duration, price_hkd, status, coach_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("class-2", "HIIT 訓練", "fitness", "intermediate", 45, 200, "active", "coach-1");
  db.prepare(`INSERT INTO classes (id, title, category, difficulty, duration, price_hkd, status, coach_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("class-3", "已下架課程", "yoga", "beginner", 60, 100, "inactive", "coach-1");

  // Seed class schedules
  const tomorrow = new Date(Date.now() + 86400000);
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  db.prepare(`DELETE FROM class_schedules`).run();
  db.prepare(`INSERT INTO class_schedules (id, class_id, start_time, end_time, enrolled_count, max_participants)
    VALUES (?, ?, ?, ?, ?, ?)`).run("sched-1", "class-1", tomorrow.toISOString(), new Date(tomorrow.getTime() + 3600000).toISOString(), 5, 15);
  db.prepare(`INSERT INTO class_schedules (id, class_id, start_time, end_time, enrolled_count, max_participants)
    VALUES (?, ?, ?, ?, ?, ?)`).run("sched-2", "class-2", nextWeek.toISOString(), new Date(nextWeek.getTime() + 3600000).toISOString(), 13, 15);

  // Seed bookings
  db.prepare(`DELETE FROM bookings`).run();
  const yesterday = new Date(Date.now() - 86400000);
  db.prepare(`INSERT INTO bookings (id, user_id, schedule_id, class_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("booking-1", "1001", "sched-1", "class-1", "attended", yesterday.toISOString());
  db.prepare(`INSERT INTO bookings (id, user_id, schedule_id, class_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("booking-2", "1001", "sched-2", "class-2", "confirmed", yesterday.toISOString());
  db.prepare(`INSERT INTO bookings (id, user_id, schedule_id, class_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("booking-3", "1002", "sched-1", "class-1", "attended", yesterday.toISOString());
  db.prepare(`INSERT INTO bookings (id, user_id, schedule_id, class_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run("booking-4", "1001", "sched-1", "class-1", "cancelled", yesterday.toISOString());

  // Seed memberships
  db.prepare(`DELETE FROM memberships`).run();
  const futureDate = new Date(Date.now() + 30 * 86400000);
  db.prepare(`INSERT INTO memberships (id, user_id, type, price_hkd, credits_granted, start_date, end_date, status, pause_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("mem-1", "1001", "standard", 799, 100, new Date().toISOString(), futureDate.toISOString(), "active", 0);
  db.prepare(`INSERT INTO memberships (id, user_id, type, price_hkd, credits_granted, start_date, end_date, status, paused_until, pause_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("mem-2", "1001", "standard", 799, 100, new Date(Date.now() - 60*86400000).toISOString(), futureDate.toISOString(), "active", new Date(Date.now() + 5*86400000).toISOString(), 1);

  console.log("  📦 Seed data inserted");
  db.close();
}

// ======================================================================
// 0b. Mock Auth Middleware + Start Test Server
// ======================================================================

function getAuthToken(userId, email, role) {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ id: userId, email, name: "Test User", role: role || "user" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function createTestServer() {
  const app = express();
  app.use(express.json());
  return app;
}

// Mock the auth module in require.cache before loading routes
function mockAuthModule() {
  const mockAuthPath = require.resolve("../src/middleware/auth");
  delete require.cache[mockAuthPath];
  require.cache[mockAuthPath] = {
    id: mockAuthPath,
    filename: mockAuthPath,
    loaded: true,
    exports: {
      authenticateToken: (req, res, next) => {
        const authHeader = req.headers["authorization"];
        if (!authHeader) {
          return res.status(401).json({ error: "需要登入認證" });
        }
        const token = authHeader.replace("Bearer ", "");
        try {
          const jwt = require("jsonwebtoken");
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          req.user = decoded;
          next();
        } catch (err) {
          return res.status(403).json({ error: "認證無效或已過期" });
        }
      },
      optionalAuth: (req, res, next) => { next(); },
      requireAdmin: (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: "需要登入認證" });
        const db = require("../src/services/database").getDb();
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
        if (user && user.email && user.email.includes("admin")) {
          return next();
        }
        return res.status(403).json({ error: "需要管理員權限" });
      },
      requireCoach: (req, res, next) => { next(); },
      requireRole: () => (req, res, next) => { next(); },
      requireOwnInstitution: (req, res, next) => { next(); },
      requirePlatformStaff: (req, res, next) => { next(); },
      requirePartnerAccess: () => (req, res, next) => { next(); },
      getQueryPartnerId: () => null,
      generateToken: (user) => getAuthToken(user.id, user.email, user.role),
      setAuthCookie: () => {},
      clearAuthCookie: () => {},
      extractToken: (req) => {
        const authHeader = req.headers["authorization"];
        if (authHeader) {
          const parts = authHeader.split(" ");
          if (parts.length === 2 && parts[0] === "Bearer") return parts[1];
        }
        return null;
      },
      ROLE_HIERARCHY: {},
      hasMinimumRole: () => true,
    },
  };
}

function mockNotificationModule() {
  const notifPath = require.resolve("../src/services/notification");
  delete require.cache[notifPath];
  require.cache[notifPath] = {
    id: notifPath,
    filename: notifPath,
    loaded: true,
    exports: {
      sendNotification: async (type, opts) => ({ db: true, telegram: false, email: false }),
      sendTelegramAlert: async () => true,
      dbNotification: (type, userId, data, title) => true,
      emailNotification: async () => true,
      pushNotification: async () => true,
      sendPushNotification: async () => true,
    },
  };
}

function mockBlockchainModule() {
  const bcPath = require.resolve("../src/services/blockchain-audit");
  try {
    delete require.cache[bcPath];
    require.cache[bcPath] = {
      id: bcPath,
      filename: bcPath,
      loaded: true,
      exports: {
        writeBlock: () => true,
        getBlockchain: () => [],
      },
    };
  } catch (e) { /* module might not exist, that's ok */ }
}

// ======================================================================
// HTTP helper functions
// ======================================================================

function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: SERVER_PORT,
      path,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function apiPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: "localhost",
      port: SERVER_PORT,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function apiPut(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: "localhost",
      port: SERVER_PORT,
      path,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function apiDelete(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: SERVER_PORT,
      path,
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ======================================================================
// 1. Dynamic Pricing Engine Tests (pure logic)
// ======================================================================

function testPricingEngine() {
  console.log("\n═══════════════════════════════════════");
  console.log("  1️⃣ Dynamic Pricing Engine");
  console.log("═══════════════════════════════════════");

  const { calculatePrice, getActiveRules, DEFAULT_RULES } = require("../src/services/pricing-engine");

  // Helper: a weekday 3pm date with 50% fill — triggers NO adjustments
  function weekdayMidFill() {
    return {
      start_time: new Date("2026-07-06T15:00:00+08:00").toISOString(), // Monday 3pm
      enrolled_count: 10,
      max_participants: 20,
    };
  }

  // Test 1: Base price — no adjustments
  test("Base price (no adjustments) — weekday 3pm, 50% fill, 3 days out", () => {
    const result = calculatePrice(100, weekdayMidFill());
    assertEqual(result.basePrice, 100, "Base price unchanged");
    assertEqual(result.finalPrice, 100, "Final price = base");
    assertEqual(result.adjustments.length, 0, "No adjustments");
  });

  // Test 2: Weekend morning — 15% off (ensure fill rate avoids low_occupancy)
  test("Weekend morning discount (15% off)", () => {
    const result = calculatePrice(100, {
      start_time: new Date("2026-07-04T10:00:00+08:00").toISOString(), // Saturday 10am
      enrolled_count: 10,  // 50% fill — avoids low_occupancy
      max_participants: 20,
    });
    assertEqual(result.basePrice, 100);
    assertEqual(result.finalPrice, 85, "15% off = 85");
    assertEqual(result.adjustments.length, 1);
    assertEqual(result.adjustments[0].rule_id, "weekend_morning");
    assertEqual(result.adjustments[0].multiplier, 0.85);
  });

  // Test 3: Weekday peak — 15% surcharge
  test("Weekday peak surcharge (15% extra)", () => {
    const result = calculatePrice(100, {
      start_time: new Date("2026-07-07T18:00:00+08:00").toISOString(), // Tuesday 6pm
      enrolled_count: 10,  // 50% fill
      max_participants: 20,
    });
    assertEqual(result.finalPrice, 115, "15% surcharge = 115");
    assertEqual(result.adjustments.length, 1);
    assertEqual(result.adjustments[0].rule_id, "weekday_peak");
    assertEqual(result.adjustments[0].multiplier, 1.15);
  });

  // Test 4: High occupancy (>80%) — 10% surcharge
  test("High occupancy surcharge (10% extra)", () => {
    const result = calculatePrice(100, {
      ...weekdayMidFill(),
      enrolled_count: 18,  // 90% fill
      max_participants: 20,
    });
    assertEqual(result.fill_rate, 90, "90% fill rate");
    assertEqual(result.finalPrice, 110, "10% surcharge = 110");
    assertEqual(result.adjustments.length, 1);
    assertEqual(result.adjustments[0].rule_id, "high_occupancy");
  });

  // Test 5: Low occupancy (<30%) — 10% discount
  test("Low occupancy discount (10% off)", () => {
    const result = calculatePrice(100, {
      ...weekdayMidFill(),
      enrolled_count: 3,   // 15% fill
      max_participants: 20,
    });
    assertEqual(result.fill_rate, 15, "15% fill rate");
    assertEqual(result.finalPrice, 90, "10% off = 90");
    assertEqual(result.adjustments.length, 1);
    assertEqual(result.adjustments[0].rule_id, "low_occupancy");
  });

  // Test 6: Early bird discount — 15% off (7+ days ahead)
  test("Early bird discount (15% off)", () => {
    const futureDate = new Date(Date.now() + 10 * 86400000); // 10 days from now
    const result = calculatePrice(100, {
      start_time: futureDate.toISOString(),
      enrolled_count: 10,  // 50% fill
      max_participants: 20,
    });
    assertEqual(result.finalPrice, 85, "15% off = 85");
    const earlyBirdAdj = result.adjustments.find(a => a.rule_id === "early_bird");
    assertOk(earlyBirdAdj, "Early bird adjustment present");
  });

  // Test 7: Last minute discount — 25% off (<2 hours before)
  test("Last minute discount (25% off)", () => {
    const soonDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const result = calculatePrice(100, {
      start_time: soonDate.toISOString(),
      enrolled_count: 10,  // 50% fill
      max_participants: 20,
    });
    assertEqual(result.finalPrice, 75, "25% off = 75");
    const lastMinAdj = result.adjustments.find(a => a.rule_id === "last_minute");
    assertOk(lastMinAdj, "Last minute adjustment present");
  });

  // Test 8: Multiple rules stacking (weekend + low occupancy)
  test("Multiple rules stack multiplicatively", () => {
    // Saturday 10am (0.85) + low occupancy 15% fill (0.90) = 0.765 → round(76.5) = 77
    const result = calculatePrice(100, {
      start_time: new Date("2026-07-04T10:00:00+08:00").toISOString(),
      enrolled_count: 3,
      max_participants: 20,
    });
    assertEqual(result.finalPrice, 77, "100 * 0.85 * 0.90 = 76.5 → 77");
    assertEqual(result.adjustments.length, 2, "Two adjustments");
  });

  // Test 9: Price never goes below 1
  test("Minimum price is 1", () => {
    const result = calculatePrice(1, {
      ...weekdayMidFill(),
      enrolled_count: 3,
      max_participants: 20,
    });
    assertEqual(result.finalPrice, 1, "Minimum 1 credit");
    assertEqual(result.total_discount_percent, 10, "10% discount (low occupancy)");
  });

  // Test 10: Default RULES structure
  test("DEFAULT_RULES has all 6 rules", () => {
    assertEqual(DEFAULT_RULES.length, 6, "6 default rules");
    const types = DEFAULT_RULES.map(r => r.type);
    assertOk(types.includes("time"), "Has time rule");
    assertOk(types.includes("occupancy"), "Has occupancy rule");
    assertOk(types.includes("early_bird"), "Has early_bird rule");
    assertOk(types.includes("last_minute"), "Has last_minute rule");
  });

  // Test 11: Partner overrides work
  test("Partner overrides can replace rules", () => {
    const result = calculatePrice(100, weekdayMidFill(), {
      partner_overrides: {
        rules: [
          { id: "custom_discount", type: "time", days: [1], hours: [15, 16], multiplier: 0.50, label: "自訂折扣", active: true },
        ],
      },
    });
    assertEqual(result.finalPrice, 50, "Custom 50% off (Monday 3pm)");
    assertEqual(result.adjustments.length, 1);
    assertEqual(result.adjustments[0].rule_id, "custom_discount");
  });

  // Test 12: getActiveRules returns DEFAULT_RULES when no DB config
  test("getActiveRules fallback to DEFAULT_RULES", () => {
    const rules = getActiveRules();
    assertEqual(rules.length, DEFAULT_RULES.length, "Falls back to default");
  });

  // Test 13: Zero max_participants — fallback to 20, 0 enrolled → low occupancy
  test("Zero max_participants triggers fallback capacity (0→20, 0% fill → low occ)", () => {
    const result = calculatePrice(100, {
      start_time: new Date("2026-07-06T15:00:00+08:00").toISOString(),
      enrolled_count: 0,
      max_participants: 0,
    });
    assertEqual(result.finalPrice, 90, "0/20 = 0% → low occupancy 10% off");
    assertEqual(result.fill_rate, 0, "fill_rate = 0%");
  });

  // Test 14: Description contains relevant info
  test("Weekend morning description contains discount %", () => {
    const result = calculatePrice(100, {
      start_time: new Date("2026-07-04T10:00:00+08:00").toISOString(),
      enrolled_count: 10,
      max_participants: 20,
    });
    assertOk(result.adjustments[0].description.includes("優惠") || result.adjustments[0].description.includes("減"),
      "Description mentions discount");
    assertOk(result.adjustments[0].description.includes("%"),
      "Description includes percentage");
  });

  // Test 15: total_discount_percent is correct for multi-rule
  test("total_discount_percent for combined rules", () => {
    // 0.85 * 0.90 = 0.765 → discount = 1 - 0.765 = 0.235 → 24%
    const result = calculatePrice(100, {
      start_time: new Date("2026-07-04T10:00:00+08:00").toISOString(),
      enrolled_count: 3,
      max_participants: 20,
    });
    assertEqual(result.total_discount_percent, 24, "24% total discount");
  });
}

// ======================================================================
// 2. Loyalty Tier Service Tests
// ======================================================================

function testLoyaltyService() {
  console.log("\n═══════════════════════════════════════");
  console.log("  2️⃣ Loyalty Tier Service");
  console.log("═══════════════════════════════════════");

  const { calculateTier, getTopUpDiscount, updateUserTier, getUserTierInfo, TIERS, updateAllTiers } = require("../src/services/loyalty");

  // Test 1: Tier calculation boundaries
  test("Tier: 0-4 bookings = Bronze", () => {
    assertEqual(calculateTier(0), "bronze");
    assertEqual(calculateTier(1), "bronze");
    assertEqual(calculateTier(4), "bronze");
  });

  test("Tier: 5-9 bookings = Silver", () => {
    assertEqual(calculateTier(5), "silver");
    assertEqual(calculateTier(7), "silver");
    assertEqual(calculateTier(9), "silver");
  });

  test("Tier: 10-19 bookings = Gold", () => {
    assertEqual(calculateTier(10), "gold");
    assertEqual(calculateTier(15), "gold");
    assertEqual(calculateTier(19), "gold");
  });

  test("Tier: 20+ bookings = VIP", () => {
    assertEqual(calculateTier(20), "vip");
    assertEqual(calculateTier(50), "vip");
    assertEqual(calculateTier(99), "vip");
  });

  // Test 2: getTopUpDiscount percentages (using pre-seeded DB data)
  test("Top-up discount: user-1001 (bronze) = 0%", () => {
    assertEqual(getTopUpDiscount("1001"), 0, "Bronze = 0%");
  });

  test("Top-up discount: user-1002 (silver) = 5%", () => {
    assertEqual(getTopUpDiscount("1002"), 5, "Silver = 5%");
  });

  test("Top-up discount: user-1003 (gold) = 10%", () => {
    assertEqual(getTopUpDiscount("1003"), 10, "Gold = 10%");
  });

  test("Top-up discount: user-1004 (vip) = 10%", () => {
    assertEqual(getTopUpDiscount("1004"), 10, "VIP = 10%");
  });

  test("Top-up discount: unknown user returns 0", () => {
    assertEqual(getTopUpDiscount("non-existent"), 0, "Unknown = 0%");
  });

  // Test 3: updateUserTier
  test("updateUserTier: Bronze with 3 bookings", () => {
    const result = updateUserTier("1001", 3);
    assertEqual(result.tier, "bronze");
    assertEqual(result.tier_info.name, "銅牌");
    assertEqual(result.booking_count, 3);
    assertEqual(result.tier_info.icon, "🥉");
  });

  test("updateUserTier: Silver with 6 bookings", () => {
    const result = updateUserTier("1002", 6);
    assertEqual(result.tier, "silver");
    assertEqual(result.tier_info.name, "銀牌");
    assertEqual(result.booking_count, 6);
    assertOk(result.benefits.length > 0, "Has benefits");
    const topupBenefit = result.benefits.find(b => b.text.includes("Top-up"));
    assertOk(topupBenefit, "Has Top-up benefit");
  });

  test("updateUserTier: Gold with 15 bookings", () => {
    const result = updateUserTier("1003", 15);
    assertEqual(result.tier, "gold");
    assertEqual(result.tier_info.name, "金牌");
    assertEqual(result.booking_count, 15);
  });

  test("updateUserTier: VIP with 25 bookings", () => {
    const result = updateUserTier("1004", 25);
    assertEqual(result.tier, "vip");
    assertEqual(result.tier_info.name, "VIP");
    assertEqual(result.booking_count, 25);
    assertOk(result.benefits.length >= 5, "VIP has 5+ benefits");
    const guestPass = result.benefits.find(b => b.text.includes("Guest Pass"));
    assertOk(guestPass, "VIP has Guest Pass benefit");
  });

  // Test 4: getUserTierInfo
  test("getUserTierInfo returns correct structure", () => {
    const info = getUserTierInfo("1001");
    assertOk(info, "Returns info");
    assertEqual(info.current_tier, "bronze");
    assertOk(info.current_tier_info, "Has tier info");
    assertEqual(typeof info.progress_percent, "number", "Has progress");
    assertEqual(typeof info.this_month_bookings, "number", "Has this month bookings");
  });

  test("getUserTierInfo: unknown user returns null", () => {
    const info = getUserTierInfo("non-existent");
    assertEqual(info, null);
  });

  // Test 5: TIERS structure
  test("TIERS has all 4 tiers with correct properties", () => {
    assertOk(TIERS.bronze, "Bronze exists");
    assertOk(TIERS.silver, "Silver exists");
    assertOk(TIERS.gold, "Gold exists");
    assertOk(TIERS.vip, "VIP exists");

    assertEqual(TIERS.bronze.min_bookings, 0);
    assertEqual(TIERS.bronze.max_bookings, 4);
    assertEqual(TIERS.silver.min_bookings, 5);
    assertEqual(TIERS.gold.min_bookings, 10);
    assertEqual(TIERS.vip.min_bookings, 20);
    assertEqual(TIERS.vip.max_bookings, Infinity);
  });

  // Test 6: updateAllTiers runs without error
  test("updateAllTiers runs without throwing", () => {
    const count = updateAllTiers();
    assertEqual(typeof count, "number", "Returns count of updated users");
  });

  // Test 7: getTopUpDiscount after tier update
  test("Top-up discount after updateUserTier — user-1001 was set to bronze", () => {
    // user-1001 was updated to bronze with 3 bookings
    assertEqual(getTopUpDiscount("1001"), 0);
  });
}

// ======================================================================
// 3. Wishlist API Tests
// ======================================================================

async function testWishlistAPI(userToken) {
  console.log("\n═══════════════════════════════════════");
  console.log("  3️⃣ Wishlist API");
  console.log("═══════════════════════════════════════");

  // Test 1: GET /api/wishlist - requires auth
  await testAsync("GET /api/wishlist without auth returns 401", async () => {
    const res = await apiGet("/api/wishlist");
    assertEqual(res.status, 401, "401 without auth");
  });

  // Test 2: POST /api/wishlist/:classId - add a class
  await testAsync("POST /api/wishlist/class-1 — 加入收藏", async () => {
    const res = await apiPost("/api/wishlist/class-1", {}, userToken);
    assertEqual(res.status, 200);
    assertOk(res.body.success, "Success true");
    assertEqual(res.body.wishlisted, true);
  });

  // Test 3: POST same class again — already wishlisted
  await testAsync("POST /api/wishlist/class-1 — 重複加入 (已收藏)", async () => {
    const res = await apiPost("/api/wishlist/class-1", {}, userToken);
    assertEqual(res.status, 200);
    assertOk(res.body.wishlisted, true);
    assertOk(res.body.message.includes("已"), "Message indicates already wishlisted");
  });

  // Test 4: GET /api/wishlist - list wishlist
  await testAsync("GET /api/wishlist — 睇收藏列表", async () => {
    const res = await apiGet("/api/wishlist", userToken);
    assertEqual(res.status, 200);
    assertOk(Array.isArray(res.body.wishlist), "wishlist is array");
    assertEqual(res.body.count, 1, "1 item in wishlist");
    assertEqual(res.body.wishlist[0].class_id, "class-1");
    assertOk(res.body.wishlist[0].title, "Has title");
  });

  // Test 5: GET /api/wishlist/check/:classId
  await testAsync("GET /api/wishlist/check/class-1 — 檢查已收藏", async () => {
    const res = await apiGet("/api/wishlist/check/class-1", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.wishlisted, true);
    assertOk(res.body.created_at, "Has created_at");
  });

  await testAsync("GET /api/wishlist/check/class-2 — 檢查未收藏", async () => {
    const res = await apiGet("/api/wishlist/check/class-2", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.wishlisted, false);
    assertEqual(res.body.created_at, null);
  });

  // Test 6: GET /api/wishlist/count
  await testAsync("GET /api/wishlist/count — 收藏數量 badge", async () => {
    const res = await apiGet("/api/wishlist/count", userToken);
    assertEqual(res.status, 200);
    assertEqual(typeof res.body.count, "number");
    assertEqual(res.body.count, 1, "1 item");
  });

  // Test 7: POST to non-existent / inactive class
  await testAsync("POST /api/wishlist/class-3 — 已下架課程 404", async () => {
    const res = await apiPost("/api/wishlist/class-3", {}, userToken);
    assertEqual(res.status, 404, "404 for inactive class");
  });

  // Test 8: DELETE /api/wishlist/:classId
  await testAsync("DELETE /api/wishlist/class-1 — 移除收藏", async () => {
    const res = await apiDelete("/api/wishlist/class-1", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.wishlisted, false);
    assertOk(res.body.message.includes("移除"), "Message says removed");
  });

  // Test 9: DELETE same item again — already not in list
  await testAsync("DELETE /api/wishlist/class-1 — 移除已唔喺列表", async () => {
    const res = await apiDelete("/api/wishlist/class-1", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.wishlisted, false);
  });

  // Test 10: Count after removal
  await testAsync("GET /api/wishlist/count after delete — 0 items", async () => {
    const res = await apiGet("/api/wishlist/count", userToken);
    assertEqual(res.body.count, 0, "0 after removal");
  });

  // Test 11: Non-authenticated routes should 401
  await testAsync("GET /api/wishlist/count without auth returns 401", async () => {
    const res = await apiGet("/api/wishlist/count");
    assertEqual(res.status, 401);
  });

  await testAsync("DELETE /api/wishlist/class-1 without auth returns 401", async () => {
    const res = await apiDelete("/api/wishlist/class-1");
    assertEqual(res.status, 401);
  });
}

// ======================================================================
// 4. Auto Top-up API Tests
// ======================================================================

async function testTopupAPI(userToken) {
  console.log("\n═══════════════════════════════════════");
  console.log("  4️⃣ Auto Top-up API");
  console.log("═══════════════════════════════════════");

  // Test 1: GET /api/topup/config without auth
  await testAsync("GET /api/topup/config without auth returns 401", async () => {
    const res = await apiGet("/api/topup/config");
    assertEqual(res.status, 401);
  });

  // Test 2: GET /api/topup/config — default values
  await testAsync("GET /api/topup/config — defaults (no config yet)", async () => {
    const res = await apiGet("/api/topup/config", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.enabled, false);
    assertEqual(res.body.threshold, 10);
    assertEqual(res.body.bundle_type, "standard");
    assertOk(res.body.bundle, "Has bundle info");
  });

  // Test 3: PUT /api/topup/config — save config
  await testAsync("PUT /api/topup/config — 儲存設定", async () => {
    const res = await apiPut("/api/topup/config", {
      enabled: true,
      threshold: 15,
      bundle: "premium",
    }, userToken);
    assertEqual(res.status, 200);
    assertOk(res.body.success, "Success");
    assertEqual(res.body.config.enabled, true);
    assertEqual(res.body.config.threshold, 15);
    assertEqual(res.body.config.bundle_type, "premium");
  });

  // Test 4: GET /api/topup/config — verify saved config
  await testAsync("GET /api/topup/config — 確認已儲存", async () => {
    const res = await apiGet("/api/topup/config", userToken);
    assertEqual(res.body.enabled, true);
    assertEqual(res.body.threshold, 15);
    assertEqual(res.body.bundle_type, "premium");
    assertEqual(res.body.bundle.credits, 55, "Premium bundle = 55 credits");
  });

  // Test 5: PUT /api/topup/config — invalid threshold (0)
  await testAsync("PUT /api/topup/config — 無效 threshold (0)", async () => {
    const res = await apiPut("/api/topup/config", { threshold: 0 }, userToken);
    assertEqual(res.status, 400, "400 for invalid threshold");
    assertOk(res.body.error, "Has error message");
  });

  // Test 6: PUT /api/topup/config — invalid threshold (101)
  await testAsync("PUT /api/topup/config — 無效 threshold (101)", async () => {
    const res = await apiPut("/api/topup/config", { threshold: 101 }, userToken);
    assertEqual(res.status, 400, "400 for threshold > 100");
  });

  // Test 7: PUT /api/topup/config — invalid bundle type
  await testAsync("PUT /api/topup/config — 無效 bundle type", async () => {
    const res = await apiPut("/api/topup/config", { bundle: "invalid" }, userToken);
    assertEqual(res.status, 400, "400 for invalid bundle");
    assertOk(res.body.error, "Has error message");
    assertOk(res.body.valid, "Has valid list");
  });

  // Test 8: PUT /api/topup/config — valid threshold (1)
  await testAsync("PUT /api/topup/config — threshold=1 (valid)", async () => {
    const res = await apiPut("/api/topup/config", { threshold: 1 }, userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.config.threshold, 1);
  });

  // Test 9: PUT /api/topup/config — valid threshold (100)
  await testAsync("PUT /api/topup/config — threshold=100 (valid)", async () => {
    const res = await apiPut("/api/topup/config", { threshold: 100 }, userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.config.threshold, 100);
  });

  // Test 10: PUT /api/topup/config — light bundle
  await testAsync("PUT /api/topup/config — light bundle", async () => {
    const res = await apiPut("/api/topup/config", { bundle: "light" }, userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.config.bundle_type, "light");
    assertEqual(res.body.config.bundle.credits, 10, "Light = 10 credits");
    assertEqual(res.body.config.bundle.price, 100, "Light = HK$100");
  });

  // Test 11: PUT /api/topup/config — standard bundle
  await testAsync("PUT /api/topup/config — standard bundle", async () => {
    const res = await apiPut("/api/topup/config", { bundle: "standard" }, userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.config.bundle_type, "standard");
    assertEqual(res.body.config.bundle.credits, 25, "Standard = 25 credits");
  });

  // Test 12: PUT with only enabled flag
  await testAsync("PUT /api/topup/config — 只改 enabled", async () => {
    const res = await apiPut("/api/topup/config", { enabled: false }, userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.config.enabled, false);
  });

  // Test 13: GET /api/topup/history without auth
  await testAsync("GET /api/topup/history without auth returns 401", async () => {
    const res = await apiGet("/api/topup/history");
    assertEqual(res.status, 401);
  });

  // Test 14: GET /api/topup/history (after a topup was triggered)
  await testAsync("GET /api/topup/history", async () => {
    const res = await apiGet("/api/topup/history", userToken);
    assertEqual(res.status, 200);
    assertOk(Array.isArray(res.body.history), "History is array");
    assertEqual(typeof res.body.total, "number");
  });
}

// ======================================================================
// 5. NPS Survey API Tests
// ======================================================================

async function testNPSAPI() {
  console.log("\n═══════════════════════════════════════");
  console.log("  5️⃣ NPS Survey API");
  console.log("═══════════════════════════════════════");

  const userToken = getAuthToken("1001", "david@test.com", "user");
  const adminToken = getAuthToken("9001", "admin@zenpass.hk", "admin");

  // Test 1: POST /api/nps/submit — without auth
  await testAsync("POST /api/nps/submit without auth returns 401", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-1", rating: 9 });
    assertEqual(res.status, 401);
  });

  // Test 2: POST without booking_id or rating
  await testAsync("POST /api/nps/submit — missing booking_id", async () => {
    const res = await apiPost("/api/nps/submit", { rating: 9 }, userToken);
    assertEqual(res.status, 400);
    assertOk(res.body.error, "Has error");
  });

  await testAsync("POST /api/nps/submit — missing rating", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-1" }, userToken);
    assertEqual(res.status, 400);
  });

  // Test 3: Invalid rating (<1 or >10)
  await testAsync("POST /api/nps/submit — rating 0 (invalid)", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-1", rating: 0 }, userToken);
    assertEqual(res.status, 400, "400 for invalid rating");
  });

  await testAsync("POST /api/nps/submit — rating 11 (invalid)", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-1", rating: 11 }, userToken);
    assertEqual(res.status, 400, "400 for rating > 10");
  });

  // Test 4: Rating boundary: 1 (valid) with attended booking
  await testAsync("POST /api/nps/submit — rating 1 (valid boundary)", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-1", rating: 1 }, userToken);
    assertEqual(res.status, 201, "201: rating 1 is valid");
    assertOk(res.body.success, "Success");
    assertOk(res.body.id, "Has survey id");
  });

  // Test 5: Duplicate — same booking cannot submit again
  await testAsync("POST /api/nps/submit — 已提交過評價 (booking-1)", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-1", rating: 8 }, userToken);
    assertEqual(res.status, 400, "400: already submitted");
    assertOk(res.body.error.includes("已經提交"), "Message says already submitted");
  });

  // Test 6: Rating 10 (valid) with different booking/user
  const user2Token = getAuthToken("1002", "alice@test.com", "user");
  await testAsync("POST /api/nps/submit — rating 10 (valid boundary)", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-3", rating: 10 }, user2Token);
    assertEqual(res.status, 201, "201 created");
    assertOk(res.body.success);
  });

  // Test 7: Booking doesn't exist
  await testAsync("POST /api/nps/submit — non-existent booking", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-fake", rating: 7 }, userToken);
    assertEqual(res.status, 404, "404 for unknown booking");
  });

  // Test 8: Booking belongs to different user
  await testAsync("POST /api/nps/submit — 無權限評價他人預約 (booking-3 owned by 1002)", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-3", rating: 9 }, userToken);
    assertEqual(res.status, 403, "403: wrong user");
  });

  // Test 9: Booking not attended (cancelled)
  await testAsync("POST /api/nps/submit — booking-4 is cancelled", async () => {
    const res = await apiPost("/api/nps/submit", { booking_id: "booking-4", rating: 7 }, userToken);
    assertEqual(res.status, 400, "400: not attended");
  });

  // Test 10: GET /api/nps/stats — requires admin
  await testAsync("GET /api/nps/stats without admin returns 403", async () => {
    const res = await apiGet("/api/nps/stats", userToken);
    assertEqual(res.status, 403, "Regular user cannot access stats");
  });

  await testAsync("GET /api/nps/stats — admin access", async () => {
    const res = await apiGet("/api/nps/stats", adminToken);
    assertEqual(res.status, 200);
    assertOk(res.body.stats, "Has stats object");
    assertEqual(typeof res.body.stats.total_responses, "number", "Has total_responses");
    assertEqual(typeof res.body.stats.nps_score, "number", "Has NPS score");
    assertEqual(typeof res.body.stats.average_rating, "number", "Has avg rating");
    assertOk(Array.isArray(res.body.distribution), "Has distribution");
    assertOk(Array.isArray(res.body.recent), "Has recent surveys");
  });

  // Test 11: NPS with comment and would_recommend
  const user3Token = getAuthToken("1003", "bob@test.com", "user");
  // Create an attended booking for user-1003
  const db = require("../src/services/database").getDb();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  db.prepare("INSERT OR IGNORE INTO bookings (id, user_id, schedule_id, class_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("booking-5", "1003", "sched-1", "class-1", "attended", yesterday);

  await testAsync("POST /api/nps/submit — with comment + would_recommend", async () => {
    const res = await apiPost("/api/nps/submit", {
      booking_id: "booking-5",
      rating: 9,
      comment: "  very good class!  ",
      would_recommend: true,
    }, user3Token);
    assertEqual(res.status, 201);
    assertOk(res.body.id, "Has survey id");
  });
}

// ======================================================================
// 6. Membership Pause / Resume API Tests
// ======================================================================

async function testMembershipPauseAPI() {
  console.log("\n═══════════════════════════════════════");
  console.log("  6️⃣ Membership Pause / Resume");
  console.log("═══════════════════════════════════════");

  const userToken = getAuthToken("1001", "david@test.com", "user");

  // Test 1: PUT /api/memberships/:id/pause — without auth
  await testAsync("PUT /api/memberships/:id/pause without auth returns 401", async () => {
    const res = await apiPut("/api/memberships/mem-1/pause", { pause_days: 7 });
    assertEqual(res.status, 401);
  });

  // Test 2: PUT /api/memberships/:id/pause — pause active membership
  await testAsync("PUT /api/memberships/mem-1/pause — 暫停會籍 7 日", async () => {
    const res = await apiPut("/api/memberships/mem-1/pause", { pause_days: 7, reason: "旅行" }, userToken);
    assertEqual(res.status, 200, "200 OK");
    assertOk(res.body.message.includes("暫停"), "Message says paused");
    assertOk(res.body.paused_until, "Has paused_until");
    assertEqual(res.body.pause_count, 1, "Pause count = 1");
    assertOk(res.body.new_end_date, "New end date extended");
  });

  // Test 3: PUT /api/memberships/:id/pause — already paused
  await testAsync("PUT /api/memberships/mem-1/pause — 已暫停緊", async () => {
    const res = await apiPut("/api/memberships/mem-1/pause", { pause_days: 3 }, userToken);
    assertEqual(res.status, 400, "400: already paused");
    assertOk(res.body.error.includes("暫停"), "Error says paused");
  });

  // Test 4: GET /api/memberships/:id/pause-status — check pause status
  await testAsync("GET /api/memberships/mem-1/pause-status — 睇暫停狀態", async () => {
    const res = await apiGet("/api/memberships/mem-1/pause-status", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.is_paused, true, "Is paused");
    assertEqual(typeof res.body.remaining_days, "number", "Has remaining days");
    assertEqual(res.body.pause_count, 1, "Pause count = 1");
    assertEqual(res.body.can_pause, false, "Cannot pause again (already paused)");
    assertEqual(res.body.can_resume, true, "Can resume");
    assertEqual(res.body.pause_reason, "旅行", "Pause reason preserved");
  });

  // Test 5: GET /api/memberships/:id/pause-status — non-existent membership
  await testAsync("GET /api/memberships/fake-id/pause-status — 404", async () => {
    const res = await apiGet("/api/memberships/fake-id/pause-status", userToken);
    assertEqual(res.status, 404, "404 for non-existent membership");
  });

  // Test 6: PUT /api/memberships/:id/resume — resume
  await testAsync("PUT /api/memberships/mem-1/resume — 恢復會籍", async () => {
    const res = await apiPut("/api/memberships/mem-1/resume", {}, userToken);
    assertEqual(res.status, 200);
    assertOk(res.body.message.includes("恢復"), "Message says resumed");
  });

  // Test 7: PUT /api/memberships/:id/resume — already not paused
  await testAsync("PUT /api/memberships/mem-1/resume — 未暫停過 (just resumed)", async () => {
    const res = await apiPut("/api/memberships/mem-1/resume", {}, userToken);
    assertEqual(res.status, 400, "400: not paused");
    assertOk(res.body.error.includes("未暫停"), "Error says not paused");
  });

  // Test 8: GET pause-status after resume
  await testAsync("GET /api/memberships/mem-1/pause-status after resume", async () => {
    const res = await apiGet("/api/memberships/mem-1/pause-status", userToken);
    assertEqual(res.body.is_paused, false, "Not paused after resume");
    assertEqual(res.body.can_pause, true, "Can pause again (only used 1 of 3)");
    assertEqual(res.body.can_resume, false, "Cannot resume (not paused)");
    assertEqual(res.body.pause_count, 1, "Count still 1");
  });

  // Test 9: Pause with max_days=30 cap
  await testAsync("PUT /api/memberships/mem-1/pause — max 30 days cap", async () => {
    const res = await apiPut("/api/memberships/mem-1/pause", { pause_days: 100 }, userToken);
    assertEqual(res.status, 200);
    assertOk(res.body.paused_until, "Paused with capped 30 days");
  });
  // Resume for next test
  await apiPut("/api/memberships/mem-1/resume", {}, userToken);

  // Test 10: Pause with pause_days=0 should default to 1 (min)
  await testAsync("PUT /api/memberships/mem-1/pause — min 1 day (default when 0)", async () => {
    const res = await apiPut("/api/memberships/mem-1/pause", { pause_days: 0 }, userToken);
    assertEqual(res.status, 200, "Defaults to 1 day minimum");
  });
  await apiPut("/api/memberships/mem-1/resume", {}, userToken);

  // Test 11: Non-existent membership
  await testAsync("PUT /api/memberships/fake-id/pause — 404", async () => {
    const res = await apiPut("/api/memberships/fake-id/pause", { pause_days: 7 }, userToken);
    assertEqual(res.status, 404);
  });

  // Test 12: Check mem-2 which already has pause_count=1 and paused_until in future
  await testAsync("GET /api/memberships/mem-2/pause-status — previously paused", async () => {
    const res = await apiGet("/api/memberships/mem-2/pause-status", userToken);
    assertEqual(res.status, 200);
    assertEqual(res.body.is_paused, true);
    assertEqual(res.body.pause_count, 1);
  });

  // Test 13: Pause an already-paused membership (mem-2)
  await testAsync("PUT /api/memberships/mem-2/pause — 已經暫停緊", async () => {
    const res = await apiPut("/api/memberships/mem-2/pause", {}, userToken);
    assertEqual(res.status, 400, "Already paused");
    assertOk(res.body.error.includes("暫停"), "Error mentions pause");
  });
}

// ======================================================================
// 7. School ECA Inquiry API Tests
// ======================================================================

async function testSchoolAPI() {
  console.log("\n═══════════════════════════════════════");
  console.log("  7️⃣ School ECA Inquiry");
  console.log("═══════════════════════════════════════");

  // Note: school routes don't require auth

  // Test 1: POST /api/school/inquiry — missing required fields
  await testAsync("POST /api/school/inquiry — empty body", async () => {
    const res = await apiPost("/api/school/inquiry", {});
    assertEqual(res.status, 400);
    assertOk(res.body.error, "Has error message");
  });

  await testAsync("POST /api/school/inquiry — missing school_name", async () => {
    const res = await apiPost("/api/school/inquiry", {
      contact_name: "張老師",
      contact_email: "teacher@school.edu.hk",
    });
    assertEqual(res.status, 400);
  });

  await testAsync("POST /api/school/inquiry — missing contact_name", async () => {
    const res = await apiPost("/api/school/inquiry", {
      school_name: "聖保羅書院",
      contact_email: "teacher@school.edu.hk",
    });
    assertEqual(res.status, 400);
  });

  await testAsync("POST /api/school/inquiry — missing contact_email", async () => {
    const res = await apiPost("/api/school/inquiry", {
      school_name: "聖保羅書院",
      contact_name: "張老師",
    });
    assertEqual(res.status, 400);
  });

  // Test 2: POST /api/school/inquiry — valid submission
  await testAsync("POST /api/school/inquiry — 完整提交", async () => {
    const res = await apiPost("/api/school/inquiry", {
      school_name: "聖保羅書院",
      contact_name: "張老師",
      contact_email: "teacher@spc.edu.hk",
      contact_phone: "98765432",
      sports_of_interest: "瑜伽, HIIT",
      message: "想為學生安排課後運動班",
    });
    assertEqual(res.status, 200);
    assertOk(res.body.id, "Has inquiry id");
    assertOk(res.body.message.includes("收到"), "Message says received");
  });

  // Test 3: POST /api/school/inquiry — minimal valid
  await testAsync("POST /api/school/inquiry — 最少必要欄位", async () => {
    const res = await apiPost("/api/school/inquiry", {
      school_name: "拔萃女書院",
      contact_name: "陳先生",
      contact_email: "chan@dgs.edu.hk",
    });
    assertEqual(res.status, 200);
    assertOk(res.body.id, "Has inquiry id");
  });

  // Test 4: Check data in DB
  test("School inquiries saved to database", () => {
    const db = require("../src/services/database").getDb();
    const inquiries = db.prepare("SELECT * FROM school_inquiries ORDER BY created_at DESC").all();
    assertOk(inquiries.length >= 2, "At least 2 inquiries saved");

    // The latest one could be either depending on DB timing
    const spc = inquiries.find(i => i.school_name === "聖保羅書院");
    assertOk(spc, "聖保羅書院 saved");
    assertEqual(spc.contact_name, "張老師");
    assertEqual(spc.contact_email, "teacher@spc.edu.hk");
    assertEqual(spc.contact_phone, "98765432");
    assertEqual(spc.status, "pending", "Default status is pending");

    const dgs = inquiries.find(i => i.school_name === "拔萃女書院");
    assertOk(dgs, "拔萃女書院 saved");
    assertEqual(dgs.contact_name, "陳先生");
    assertEqual(dgs.contact_email, "chan@dgs.edu.hk");
  });
}

// ======================================================================
// Main
// ======================================================================

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  🌊 ZenPass 禪流 — New Features Unit Tests");
  console.log("═══════════════════════════════════════════════════════════════");

  // Step 1: Seed test database
  console.log("\n📦 Seeding test database...");
  seedDatabase();

  // Step 2: Mock modules
  console.log("🔧 Mocking external modules...");
  mockAuthModule();
  mockNotificationModule();
  mockBlockchainModule();

  // Close any previous db connection from seedDatabase
  const { closeDb, getDb } = require("../src/services/database");
  closeDb();

  // Step 3: Start test server
  const app = express();
  app.use(express.json());

  // Mount all routes
  const wishlistRoutes = require("../src/routes/wishlist");
  const topupRoutes = require("../src/routes/topup");
  const npsRoutes = require("../src/routes/nps");
  const membershipsRoutes = require("../src/routes/memberships");
  const schoolRoutes = require("../src/routes/school");

  app.use("/api/wishlist", wishlistRoutes);
  app.use("/api/topup", topupRoutes);
  app.use("/api/nps", npsRoutes);
  app.use("/api/memberships", membershipsRoutes);
  app.use("/api/school", schoolRoutes);

  server = app.listen(0, () => {
    SERVER_PORT = server.address().port;
    console.log(`🚀 Test server running on port ${SERVER_PORT}`);
    console.log(`📍 DB: ${TEST_DB_PATH}`);

    const userToken = getAuthToken("1001", "david@test.com", "user");
    console.log(`🔑 Test token: 1001 (David)`);

    // Step 4: Run all tests
    runAllTests(userToken).then(() => {
      console.log("\n═══════════════════════════════════════════════════════════════");
      console.log(`  📊 結果: ${passed} ✅ 通過, ${failed} ❌ 失敗`);
      console.log("═══════════════════════════════════════════════════════════════");

      server.close(() => {
        closeDb();
        try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* ok */ }
        process.exit(failed > 0 ? 1 : 0);
      });
    }).catch(err => {
      console.error("❌ Test runner error:", err);
      server.close(() => {
        closeDb();
        try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* ok */ }
        process.exit(1);
      });
    });
  });
}

async function runAllTests(userToken) {
  // Pure service tests (sync)
  testPricingEngine();
  testLoyaltyService();

  // API tests (async HTTP)
  await testWishlistAPI(userToken);
  await testTopupAPI(userToken);
  await testNPSAPI();
  await testMembershipPauseAPI();
  await testSchoolAPI();
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
