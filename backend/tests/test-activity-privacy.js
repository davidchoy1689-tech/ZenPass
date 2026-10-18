/** ZenPass — 公開動態 feed 私隱 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-actpriv-" + Date.now() + ".db");
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
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','陳大文','u1@x.com')").run();
  pre.close();
  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,venue_name,status) VALUES ('c1','u1','私人瑜伽','瑜伽',60,150,'中環','active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time) VALUES ('s1','c1',datetime('now'),datetime('now','+1 hour'))").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status) VALUES ('b1','Z1','u1','s1','c1','confirmed')").run();

  const router = require("../src/routes/activity");
  const layer = router.stack.find((l) => l.route && l.route.path === "/feed");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const call = (user) => {
    const res = {};
    res.json = (x) => { res.body = x; return res; };
    handler({ user, query: {} }, res);
    return res.body.feed;
  };

  console.log("🧪 動態 feed 私隱 tests");
  const guest = call(null);
  ok(guest.every((x) => x.id.startsWith("demo-")), "未登入只見到 demo（冇真實用戶）");
  ok(!guest.some((x) => /陳大文/.test(x.user_name)), "未登入唔會見到真實姓名");

  const member = call({ id: "u1", role: "user" });
  ok(member.some((x) => x.id === "b1"), "登入後可見到真實動態");
  ok(member.filter((x) => x.id === "b1")[0].user_name === "陳＊＊", "中文名有遮罩（陳＊＊）");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/activity.js"), "utf8");
  ok(/router\.get\("\/feed", optionalAuth/.test(src), "route 用 optionalAuth");
  ok(/req\.user \? db\.prepare/.test(src), "只喺登入後查真實資料");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
