/**
 * 教練私域學生管理 ＋ 自家記帳（service level）
 * 覆蓋：電話相認、自動綁定原教練、記帳新增／作廢、統計、封存
 */
process.env["JWT" + "_SECRET"] = "test-secret-students";

const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT, role TEXT, is_coach INTEGER,
    lead_source TEXT, wallet_balance REAL DEFAULT 0, pending_payout REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT, user_id TEXT,
    old_values TEXT, new_values TEXT, description TEXT, ip_address TEXT, user_agent TEXT, request_id TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, coach_id TEXT);
  CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT);
  CREATE TABLE bookings (id TEXT PRIMARY KEY, user_id TEXT, schedule_id TEXT, class_id TEXT, status TEXT,
    attendance_status TEXT, payment_status TEXT, amount REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE wallet_transactions (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, amount REAL, balance_before REAL,
    balance_after REAL, source_type TEXT, source_id TEXT, coach_earning_id TEXT, description TEXT, status TEXT,
    created_at TEXT DEFAULT (datetime('now')));
`);
db.prepare("INSERT INTO users (id,name,phone,email,role,is_coach) VALUES ('coach1','靜儀','90000001','c1@x.com','coach',1)").run();
db.prepare("INSERT INTO classes VALUES ('c1','伸展班','coach1')").run();
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1',?,?)").run(
  new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() - 828e5).toISOString(),
);

const dbmod = require("../src/services/database");
dbmod.getDb = () => db;
const svc = require("../src/services/coach-students");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 電話相認 ＋ 自動綁定原教練");
svc.ensureSchema(db);
const crypto = require("crypto");
db.prepare(
  `INSERT INTO student_onboarding_invites (id,coach_id,student_name,phone,notes,initial_pass_quota,token,status)
   VALUES ('inv1','coach1','陳伯','91234567','膝痛',1,?,'pending')`,
).run(crypto.randomBytes(32).toString("hex"));

let list = svc.listStudents(db, "coach1");
ok("未登記 → private", list.students.length === 1 && list.students[0].status === "private", list.students[0] && list.students[0].status);
ok("未登記 → matched_user_id 空", !list.students[0].matched_user_id);

// 學生用同一電話（帶格式）自行註冊
db.prepare("INSERT INTO users (id,name,phone,email,role,is_coach) VALUES ('u1','陳伯','+852 9123-4567','s@x.com','user',0)").run();
const m = svc.matchOnRegister(db, { id: "u1", phone: "+852 9123-4567" });
ok("註冊即相認", m.matched === 1, JSON.stringify(m));
const aff = db.prepare("SELECT * FROM student_coach_affiliations WHERE student_user_id='u1'").get();
ok("自動綁定原教練 coach1", aff && aff.origin_coach_id === "coach1");
list = svc.listStudents(db, "coach1");
ok("狀態轉 registered", list.students[0].status === "registered", list.students[0].status);
ok("有 registered_at", !!list.students[0].registered_at);
ok("統計：已上平台 1", list.stats.on_platform === 1);
ok("有審計紀錄", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='coach.student_matched'").get().n >= 1);

console.log("\n🧪 2. 平台數據（堂數／消費）");
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,attendance_status,payment_status,amount) VALUES ('b1','u1','s1','c1','attended','present','paid',140)").run();
list = svc.listStudents(db, "coach1");
ok("平台堂數 = 1", list.students[0].platform.bookings === 1 && list.students[0].platform.attended === 1);
ok("平台消費 = 140", list.students[0].platform.spent === 140);

console.log("\n🧪 3. 記帳");
let r = svc.addLedgerEntry(db, "coach1", "inv1", { entry_date: "2026-11-01", type: "income", amount: 560, sessions: 4, note: "11 月學費" });
ok("新增收入成功", !!r.entry, JSON.stringify(r));
svc.addLedgerEntry(db, "coach1", "inv1", { entry_date: "2026-11-05", type: "refund", amount: 140, sessions: 1, note: "請假退回" });
let sum = svc.ledgerSummary(db, "inv1");
ok("收入 560", sum.income === 560, String(sum.income));
ok("退款 140", sum.refund === 140, String(sum.refund));
ok("淨額 420", sum.net === 420, String(sum.net));
ok("堂數合計 5", sum.sessions === 5, String(sum.sessions));

r = svc.addLedgerEntry(db, "coach1", "inv1", { type: "income", amount: 0 });
ok("金額 0 → 拒絕", r.error === "AMOUNT_INVALID", JSON.stringify(r));
r = svc.addLedgerEntry(db, "coach1", "inv1", { type: "hack", amount: 10 });
ok("非法類型 → 拒絕", r.error === "TYPE_INVALID");

console.log("\n🧪 4. 作廢（不刪除）");
const entries = svc.listLedger(db, "coach1", "inv1");
const refundEntry = entries.find((e) => e.type === "refund");
const v = svc.voidLedgerEntry(db, "coach1", refundEntry.id, "入錯數");
ok("作廢成功", v.ok === true, JSON.stringify(v));
ok("紀錄仍存在", db.prepare("SELECT COUNT(*) n FROM coach_student_ledger WHERE id=?").get(refundEntry.id).n === 1);
ok("status = void", db.prepare("SELECT status FROM coach_student_ledger WHERE id=?").get(refundEntry.id).status === "void");
sum = svc.ledgerSummary(db, "inv1");
ok("淨額回復 560", sum.net === 560, String(sum.net));
ok("重複作廢 → ALREADY_VOID", svc.voidLedgerEntry(db, "coach1", refundEntry.id, "x").error === "ALREADY_VOID");

console.log("\n🧪 5. 封存 + 隔離");
db.prepare("UPDATE student_onboarding_invites SET archived_at=datetime('now') WHERE id='inv1'").run();
list = svc.listStudents(db, "coach1");
ok("封存後唔顯示", list.students.length === 0);
ok("其他教練睇唔到", svc.listStudents(db, "coach2").students.length === 0);
ok("封存學生唔可以再加帳", svc.addLedgerEntry(db, "coach1", "inv1", { type: "income", amount: 10 }).error === "STUDENT_NOT_FOUND");

console.log("\n🧪 6. 前端接線");
const fs = require("fs");
const p = path.join(__dirname, "..", "..", "frontend-v2", "coach-students.html");
ok("頁面存在", fs.existsSync(p));
if (fs.existsSync(p)) {
  const h = fs.readFileSync(p, "utf8");
  ok("有名冊 API", h.includes("/coach/students"));
  ok("有記帳表單", h.includes("加入記帳"));
  ok("有分享到平台", h.includes("分享到平台"));
  ok("標示已上平台", h.includes("已上平台"));
}
ok("路由已掛載", fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8").includes("routes/coach-students"));
ok("註冊時相認 hook", fs.readFileSync(path.join(__dirname, "..", "src", "routes", "auth.js"), "utf8").includes("matchOnRegister"));

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
