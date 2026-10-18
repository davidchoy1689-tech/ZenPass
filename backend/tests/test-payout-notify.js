/** ZenPass — 教練提現通知 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-payoutnotif-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('coach1','陳教練','c@x.com')").run();
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','a@x.com','admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const { sendNotification } = require("../src/services/notification");
  const db = getDb();

  console.log("🧪 提現通知 tests");

  await sendNotification("coach.payout_processed", {
    recipient: "coach1",
    data: { amount: 500, status: "approved", eta: "3-5 個工作日", reason: "已處理" },
  });
  const n1 = db.prepare("SELECT * FROM notifications WHERE user_id='coach1'").get();
  ok(!!n1 && /提現已批准/.test(n1.message), "批准通知標題正確");
  ok(!!n1 && /500/.test(n1.message) && /3-5/.test(n1.message), "批准通知有金額 + 到賬時間");

  await sendNotification("coach.payout_processed", {
    recipient: "coach1",
    data: { amount: 300, status: "rejected", reason: "資料不足" },
  });
  const n2 = db.prepare("SELECT * FROM notifications WHERE user_id='coach1' AND message LIKE '%未獲批%'").get();
  ok(!!n2 && /未獲批/.test(n2.message) && /資料不足/.test(n2.message), "拒絕通知有原因");

  await sendNotification("payout.requested", {
    recipient: "admin1",
    data: { coach_name: "陳教練", amount: 500 },
  });
  const n3 = db.prepare("SELECT * FROM notifications WHERE user_id='admin1'").get();
  ok(!!n3 && /陳教練/.test(n3.message) && /500/.test(n3.message), "admin 收到提現申請（教練 + 金額）");

  console.log("── 接線 ──");
  const routeSrc = fs.readFileSync(path.join(__dirname, "../src/routes/coach-earnings.js"), "utf8");
  const notifSrc = fs.readFileSync(path.join(__dirname, "../src/services/notification.js"), "utf8");
  ok(/recipient: a\.id/.test(routeSrc), "提現申請逐個 admin 發送（有 recipient）");
  ok(/role IN \('admin','super_admin','platform_manager'\)/.test(routeSrc), "只通知管理員");
  ok(/coach\.payout_processed/.test(notifSrc) && /payout\.requested/.test(notifSrc), "兩個模板存在");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
