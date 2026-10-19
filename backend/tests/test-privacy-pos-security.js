/** ZenPass — 私隱／IDOR／POS 輸入驗證 tests（2026-10-19） */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_for_ci_only_0123456789abcdef";
const tmp = path.join(os.tmpdir(), "zenpass-misc-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 1, coach_verified INTEGER DEFAULT 1, total_spent REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE venue_rentals (id TEXT PRIMARY KEY, venue_id TEXT, coach_id TEXT, start_time TEXT, end_time TEXT,
    price_hkd REAL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('coach1','教練','c@x.com')").run();
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','路人','u@x.com')").run();
  pre.prepare("INSERT INTO partner_venues (id,name,owner_id) VALUES ('v1','場一','coach1')").run();
  pre.prepare("INSERT INTO venue_rentals (id,venue_id,coach_id,start_time,end_time,price_hkd) VALUES ('r1','v1','coach1',datetime('now'),datetime('now'),500)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  try { db.exec("ALTER TABLE users ADD COLUMN total_spent REAL DEFAULT 0"); } catch (e) {}

  const pick = (router, p, method = "post") => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (handler, user, body, params = {}) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    await handler({ user, body, headers: {}, params, query: {} }, res);
    return res;
  };

  console.log("🧪 私隱／IDOR／POS tests");

  // 1. 教練公開列表唔再漏 email
  const coachSrc = fs.readFileSync(path.join(__dirname, "../src/routes/coach.js"), "utf8");
  const listBlock = coachSrc.slice(coachSrc.indexOf('router.get("/list"'), coachSrc.indexOf('router.get("/list"') + 900);
  ok(!/u\.email/.test(listBlock), "GET /coach/list 唔再回傳 email");

  // 2. 場地租場紀錄：只限場地負責人
  const vr = require("../src/routes/venue-rentals");
  const getVenueRentals = pick(vr, "/venue/:venueId", "get");
  const denied = await call(getVenueRentals, { id: "u1", role: "user" }, {}, { venueId: "v1" });
  ok(denied.statusCode === 403, `路人睇別人場地租場紀錄 → 403（got ${denied.statusCode}）`);
  const allowed = await call(getVenueRentals, { id: "coach1", role: "coach" }, {}, { venueId: "v1" });
  ok(allowed.statusCode === 200, `場地負責人睇自己場地 → 200（got ${allowed.statusCode}）`);
  const admin = await call(getVenueRentals, { id: "adminx", role: "admin" }, {}, { venueId: "v1" });
  ok(admin.statusCode === 200, "admin 可以睇");

  // 3. POS 負數／零價
  const pos = require("../src/routes/pos");
  const sale = pick(pos, "/sale");
  const neg = await call(sale, { id: "coach1", role: "coach" }, { item_name: "水", unit_price: -100, quantity: 2 });
  ok(neg.statusCode === 400, "負單價 → 400");
  const zero = await call(sale, { id: "coach1", role: "coach" }, { item_name: "水", unit_price: 0 });
  ok(zero.statusCode === 400, "零單價 → 400");
  const badQty = await call(sale, { id: "coach1", role: "coach" }, { item_name: "水", unit_price: 10, quantity: -5 });
  ok(badQty.statusCode === 400, "負數量 → 400");
  const good = await call(sale, { id: "coach1", role: "coach" }, { item_name: "水", unit_price: 10, quantity: 3 });
  ok(good.statusCode === 201 && good.body.total_amount === 30, `正常銷售 3×10=30（got ${good.body && good.body.total_amount}）`);

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
