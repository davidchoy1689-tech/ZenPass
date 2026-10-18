/** ZenPass — 公開查詢 → admin 站內通知 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-inqnotif-" + Date.now() + ".db");
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
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','a@x.com','admin')").run();
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('super1','Super','s@x.com','super_admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();

  const router = require("../src/routes/corporate");
  const layer = router.stack.find((l) => l.route && l.route.path === "/inquiry" && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (x) => { res.body = x; return res; };
  handler({ body: { company_name: "測試公司", contact_name: "陳生", contact_email: "c@x.com", contact_phone: "91234567", activities: "瑜伽", message: "想了解" }, user: null }, res);
  await new Promise((r) => setTimeout(r, 60));

  console.log("🧪 查詢通知 tests");
  ok(res.statusCode === 201, "企業查詢提交成功");
  const n1 = db.prepare("SELECT * FROM notifications WHERE user_id='admin1' AND type='corporate.inquiry'").get();
  ok(!!n1 && /測試公司/.test(n1.message) && /陳生/.test(n1.message), "admin 收到企業查詢站內通知");
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE user_id='super1' AND type='corporate.inquiry'").get(), "super_admin 都收到");

  const { notifyAdmins } = require("../src/services/notify-admins");
  const count = notifyAdmins("school.inquiry", { school_name: "測試學校", contact_name: "李老師", contact_email: "t@x.com", sports_of_interest: "地板冰壺" });
  await new Promise((r) => setTimeout(r, 60));
  ok(count === 2, "notifyAdmins 回傳 2 個 admin");
  const n2 = db.prepare("SELECT * FROM notifications WHERE user_id='admin1' AND type='school.inquiry'").get();
  ok(!!n2 && /測試學校/.test(n2.message) && /地板冰壺/.test(n2.message), "學校查詢通知內容正確");

  const schoolRouter = require("../src/routes/school");
  const l2 = schoolRouter.stack.find((l) => l.route && l.route.path === "/inquiries");
  const listHandler = l2.route.stack[l2.route.stack.length - 1].handle;
  const res2 = { statusCode: 200 };
  res2.status = (c) => { res2.statusCode = c; return res2; };
  res2.json = (x) => { res2.body = x; return res2; };
  listHandler({ user: { id: "admin1", role: "admin" }, query: {} }, res2);
  ok(res2.statusCode === 200 && Array.isArray(res2.body.inquiries), "無資料時查詢列表回 200 []（唔再 500）");

  console.log("── 接線 ──");
  const schoolSrc = fs.readFileSync(path.join(__dirname, "../src/routes/school.js"), "utf8");
  const corpSrc = fs.readFileSync(path.join(__dirname, "../src/routes/corporate.js"), "utf8");
  const notifSrc = fs.readFileSync(path.join(__dirname, "../src/services/notification.js"), "utf8");
  ok(/notifyAdmins\("school\.inquiry"/.test(schoolSrc), "school route 已接");
  ok(/notifyAdmins\("corporate\.inquiry"/.test(corpSrc), "corporate route 已接");
  ok(/school\.inquiry/.test(notifSrc) && /corporate\.inquiry/.test(notifSrc), "兩個模板存在");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
