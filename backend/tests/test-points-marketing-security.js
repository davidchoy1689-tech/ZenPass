/** ZenPass — 積分／行銷／上傳 安全 tests（2026-10-19）
 *  1. /api/points/referral 不可任意刷分
 *  2. /api/points/review 必須已出席 + 已提交評價
 *  3. /api/marketing/send-welcome 只可以發俾自己（或 admin）
 *  4. upload 副檔名由 MIME 決定，/uploads 加 nosniff
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_jwt_secret_0123456789abcdefghij";
const tmp = path.join(os.tmpdir(), "zenpass-pmsec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 1, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','甲','u1@x.com')").run();
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u2','乙','u2@x.com')").run();
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','ad@x.com','admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  try { db.exec("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0"); } catch (e) {}

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status) VALUES ('c1','u2','班','瑜伽',60,150,15,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',datetime('now','-1 day'),datetime('now','-1 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','ZP-B1','u1','s1','c1','attended','paid',150)").run();

  const pick = (router, p, method = "post") => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = async (handler, user, body, params = {}) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    await handler({ user, body, headers: {}, params, query: {} }, res);
    return res;
  };

  console.log("🧪 積分／行銷／上傳 安全 tests");

  // ===== 1. points/referral 已封 =====
  const points = require("../src/routes/points");
  const referral = pick(points, "/referral");
  const before = db.prepare("SELECT points FROM users WHERE id='u1'").get().points || 0;
  const ref1 = await call(referral, { id: "u1", role: "user" }, { referred_user_id: "u2" });
  ok(ref1.statusCode === 403 && ref1.body.code === "USE_REFERRAL_REDEEM", "points/referral → 403");
  const after = db.prepare("SELECT points FROM users WHERE id='u1'").get().points || 0;
  ok(after === before, "冇加到分");

  // ===== 2. points/review 要有真實評價 =====
  const review = pick(points, "/review");
  const noReview = await call(review, { id: "u1", role: "user" }, { booking_id: "b1" });
  ok(noReview.statusCode === 400, `未提交評價 → 400（got ${noReview.statusCode}）`);

  db.prepare(`INSERT INTO mutual_reviews (id,target_type,target_id,rater_role,rater_id,context_type,context_id,rating)
              VALUES ('mr1','coach','u2','student','u1','booking','b1',5)`).run();
  const withReview = await call(review, { id: "u1", role: "user" }, { booking_id: "b1" });
  ok(withReview.statusCode === 200, `有評價 → 可領分（got ${withReview.statusCode}）`);
  const again = await call(review, { id: "u1", role: "user" }, { booking_id: "b1" });
  ok(again.statusCode === 400, "同一 booking 唔可以重複領");

  // confirmed 但未出席唔可以領
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b2','ZP-B2','u1','s1','c1','confirmed','paid',150)").run();
  db.prepare(`INSERT INTO mutual_reviews (id,target_type,target_id,rater_role,rater_id,context_type,context_id,rating)
              VALUES ('mr2','coach','u2','student','u1','booking','b2',5)`).run();
  const notAttended = await call(review, { id: "u1", role: "user" }, { booking_id: "b2" });
  ok(notAttended.statusCode === 400, "未出席（confirmed）→ 400");

  // ===== 3. marketing send-welcome 只可以俾自己 =====
  const marketing = require("../src/routes/marketing");
  const welcome = pick(marketing, "/send-welcome");
  const other = await call(welcome, { id: "u1", role: "user" }, { user_id: "u2", name: "X" });
  ok(other.statusCode === 403, "普通用戶發俾其他人 → 403");
  const self = await call(welcome, { id: "u1", role: "user" }, { user_id: "u1", name: "甲" });
  ok(self.statusCode === 200, "發俾自己 → 200");
  const admin = await call(welcome, { id: "admin1", role: "admin" }, { user_id: "u2", name: "乙" });
  ok(admin.statusCode === 200, "admin 可以發俾任何人");

  // ===== 4. upload 安全性（靜態檢查）=====
  const uploadSrc = fs.readFileSync(path.join(__dirname, "../src/routes/upload.js"), "utf8");
  ok(uploadSrc.includes("EXT_BY_MIME") && !/path\.extname\(file\.originalname\)\s*;/.test(uploadSrc.replace(/\/\/.*$/gm, "")), "副檔名由 MIME 決定（唔再用 originalname）");
  const indexSrc = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(indexSrc.includes('"X-Content-Type-Options", "nosniff"'), "/uploads 加 X-Content-Type-Options: nosniff");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
