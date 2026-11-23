/** ZenPass — 對數報告（Audit Reconciliation）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { runAuditReconcile } = require("../src/services/audit-reconcile");

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

const tmp = path.join(os.tmpdir(), "zenpass-audit-rec-" + Date.now() + ".db");
const db = new Database(tmp);

db.exec(`
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, wallet_balance REAL DEFAULT 0);
CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, price_hkd REAL, credits_cost REAL, status TEXT);
CREATE TABLE class_schedules (id TEXT PRIMARY KEY, title TEXT, start_time TEXT);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, class_id TEXT,
  amount REAL, payment_status TEXT, status TEXT, created_at TEXT,
  platform_earned_amount REAL, venue_earned_amount REAL, platform_commission_rate REAL
);
CREATE TABLE ledger (
  id TEXT PRIMARY KEY, booking_id TEXT, user_id TEXT, reference TEXT, debit REAL, credit REAL,
  account_code TEXT, transaction_type TEXT
);
CREATE TABLE wallet_transactions (
  id TEXT PRIMARY KEY, user_id TEXT, amount REAL, balance_before REAL, balance_after REAL,
  created_at TEXT, source_type TEXT, source_id TEXT
);
CREATE TABLE coach_earnings (
  id TEXT PRIMARY KEY, coach_id TEXT, gross_amount REAL, commission_rate REAL, net_amount REAL,
  status TEXT, payout_id TEXT
);
CREATE TABLE coach_payouts (id TEXT PRIMARY KEY);
CREATE TABLE audit_log (id TEXT PRIMARY KEY);
`);

const ins = (sql, ...args) => db.prepare(sql).run(...args);

ins("INSERT INTO users (id,name,email,wallet_balance) VALUES ('u1','陳大文','a@x.com',250)");
ins("INSERT INTO classes (id,title,price_hkd,credits_cost,status) VALUES ('c1','木柱班',140,14,'active')");
ins("INSERT INTO class_schedules (id,title,start_time) VALUES ('s1','木柱班','2026-11-25 10:00:00')");

// 正常 booking：拆賬齊、有 ledger、借貸平
ins(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,amount,payment_status,status,created_at,
     platform_earned_amount,venue_earned_amount,platform_commission_rate)
   VALUES ('b-ok','ZP-OK','u1','s1','c1',140,'paid','confirmed','2026-11-20 10:00:00',28,112,0.2)`,
);
ins("INSERT INTO ledger (id,booking_id,user_id,reference,debit,credit,account_code,transaction_type) VALUES ('l1','b-ok','u1','ref-ok',140,0,'cash','payment')");
ins("INSERT INTO ledger (id,booking_id,user_id,reference,debit,credit,account_code,transaction_type) VALUES ('l2','b-ok','u1','ref-ok',0,140,'revenue','payment')");

// 正常錢包鏈
ins("INSERT INTO wallet_transactions (id,user_id,amount,balance_before,balance_after,created_at) VALUES ('w1','u1',100,0,100,'2026-11-01 09:00:00')");
ins("INSERT INTO wallet_transactions (id,user_id,amount,balance_before,balance_after,created_at) VALUES ('w2','u1',150,100,250,'2026-11-02 09:00:00')");

// 正常教練收入
ins("INSERT INTO coach_earnings (id,coach_id,gross_amount,commission_rate,net_amount,status,payout_id) VALUES ('e1','co1',100,0.8,80,'pending',NULL)");

console.log("🧪 對數報告 tests");

// 1) 乾淨
let r = runAuditReconcile(db);
ok(r.summary.block === 0 && r.summary.advisory === 0 && r.summary.info === 0, "乾淨 DB：0 阻斷 0 提示");
ok(r.summary.clean === true, "clean=true");
ok(r.counts.bookings === 1 && r.counts.ledger === 2, "筆數正確");
ok(r.money.paid_revenue === 140 && r.money.platform_earned === 28 && r.money.venue_earned === 112, "金額總覽正確");
ok(r.checks.filter((c) => c.level === "pass").length === r.checks.length, "全部檢查項目 pass");

// 2) 未計拆賬：未付款 → info；已付款 → advisory
ins(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,amount,payment_status,status,created_at,
     platform_earned_amount,venue_earned_amount)
   VALUES ('b-nosplit','ZP-NOSPLIT','u1','s1','c1',140,'pending','pending_payment','2026-11-21 10:00:00',0,0)`,
);
ins(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,amount,payment_status,status,created_at,
     platform_earned_amount,venue_earned_amount)
   VALUES ('b-nosplit-paid','ZP-NOSPLIT2','u1','s1','c1',140,'paid','confirmed','2026-11-21 11:00:00',0,0)`,
);
r = runAuditReconcile(db);
const c1 = r.groups.find((g) => g.code === "C1.split");
ok(!!c1 && c1.count === 2 && c1.level === "advisory", "拆賬未計：已付款判 advisory");
const c1Paid = c1.items.find((i) => i.booking_id === "b-nosplit-paid");
const c1Pend = c1.items.find((i) => i.booking_id === "b-nosplit");
ok(c1Paid && c1Paid.severity === "advisory", "已付款未拆賬 → advisory");
ok(c1Pend && c1Pend.severity === "info", "未付款未拆賬 → info（唔當問題）");
ok(c1.items[0].meta && c1.items[0].meta.user_name === "陳大文", "問題附用戶資料");
ok(r.money.undistributed_amount === 280 && r.money.undistributed_bookings === 2, "未計拆賬總額正確");
ok(r.money.undistributed_paid_amount === 140 && r.money.undistributed_paid_bookings === 1, "已付款未拆賬金額正確");

// 3) 已付款無 ledger（上線後）
ins(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,amount,payment_status,status,created_at,
     platform_earned_amount,venue_earned_amount)
   VALUES ('b-noledger','ZP-NOLEDGER','u1','s1','c1',120,'paid','confirmed','2026-11-22 10:00:00',0,0)`,
);
r = runAuditReconcile(db);
const c3 = r.groups.find((g) => g.code === "C3.coverage");
ok(!!c3 && c3.count === 2 && c3.level === "block", "已付款無 ledger 判為阻斷");
ok(!!c3.items.find((i) => i.booking_id === "b-noledger"), "阻斷項目帶 booking_id");

// 4) 上線前歷史 booking（advisory，列入 info）
ins(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,amount,payment_status,status,created_at,
     platform_earned_amount,venue_earned_amount)
   VALUES ('b-legacy','ZP-LEGACY','u1','s1','c1',100,'paid','attended','2026-01-05 10:00:00',20,80)`,
);
r = runAuditReconcile(db);
ok(r.summary.info === 2, "上線前歷史 booking 計入已知（info）");
const legacy = r.groups.find((g) => g.code === "C3.coverage_legacy");
ok(!!legacy && legacy.items[0].booking_id === "b-legacy", "歷史 booking 有列出");

// 5) 零金額 booking
ins(
  `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,amount,payment_status,status,created_at,
     platform_earned_amount,venue_earned_amount)
   VALUES ('b-free','ZP-FREE','u1','s1','c1',0,'paid','confirmed','2026-11-22 11:00:00',0,0)`,
);
r = runAuditReconcile(db);
ok(r.summary.info === 3, "零金額 booking 計入已知（info）");
ok(r.money.undistributed_paid_bookings === 2 && r.money.undistributed_paid_amount === 260, "零金額 booking 唔計入已付款未拆賬");

// 6) Ledger 借貸不平
ins("INSERT INTO ledger (id,booking_id,user_id,reference,debit,credit,account_code,transaction_type) VALUES ('l3','b-ok','u1','ref-bad',50,40,'cash','refund')");
r = runAuditReconcile(db);
ok(r.groups.some((g) => g.code === "C2.double_entry" && g.level === "block" && g.count === 1), "偵測 ledger 借貸不平");

// 7) 錢包數學錯誤 + 斷鏈
ins("INSERT INTO wallet_transactions (id,user_id,amount,balance_before,balance_after,created_at) VALUES ('w3','u1',10,250,999,'2026-11-03 09:00:00')");
ins("INSERT INTO wallet_transactions (id,user_id,amount,balance_before,balance_after,created_at) VALUES ('w4','u1',5,1000,1005,'2026-11-04 09:00:00')");
r = runAuditReconcile(db);
ok(r.groups.some((g) => g.code === "C4.wallet_math" && g.level === "block"), "偵測錢包餘額異常");
ok(r.groups.some((g) => g.code === "C4.wallet_chain" && g.level === "advisory"), "偵測錢包斷鏈");

// 8) 教練收入錯誤 + 已出糧無 payout
ins("INSERT INTO coach_earnings (id,coach_id,gross_amount,commission_rate,net_amount,status,payout_id) VALUES ('e2','co2',200,0.8,100,'pending',NULL)");
ins("INSERT INTO coach_earnings (id,coach_id,gross_amount,commission_rate,net_amount,status,payout_id) VALUES ('e3','co3',50,0.8,40,'paid',NULL)");
r = runAuditReconcile(db);
ok(r.groups.some((g) => g.code === "C5.earning_math" && g.count === 1), "偵測教練收入計算錯");
ok(r.groups.some((g) => g.code === "C5.eaming_paid" && g.count === 1), "偵測已出糧但無 payout_id");

// 9) 引用完整性
ins("INSERT INTO ledger (id,booking_id,user_id,reference,debit,credit,account_code,transaction_type) VALUES ('l4','b-ghost','u1','ref-ghost',10,10,'cash','payment')");
r = runAuditReconcile(db);
ok(r.groups.some((g) => g.code === "C6.ref" && g.count === 1 && g.level === "block"), "偵測孤兒 ledger 記錄");

// 10) 課程 Credits 定價
ins("UPDATE classes SET credits_cost=0 WHERE id='c1'");
r = runAuditReconcile(db);
ok(r.groups.some((g) => g.code === "C7.credits_cost" && g.count === 1 && g.level === "block"), "偵測 credits_cost=0 收費課程");
ins("UPDATE classes SET credits_cost=14 WHERE id='c1'");

// 11) 摘要分類唔重疊
r = runAuditReconcile(db);
const blockCount = r.findings.filter((f) => f.severity === "block").length;
ok(r.summary.block === blockCount, "summary.block 等於實際阻斷數");
ok(r.summary.total === r.findings.length, "summary.total 等於全部 findings");

// 12) 空 DB（只有 schema）
const empty = new Database(":memory:");
empty.exec("CREATE TABLE bookings (id TEXT PRIMARY KEY)");
const re = runAuditReconcile(empty);
ok(re.summary.block === 0, "極簡 schema 唔會爆");
ok(re.checks.some((c) => c.code === "C1.schema"), "缺欄位出 schema 提示");

// 13) 路由／UI 已接
const adminJs = fs.readFileSync(path.join(__dirname, "../src/routes/admin.js"), "utf8");
ok(/\/audit-reconcile/.test(adminJs) && /runAuditReconcile/.test(adminJs), "後端路由已接");
const adminHtml = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin.html"), "utf8");
ok(/\[\"reconcile\", \"🧾 對數報告\"/.test(adminHtml), "後台 tab 已加");
ok(/async function reconcileTab/.test(adminHtml) && /\/admin\/audit-reconcile/.test(adminHtml), "前台呼叫 API");

db.close();
try {
  fs.unlinkSync(tmp);
} catch (e) {}

console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
process.exit(fail === 0 ? 0 : 1);
