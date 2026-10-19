/** ZenPass — 商戶自動結算 tests（2026-10-19） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_j…ghij";
const tmp = path.join(os.tmpdir(), "zenpass-settle-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, user_id TEXT, owner_id TEXT,
    contact_person TEXT, commission_rate REAL DEFAULT 0.25, status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE partner_payouts (id TEXT PRIMARY KEY, venue_id TEXT, amount REAL, fee REAL, net_amount REAL,
    period_start TEXT, period_end TEXT, status TEXT DEFAULT 'pending', notes TEXT, paid_at TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, membership_type TEXT DEFAULT 'none', created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE classes (id TEXT PRIMARY KEY, coach_id TEXT, title TEXT, category TEXT,
    duration INTEGER, price_hkd REAL, credits_cost REAL, status TEXT DEFAULT 'active',
    partner_venue_id TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE bookings (id TEXT PRIMARY KEY, user_id TEXT, schedule_id TEXT, class_id TEXT,
    payment_type TEXT, payment_status TEXT, amount REAL, status TEXT, venue_partner_id TEXT,
    platform_commission_rate REAL, venue_earned_amount REAL, platform_earned_amount REAL,
    partner_settled_at TEXT, partner_payout_id TEXT, booking_reference TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('u1','商戶','v@x.com','partner_owner')").run();
  pre.prepare("INSERT INTO partner_venues (id,name,user_id,commission_rate) VALUES ('v1','場一','u1',0.25)").run();
  pre.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,partner_venue_id) VALUES ('c1','u1','班','瑜伽',60,150,12,'active','v1')").run();
  pre.prepare(`INSERT INTO bookings (id,user_id,schedule_id,class_id,payment_type,payment_status,amount,status,venue_partner_id,platform_commission_rate,venue_earned_amount,platform_earned_amount,booking_reference)
               VALUES ('b1','u1','s1','c1','single','paid',150,'attended','v1',0.25,100,50,'ZP-1')`).run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  // init-db 可能重建 bookings；確保測試資料仍然存在
  const db = new Database(tmp);
  const hasB = db.prepare("SELECT id FROM bookings WHERE id='b1'").get();
  if (!hasB) {
    db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,payment_type,payment_status,amount,status,venue_partner_id,platform_commission_rate,venue_earned_amount,platform_earned_amount,booking_reference) VALUES ('b1','u1','s1','c1','single','paid',150,'attended','v1',0.25,100,50,'ZP-1')").run();
  }
  db.close();

  const { settlePartnerVenues } = require("../src/scripts/auto-settlement");

  console.log("🧪 商戶自動結算 tests");

  const r1 = settlePartnerVenues();
  ok(r1.settled >= 1, `第一次結算有處理商戶（got ${r1.settled}/${r1.venues}）`);

  const chk = new Database(tmp);
  const payout = chk.prepare("SELECT * FROM partner_payouts WHERE venue_id='v1'").get();
  ok(!!payout, "有 partner_payouts 記錄");
  ok(Number(payout.amount) === 150 && Number(payout.fee) === 50 && Number(payout.net_amount) === 100, `金額 150 / 佣 50 / 淨 100（got ${payout && payout.amount}/${payout && payout.fee}/${payout && payout.net_amount}）`);
  const bk = chk.prepare("SELECT partner_settled_at, partner_payout_id FROM bookings WHERE id='b1'").get();
  ok(!!bk.partner_settled_at && bk.partner_payout_id === payout.id, "booking 已標記結算");
  chk.close();

  settlePartnerVenues();
  const chk2 = new Database(tmp);
  ok(chk2.prepare("SELECT COUNT(*) c FROM partner_payouts WHERE venue_id='v1'").get().c === 1, "v1 仍然只有 1 筆 payout");
  chk2.close();

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
