/** ZenPass — Booking 詳情 / QR IDOR tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-bkidr-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, role, coach] of [["owner","user",0],["other","user",0],["coach","coach",1],["admin","admin",0]]) {
    pre.prepare("INSERT INTO users (id,name,email,role,is_coach) VALUES (?,?,?,?,?)").run(id, id, id + "@x.com", role, coach);
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c1','coach','班','瑜伽',60,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count) VALUES ('s1','c1',?,?,10,1)").run(now, now);
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,amount) VALUES ('b1','ZP-IDOR','owner','s1','c1','confirmed',150)").run();

  const router = require("../src/routes/bookings");
  const getHandler = (routePath) => {
    const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.get);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const detail = getHandler("/:id");
  const qr = getHandler("/:id/qr");

  const call = (fn, user) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    fn({ params: { id: "b1" }, user }, res);
    return res;
  };

  console.log("🧪 Booking IDOR tests");

  ok(call(detail, { id: "owner" }).statusCode === 200, "本人可睇 booking 詳情");
  ok(call(detail, { id: "other" }).statusCode === 403, "其他人睇詳情 → 403");
  ok(call(detail, { id: "coach" }).statusCode === 200, "該班教練可睇詳情");
  ok(call(detail, { id: "admin", role: "admin" }).statusCode === 200, "admin 可睇詳情");

  ok(call(qr, { id: "owner" }).statusCode === 200, "本人可取 QR");
  ok(call(qr, { id: "other" }).statusCode === 403, "其他人取 QR → 403");
  ok(call(qr, { id: "coach" }).statusCode === 200, "該班教練可取 QR");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/bookings.js"), "utf8");
  ok(/function canAccessBooking/.test(src), "有 canAccessBooking 檢查");
  ok((src.match(/canAccessBooking\(booking, req\.user\)/g) || []).length >= 2, "詳情 + QR 都有檢查");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
