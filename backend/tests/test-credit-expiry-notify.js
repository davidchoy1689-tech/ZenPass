/** ZenPass — Credit 到期通知（防重複 + HKT）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-creditexp-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    membership_expires_at TEXT, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,credits,membership_type,membership_expires_at) VALUES ('m1','會員甲','m@x.com',22,'gold','2099-12-31')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("INSERT INTO memberships (id,user_id,type,price_hkd,credits_granted,start_date,end_date,status) VALUES ('ms1','m1','gold',2899,362,'2026-10-01','2030-12-31','active')").run();

  const { isExpiryCheckDay, sendCreditExpiryNotifications } = require("../src/services/credit-scheduler");

  console.log("🧪 Credit 到期通知 tests");

  console.log("── 日子判斷（HKT）──");
  ok(isExpiryCheckDay(new Date("2026-10-30T16:30:00Z")), "10 月 31 日 → 通知日");
  ok(isExpiryCheckDay(new Date("2026-10-29T16:30:00Z")), "10 月 30 日 → 通知日");
  ok(isExpiryCheckDay(new Date("2026-10-28T16:30:00Z")), "10 月 29 日 → 通知日（月尾最後 3 日）");
  ok(isExpiryCheckDay(new Date("2026-10-27T16:30:00Z")) === false, "10 月 28 日 → 唔係");

  console.log("── 發送 + 去重 ──");
  const now = new Date("2026-10-29T16:30:00Z"); // 10/30 00:30 HKT
  const n1 = sendCreditExpiryNotifications({ now });
  await new Promise((r) => setTimeout(r, 60));
  ok(n1 === 1, "首次發送 1 個通知");
  const notif = db.prepare("SELECT * FROM notifications WHERE user_id='m1' AND type='credit_expiring'").get();
  ok(!!notif && /2026-11-01/.test(notif.message) && /22/.test(notif.message), "內容有到期日 + 剩餘 credits");

  const n2 = sendCreditExpiryNotifications({ now });
  ok(n2 === 0, "同一小時再跑 → 唔重複發");
  const n3 = sendCreditExpiryNotifications({ now: new Date("2026-10-30T20:00:00Z") });
  ok(n3 === 0, "同日晚上再跑 → 仍然唔重複");
  ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id='m1' AND type='credit_expiring'").get().c === 1, "全月只發一次");

  console.log("── 下個月可以再發 ──");
  const n4 = sendCreditExpiryNotifications({ now: new Date("2026-11-28T04:00:00Z") });
  await new Promise((r) => setTimeout(r, 60));
  ok(n4 === 1, "11 月 28 日 → 新月份可再通知");
  const n5 = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id='m1' AND type='credit_expiring'").get().c;
  ok(n5 === 2, "兩個月各一則");

  console.log("── 接線 ──");
  const src = fs.readFileSync(path.join(__dirname, "../src/services/credit-scheduler.js"), "utf8");
  ok(/monthStartUtc/.test(src) && /already/.test(src), "有月度去重邏輯");
  ok(/lastDay - 2/.test(src), "只限月尾最後 3 日");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
