/** ZenPass — 積分到期前提醒 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-pexpiry-notify-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };
const sqlTime = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " ");

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', points INTEGER DEFAULT 0, last_checkin TEXT,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  const day = 86400000;
  const add = (id, points, lastActivityDaysAgo) => {
    const t = sqlTime(lastActivityDaysAgo * day);
    pre.prepare("INSERT INTO users (id,name,email,points,created_at) VALUES (?,?,?,?,?)")
      .run(id, id, id + "@x.com", points, t);
  };
  // 12 個月 = 360 日；11 個月 10 日 = 340 日 → 20 日後到期
  add("u_soon", 300, 340);
  add("u_far", 200, 300); // 60 日後才到期
  add("u_expired", 150, 400); // 已過期（由另一 job 處理）
  add("u_zero", 0, 340);
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  for (const [id, points, daysAgo] of [["u_soon",300,340],["u_far",200,300],["u_expired",150,400]]) {
    db.prepare("INSERT INTO points_transactions (id, user_id, type, points, balance_after, source, created_at) VALUES (?,?,?,?,?,?,?)")
      .run("t_" + id, id, "earn", points, points, "checkin", sqlTime(daysAgo * day));
  }
  const { notifyExpiringSoon } = require("../src/services/points-expiry");

  console.log("🧪 積分到期前提醒 tests");

  const r1 = notifyExpiringSoon();
  await new Promise((r) => setTimeout(r, 60));
  ok(r1.notified === 1, "到期前 20 日 → 通知 1 人");
  const notif = db.prepare("SELECT * FROM notifications WHERE user_id='u_soon' AND type='points.expiry_soon'").get();
  ok(!!notif, "寫入站內通知");
  ok(notif && /300/.test(notif.message) && /到期/.test(notif.message), "通知內容有積分數同到期字眼");
  ok(!db.prepare("SELECT 1 FROM notifications WHERE user_id='u_far'").get(), "未夠近（60 日）→ 唔通知");
  ok(!db.prepare("SELECT 1 FROM notifications WHERE user_id='u_expired'").get(), "已過期 → 交畀到期 job");
  ok(!db.prepare("SELECT 1 FROM notifications WHERE user_id='u_zero'").get(), "0 分 → 唔通知");

  const r2 = notifyExpiringSoon();
  ok(r2.notified === 0, "重複執行唔會再發（每到期月份一次）");
  ok(db.prepare("SELECT COUNT(*) c FROM points_expiry_notices WHERE user_id='u_soon'").get().c === 1, "去重表只有一筆");

  console.log("── 接線 ──");
  const src = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(__dirname, "../src/config/init-db.js"), "utf8");
  const notifSrc = fs.readFileSync(path.join(__dirname, "../src/services/notification.js"), "utf8");
  ok(/notifyPointsExpiringSoon/.test(src), "scheduler 已接");
  ok(/points_expiry_notices/.test(initSrc), "init-db 建去重表");
  ok(/points\.expiry_soon/.test(notifSrc), "通知模板存在");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
