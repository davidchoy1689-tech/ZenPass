/** ZenPass — VIP 優先預約 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_s…mnop";
const tmp = path.join(os.tmpdir(), "zenpass-vippri-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none', membership_expires_at TEXT,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  const add = (id, tier, mt) => pre.prepare("INSERT INTO users (id,name,loyalty_tier,membership_type,membership_expires_at) VALUES (?,?,?,?,?)")
    .run(id, id, tier, mt || "none", mt ? "2099-12-31" : null);
  add("bronze_u", "bronze");
  add("vip_u", "vip");
  add("goldm_u", "bronze", "gold");
  add("silverm_u", "bronze", "silver");
  add("expired_u", "bronze");
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { checkVipPriorityWindow, isVipCustomer } = require("../src/services/booking-service");

  console.log("🧪 VIP 優先預約 tests");

  const now = new Date();
  const fresh = { created_at: now.toISOString(), vip_priority_hours: 24 };
  const old = { created_at: new Date(now.getTime() - 25 * 3600 * 1000).toISOString(), vip_priority_hours: 24 };
  const noWin = { created_at: now.toISOString(), vip_priority_hours: 0 };

  ok(checkVipPriorityWindow(db, noWin, "bronze_u", now).allowed, "冇設優先窗口 → 所有人可 book");
  ok(checkVipPriorityWindow(db, old, "bronze_u", now).allowed, "新課過咗 24h → 所有人可 book");

  const reject = checkVipPriorityWindow(db, fresh, "bronze_u", now);
  ok(reject.allowed === false, "銅牌 + 新課 24h 內 → 拒絕");
  ok(reject.until && Math.round((reject.until - now) / 3600000) === 24, "回傳開放時間（+24h）");

  ok(!checkVipPriorityWindow(db, fresh, "vip_u", now).allowed, "鉑金會員（loyalty vip）→ 唔算 VIP 優先");
  ok(checkVipPriorityWindow(db, fresh, "goldm_u", now).allowed, "VIP Pass（gold）會員 → 可優先預約");
  ok(!checkVipPriorityWindow(db, fresh, "silverm_u", now).allowed, "高階 Pass（silver）→ 冇優先");

  ok(!isVipCustomer(db, "vip_u"), "isVip：鉑金會員唔算（只計付費 VIP Pass）");
  ok(isVipCustomer(db, "goldm_u"), "isVip：VIP Pass");
  ok(!isVipCustomer(db, "bronze_u"), "isVip：銅牌 = false");

  // 過期 VIP Pass
  db.prepare("INSERT INTO memberships (id,user_id,type,price_hkd,start_date,end_date,status) VALUES ('m1','expired_u','gold',2899,'2020-01-01','2020-02-01','active')").run();
  ok(!isVipCustomer(db, "expired_u"), "過期 VIP Pass → 唔算 VIP");

  console.log("── 接線 / 文案 ──");
  const root = path.join(__dirname, "..");
  const src = fs.readFileSync(path.join(root, "src/services/booking-service.js"), "utf8");
  const coachSrc = fs.readFileSync(path.join(root, "src/routes/coach.js"), "utf8");
  const catSrc = fs.readFileSync(path.join(root, "src/services/membership-catalog.js"), "utf8");
  const memSrc = fs.readFileSync(path.join(root, "src/routes/memberships.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
  ok(/checkVipPriorityWindow\(db, clsGuard, req\.user\.id\)/.test(src), "createBooking 已接入優先窗口");
  ok(/code: "VIP_PRIORITY"/.test(src), "回傳 VIP_PRIORITY 錯誤碼");
  ok(/vip_priority_hours/.test(coachSrc), "教練開班會設定 vip_priority_hours（預設 24h）");
  ok(/ALTER TABLE classes ADD COLUMN vip_priority_hours/.test(initSrc), "init-db 自動加欄");
  ok(/lite: \{ free_cancel: 1 \}/.test(catSrc), "輕量 Pass 冇 priority_booking");
  ok(/silver: \{ free_cancel: 1, unlimited_cancel: 1, pt_sessions: 1 \}/.test(catSrc), "高階 Pass 冇 priority_booking");
  ok(/gold: \{ priority_booking: 3/.test(catSrc), "VIP Pass 有 priority_booking");
  ok(!/優先預約權/.test(memSrc), "計劃文案已移除『優先預約權』（只限 VIP）");
  ok(/VIP 優先預約（新課 24 小時）/.test(memSrc), "VIP Pass 文案寫明 24 小時優先");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
