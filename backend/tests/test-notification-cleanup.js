/** ZenPass — 通知清理 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-nclean-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','a@x.com')").run();
  pre.close();
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const old = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const add = (id, type, read, days) => db.prepare(
    "INSERT INTO notifications (id,user_id,type,title,message,is_read,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(id, "u1", type, "t", "m", read, old(days));

  add("n1", "general", 1, 100);        // 已讀 100 日 → 刪
  add("n2", "general", 1, 10);         // 已讀 10 日 → 留
  add("n3", "general", 0, 200);        // 未讀 200 日 → 刪
  add("n4", "general", 0, 100);        // 未讀 100 日 → 留
  add("n5", "payment.approved", 1, 300); // 財務 → 永久保留
  add("n6", "payout.requested", 0, 400); // 財務未讀 → 保留

  const { cleanupNotifications } = require("../src/services/notification-cleanup");
  const r = cleanupNotifications({ now: new Date() });

  console.log("🧪 通知清理 tests");
  ok(r.read_deleted === 1, "刪除 1 條舊已讀");
  ok(r.unread_deleted === 1, "刪除 1 條極舊未讀");
  const left = db.prepare("SELECT id FROM notifications ORDER BY id").all().map((x) => x.id);
  ok(JSON.stringify(left) === JSON.stringify(["n2", "n4", "n5", "n6"]), `保留正確（${left.join(",")}）`);
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE id='n5'").get(), "財務通知永久保留");
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE id='n6'").get(), "財務未讀永久保留");

  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/runNotificationCleanup/.test(idx), "scheduler 已接");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
