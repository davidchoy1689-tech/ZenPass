/** ZenPass — 錢包對帳巡邏 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-wpatrol-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','a@x.com','admin')").run();
  pre.prepare("INSERT INTO users (id,name,email,wallet_balance,pending_payout) VALUES ('bad','阿甲','b@x.com',250,100)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("UPDATE users SET wallet_balance = 250, pending_payout = 100 WHERE id='bad'").run();

  const { auditWalletBalances } = require("../src/services/wallet-reconcile");

  console.log("🧪 錢包對帳巡邏 tests");

  const now = new Date("2026-10-19T04:00:00Z");
  const r1 = auditWalletBalances({ now });
  await new Promise((r) => setTimeout(r, 60));
  ok(r1.mismatches === 1, "偵測 1 個不一致");
  ok(r1.notified === 1, "通知 1 個 admin");
  const n = db.prepare("SELECT * FROM notifications WHERE user_id='admin1' AND type='wallet.mismatch'").get();
  ok(!!n && /阿甲/.test(n.message) && /250/.test(n.message), "通知內容有姓名 + 餘額");

  const r2 = auditWalletBalances({ now });
  ok(r2.notified === 0, "同日再跑唔重複通知");

  const r3 = auditWalletBalances({ now: new Date("2026-10-20T04:00:00Z") });
  await new Promise((r) => setTimeout(r, 60));
  ok(r3.notified === 1, "翌日可以再提醒");

  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const notif = fs.readFileSync(path.join(__dirname, "../src/services/notification.js"), "utf8");
  ok(/runWalletReconcile/.test(idx), "scheduler 已接");
  ok(/wallet\.mismatch/.test(notif), "模板存在");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
