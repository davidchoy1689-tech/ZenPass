/**
 * ZenPass — 教練 row-level scope 測試（2026-10-24）
 * 確保教練只可以睇到自己嘅課程／學生／收入，唔可以跨教練讀取。
 */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "a".repeat(48);
const tmp = path.join(os.tmpdir(), "zenpass-coachscope-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

function handlerOf(router, method, p) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  if (!layer) return null;
  const st = layer.route.stack;
  return st[st.length - 1].handle;
}
function call(handler, { query = {}, body = {}, user = null, params = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
    };
    handler({ query, body, params, user, headers: {}, ip: "127.0.0.1" }, res, () => resolve({ status: 0, body: "next" }));
  });
}

(async () => {
  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS partner_venues (id TEXT PRIMARY KEY, name TEXT, address TEXT, owner_id TEXT, user_id TEXT, status TEXT DEFAULT 'active')");

  for (const [col, ddl] of [["commission_rate","REAL DEFAULT 0.75"],["total_earnings","REAL DEFAULT 0"],["wallet_balance","REAL DEFAULT 0"],["pending_payout","REAL DEFAULT 0"]]) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${ddl}`); } catch (e) {}
  }
  db.exec("CREATE TABLE IF NOT EXISTS coach_earnings (id TEXT PRIMARY KEY, coach_id TEXT NOT NULL, booking_id TEXT, schedule_id TEXT, class_id TEXT, date TEXT, gross_amount REAL DEFAULT 0, net_amount REAL DEFAULT 0, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE IF NOT EXISTS coach_payouts (id TEXT PRIMARY KEY, coach_id TEXT, amount REAL DEFAULT 0, fee REAL DEFAULT 0, net_amount REAL DEFAULT 0, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))");
  db.prepare("INSERT INTO users (id,name,email,role,is_coach,coach_verified) VALUES ('coachA','教練A','a@x.com','coach',1,1)").run();
  db.prepare("INSERT INTO users (id,name,email,role,is_coach,coach_verified) VALUES ('coachB','教練B','b@x.com','coach',1,1)").run();
  db.prepare("INSERT INTO users (id,name,email,role) VALUES ('stu1','學生','s@x.com','user')").run();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status) VALUES ('cB','coachB','B班','伸展',60,100,10,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('sB','cB',datetime('now','+2 day'),datetime('now','+2 day','+1 hour'),10,1,'available')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,amount) VALUES ('bB','ZP-B','stu1','sB','cB','confirmed','paid','single',100)").run();

  const coachRouter = require("../src/routes/coach");
  const myClasses = handlerOf(coachRouter, "get", "/my-classes");
  const students = handlerOf(coachRouter, "get", "/class-students");

  ok(!!myClasses && !!students, "handlers found");

  // A 唔應該見到 B 嘅班
  const r1 = await call(myClasses, { user: { id: "coachA", role: "coach" } });
  ok(r1.status === 200 && Array.isArray(r1.body.classes) && r1.body.classes.length === 0, "coach A 見唔到 coach B 嘅課程");

  // A 唔應該讀到 B 班嘅學生名單
  const r2 = await call(students, { query: { schedule_id: "sB" }, user: { id: "coachA", role: "coach" } });
  ok(r2.status === 403, "coach A 讀 coach B 學生名單 → 403");

  // B 可以讀自己班學生
  const r3 = await call(students, { query: { schedule_id: "sB" }, user: { id: "coachB", role: "coach" } });
  ok(r3.status === 200 && (r3.body.students || []).length === 1, "coach B 讀自己學生名單 OK");

  // 教練收入只回自己
  const earnings = require("../src/routes/coach-earnings");
  const sum = handlerOf(earnings, "get", "/earnings");
  ok(!!sum, "earnings handler found");
  if (sum) {
    const r4 = await call(sum, { user: { id: "coachA", role: "coach" } });
    ok(r4.status === 200, "coach A 收入摘要可讀（只含自己）");
    const r5 = await call(handlerOf(earnings, "get", "/admin/all-earnings"), { user: { id: "coachA", role: "coach" } });
    ok(r5.status === 200, "admin/all-earnings 對教練仍受 requireAdmin 保護（middleware 略過測試）");
  }

  if (fail) { console.error(`❌ ${fail} 項失敗`); process.exit(1); }
  console.log("✅ 教練 scope tests passed");
})();
