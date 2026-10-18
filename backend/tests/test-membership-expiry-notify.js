/** ZenPass — 會籍到期通知（7 日 + 1 日、防重複）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-mexp-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, mt] of [["m5","gold"],["m1d","gold"],["mold","gold"],["m20","gold"],["m3","gold"]]) {
    pre.prepare("INSERT INTO users (id,name,email,membership_type) VALUES (?,?,?,?)").run(id, id, id + "@x.com", mt);
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { checkExpiringMemberships } = require("../src/services/membership-expiry");

  const addM = (id, user, end) => db.prepare(
    "INSERT INTO memberships (id,user_id,type,price_hkd,credits_granted,start_date,end_date,status) VALUES (?,?,?,?,?,?,?, 'active')"
  ).run(id, user, "gold", 2899, 362, "2026-10-01", end);

  addM("ms5", "m5", "2026-10-23");   // 5 日後
  addM("ms1", "m1d", "2026-10-19");  // 1 日後
  addM("ms0", "mold", "2026-10-17"); // 已過期
  addM("ms20", "m20", "2026-11-05"); // 18 日後（唔通知）
  addM("ms3", "m3", "2026-10-26");   // 8 日後（今次唔通知）

  console.log("🧪 會籍到期通知 tests");

  const now = new Date("2026-10-18T04:00:00Z"); // 10/18 12:00 HKT
  const r1 = checkExpiringMemberships({ now });
  await new Promise((r) => setTimeout(r, 80));
  ok(r1.notified === 2, "7 日內 2 個會籍 → 通知 2 人");
  ok(r1.expired === 1, "已過期會籍標記 expired");
  ok(db.prepare("SELECT status FROM memberships WHERE id='ms0'").get().status === "expired", "ms0 已 expired");
  ok(!db.prepare("SELECT 1 FROM notifications WHERE user_id='m20'").get(), "18 日後 → 唔通知");
  ok(!db.prepare("SELECT 1 FROM notifications WHERE user_id='m3'").get(), "8 日後 → 今次唔通知");

  const n5 = db.prepare("SELECT * FROM notifications WHERE user_id='m5' AND type='membership.expiring'").get();
  ok(!!n5 && /2026-10-23/.test(n5.message) && /5 日/.test(n5.message), "通知內容有到期日 + 剩餘日數");

  const r2 = checkExpiringMemberships({ now });
  ok(r2.notified === 0, "同一日再跑 → 唔重複");
  ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id='m5' AND type='membership.expiring'").get().c === 1, "每個 stage 只發一次");

  console.log("── 1 日前再提醒 ──");
  const at24 = checkExpiringMemberships({ now: new Date("2026-10-24T04:00:00Z") });
  await new Promise((r) => setTimeout(r, 60));
  ok(at24.notified === 1, "10/24：m3（2 日後）首次通知");
  const at25 = checkExpiringMemberships({ now: new Date("2026-10-25T04:00:00Z") });
  await new Promise((r) => setTimeout(r, 60));
  ok(at25.notified === 1, "10/25：m3 進入 1 日內 → 再提醒一次");
  ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id='m3' AND type='membership.expiring'").get().c === 2, "m3 收到 7d + 1d 兩則");

  const r25 = checkExpiringMemberships({ now: new Date("2026-10-25T05:00:00Z") });
  ok(r25.notified === 0, "同 stage 唔會重複");

  console.log("── 接線 ──");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(__dirname, "../src/config/init-db.js"), "utf8");
  const notifSrc = fs.readFileSync(path.join(__dirname, "../src/services/notification.js"), "utf8");
  ok(/services\/membership-expiry/.test(idx), "scheduler 用新 service");
  ok(/membership_expiry_notices/.test(initSrc), "去重表已建立");
  ok(/membership\.expiring/.test(notifSrc), "通知模板存在");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
