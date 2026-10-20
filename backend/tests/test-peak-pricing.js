/**
 * ZenPass — 高峰時段附加費（feature flag，預設關閉）+ premium_peak 豁免 tests
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-s…ars!";
const tmp = path.join(os.tmpdir(), "zenpass-peak-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, credits REAL DEFAULT 0,
    membership_type TEXT DEFAULT 'none', role TEXT DEFAULT 'user', is_coach INTEGER DEFAULT 0,
    coach_verified INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, coach_id TEXT, price_hkd REAL,
    credits_cost INTEGER, status TEXT DEFAULT 'active', category TEXT, duration INTEGER,
    max_participants INTEGER, venue_name TEXT, venue_address TEXT, image_url TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES (?,?,?,?)").run("u1", "u1", "u1@t.hk", 100);
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES (?,?,?,?)").run("u2", "u2", "u2@t.hk", 100);
  pre.prepare("INSERT INTO classes (id,title,credits_cost) VALUES ('c1','Peak Class',12)").run();
  pre.close();

  await require("../src/config/init-db")();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { getConfig, isPeakStart, applyPeakSurcharge } = require("../src/services/peak-pricing");
  const { deductCredits } = require("../src/services/booking-service");
  const { grantEntitlements } = require("../src/services/membership-catalog");

  console.log("🧪 高峰附加費 tests");

  // 週三 19:00 HK = 11:00 UTC
  const peakTime = "2026-10-21T11:00:00.000Z";
  const offPeakTime = "2026-10-21T02:00:00.000Z"; // 10:00 HK
  const weekend = "2026-10-24T11:00:00.000Z"; // 週六 19:00 HK

  // ── 預設關閉 ──
  ok(getConfig(db).enabled === false, "預設關閉（pricing.peak_enabled=0）");
  ok(applyPeakSurcharge(db, "u1", 12, peakTime).cost === 12, "關閉時高峰都唔加價（12 → 12）");

  ok(isPeakStart(peakTime), "平日 19:00 HK 判定為高峰");
  ok(!isPeakStart(offPeakTime), "平日 10:00 HK 唔算高峰");
  ok(!isPeakStart(weekend), "週末 19:00 唔算高峰（預設只包週一至五）");

  // ── 開啟 ──
  db.prepare(
    "INSERT INTO platform_settings (key,value,description) VALUES ('pricing.peak_enabled','1','test') ON CONFLICT(key) DO UPDATE SET value='1'",
  ).run();
  const on = applyPeakSurcharge(db, "u1", 12, peakTime);
  ok(on.cost === 13.8, "開啟後 12 cr × 1.15 = 13.8 cr");
  ok(on.surcharge === 1.8, "附加費 1.8 cr");
  ok(applyPeakSurcharge(db, "u1", 12, offPeakTime).cost === 12, "離峰時段唔加價");

  // ── premium_peak 豁免 ──
  grantEntitlements("u2", "standard", new Date(Date.now() + 30 * 86400000).toISOString());
  const waived = applyPeakSurcharge(db, "u2", 12, peakTime);
  ok(waived.cost === 12 && waived.waived === true, "有 premium_peak 權益 → 豁免附加費");

  // ── 實際扣點整合 ──
  const r1 = deductCredits(db, "u1", "c1", null, {
    source: "booking",
    description: "test",
    startTime: peakTime,
  });
  ok(r1.ok && r1.creditsCost === 13.8, "deductCredits 實際扣 13.8 cr（高峰）");
  ok(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 86.2, "用戶餘額 100 → 86.2");

  const r2 = deductCredits(db, "u1", "c1", null, {
    source: "booking",
    description: "test",
    startTime: peakTime,
    applyPeak: false,
  });
  ok(r2.ok && r2.creditsCost === 12, "applyPeak:false（迎新半價等）→ 唔加價");

  // 餘額不足（高峰價高過餘額）
  db.prepare("UPDATE users SET credits=13 WHERE id='u2'").run();
  db.prepare("DELETE FROM entitlements WHERE user_id='u2'").run();
  const r3 = deductCredits(db, "u2", "c1", null, { source: "booking", startTime: peakTime });
  ok(!r3.ok, "餘額 13 cr 不足付高峰價 13.8 cr → 正確拒絕");

  try {
    fs.unlinkSync(tmp);
  } catch (e) {}
  console.log(fail === 0 ? "\n✅ 全部通過" : "\n❌ " + fail + " 項失敗");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("❌ 測試錯誤:", e.message);
  process.exit(1);
});
