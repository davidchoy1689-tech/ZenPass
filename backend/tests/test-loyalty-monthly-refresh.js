/** ZenPass — 每月自動結算會員等級 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-loymonth-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0, monthly_bookings INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, tier, manual] of [["u1","bronze",0],["u2","bronze",0],["u3","silver",0],["u4","gold",1]]) {
    pre.prepare("INSERT INTO users (id,name,loyalty_tier,loyalty_tier_manual) VALUES (?,?,?,?)").run(id,id,tier,manual);
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { refreshMonthlyTiers } = require("../src/services/loyalty");

  db.prepare("INSERT INTO classes (id, coach_id, title, category, duration, price_hkd, status) VALUES ('c1','u1','測試','瑜伽',60,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id, class_id, start_time, end_time) VALUES ('s1','c1',datetime('now'),datetime('now','+1 hour'))").run();

  const addBk = (id, user, at) => db.prepare(
    "INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, "ZP-" + id, user, "s1", "c1", "attended", at);

  // 2026 年 9 月（HKT）共 25 / 6 筆
  for (let i = 0; i < 25; i++) addBk("a" + i, "u1", "2026-09-15 02:00:00");
  for (let i = 0; i < 6; i++) addBk("b" + i, "u2", "2026-09-20 02:00:00");
  // 邊界：10 月 1 日 00:30 HKT（= 9 月 30 日 16:30 UTC）唔應計入 9 月
  addBk("edge_oct", "u2", "2026-09-30 16:30:00");
  // 邊界：8 月 31 日 23:30 HKT（= 15:30 UTC）唔應計入 9 月
  addBk("edge_aug", "u2", "2026-08-31 15:30:00");
  // 手動用戶都有 booking，但唔應被改
  for (let i = 0; i < 12; i++) addBk("m" + i, "u4", "2026-09-10 02:00:00");

  console.log("🧪 每月自動結算會員等級 tests");

  const now = new Date(Date.UTC(2026, 9, 18, 4, 0, 0)); // 2026-10-18 12:00 HKT
  const out = refreshMonthlyTiers(now);
  ok(out.period === "2026-09", "結算期間 = 上一個月（2026-09）");
  ok(out.scanned === 3, "只掃描非手動用戶（3 人）");

  const get = (id) => db.prepare("SELECT loyalty_tier, monthly_bookings FROM users WHERE id=?").get(id);
  ok(get("u1").loyalty_tier === "vip" && get("u1").monthly_bookings === 25, "25 堂 → VIP");
  ok(get("u2").loyalty_tier === "silver" && get("u2").monthly_bookings === 6, "6 堂 → 銀牌（邊界月份唔計）");
  ok(get("u3").loyalty_tier === "bronze", "0 堂 → 回落銅牌（唔會停留舊等級）");
  ok(get("u4").loyalty_tier === "gold", "手動設定用戶唔受影響");
  ok(out.changed === 3, "3 人等級有變");

  console.log("── 排程接線 ──");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/refreshMonthlyTiers\(now\)/.test(idx), "scheduler 呼叫 refreshMonthlyTiers");
  ok(!/UPDATE users SET loyalty_tier = \?, monthly_bookings = \? WHERE id = \?`\)\.run\(tier, row\.cnt/.test(idx), "已移除舊有重複計算邏輯");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
