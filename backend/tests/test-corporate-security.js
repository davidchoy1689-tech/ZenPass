/** ZenPass — 企業 API 權限 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tmp = path.join(os.tmpdir(), "zenpass-corpsec-" + Date.now() + ".db");
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
  for (const [id, role] of [["admin1","admin"],["super1","super_admin"],["hr1","user"],["emp1","user"],["target1","user"]]) {
    pre.prepare("INSERT INTO users (id,name,email,role) VALUES (?,?,?,?)").run(id, id, id + "@x.com", role);
  }
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.prepare("INSERT INTO corporate_companies (id,name,contact_email,status) VALUES ('co1','公司','hr@co.com','active')").run();
  const addM = (uid, role) => db.prepare("INSERT INTO corporate_members (id,company_id,user_id,status,role) VALUES (?,?,?,'active',?)")
    .run("cm_" + uid, "co1", uid, role);
  addM("hr1", "hr");
  addM("emp1", "member");

  const router = require("../src/routes/corporate");
  const getHandler = (method, routePath) => {
    const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const invite = getHandler("post", "/my/invite");
  const employee = getHandler("get", "/my/employee/:userId");

  const call = (fn, req) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    fn(req, res);
    return res;
  };

  console.log("🧪 企業 API 權限 tests");

  const normalInvite = call(invite, { user: { id: "emp1", email: "emp1@x.com" }, body: { email: "target1@x.com", name: "Target" } });
  ok(normalInvite.statusCode === 403, "普通員工邀請 → 403");

  const hrInvite = call(invite, { user: { id: "hr1", email: "hr1@x.com" }, body: { email: "target1@x.com", name: "Target" } });
  if (hrInvite.statusCode !== 200) console.log("DEBUG invite:", hrInvite.statusCode, hrInvite.body);
  ok(hrInvite.statusCode === 200, "HR 可以邀請");
  ok(!!db.prepare("SELECT 1 FROM corporate_members WHERE company_id='co1' AND user_id='target1'").get(), "target 已加入公司");

  const peek = call(employee, { user: { id: "emp1" }, params: { userId: "target1" }, query: {} });
  ok(peek.statusCode === 403, "普通員工睇同事資料 → 403");
  const self = call(employee, { user: { id: "emp1" }, params: { userId: "emp1" }, query: {} });
  ok(self.statusCode === 200, "可以睇自己資料");
  const hrPeek = call(employee, { user: { id: "hr1" }, params: { userId: "target1" }, query: {} });
  ok(hrPeek.statusCode === 200, "HR 可以睇員工資料");

  const src = fs.readFileSync(path.join(__dirname, "../src/routes/corporate.js"), "utf8");
  ok(/\["admin", "super_admin"\]\.includes\(u\.role\)/.test(src), "isAdmin 接受 super_admin");
  ok(/只限企業 HR 邀請員工/.test(src) && /只限 HR 查看其他員工資料/.test(src), "有 HR 權限檢查");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
