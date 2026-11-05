/**
 * P2：Pooling Engine（成團／流班／狀態機）
 */
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { processPooling, startPooling } = require("../src/services/pooling-scheduler");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE class_schedules (
      id TEXT PRIMARY KEY, class_id TEXT, title TEXT, start_time TEXT, enrolled_count INTEGER DEFAULT 0,
      max_participants INTEGER DEFAULT 8, min_threshold INTEGER DEFAULT 4,
      pooling_deadline TEXT, pooling_status TEXT DEFAULT 'none', preauth_status TEXT DEFAULT 'none'
    );
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT,
      status TEXT, amount REAL, cancel_reason TEXT
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT, user_id TEXT,
      new_values TEXT, description TEXT, created_at TEXT
    );
  `);
  return db;
}
const future = (min) => new Date(Date.now() + min * 60000).toISOString();

function seed(db, { n = 3, deadlineMin = 60, threshold = 4 } = {}) {
  db.prepare(
    "INSERT INTO class_schedules (id,class_id,title,start_time,enrolled_count,min_threshold,pooling_deadline,pooling_status) VALUES ('s1','c1','樂齡伸展',?,?,?,?, 'pooling')",
  ).run(future(120), n, threshold, future(deadlineMin));
  for (let i = 0; i < n; i++) {
    db.prepare("INSERT INTO users VALUES (?,?,?)").run("u" + i, "學員" + i, "9123456" + i);
    db.prepare("INSERT INTO bookings VALUES (?,?,?,?,?,?,NULL)").run("b" + i, "ZP-000" + i, "u" + i, "s1", "pending_payment", 140);
  }
}

(async () => {
  console.log("\n🧪 1. 未夠人、未到截止 → 保持 pooling");
  {
    const db = makeDb(); seed(db, { n: 3, deadlineMin: 60 });
    const notes = [];
    const r = await processPooling(db, { notify: async (x) => notes.push(x), logger: { log() {}, error() {} } });
    ok("skipped=1", r.skipped === 1);
    ok("狀態仍 pooling", db.prepare("SELECT pooling_status p FROM class_schedules WHERE id='s1'").get().p === "pooling");
    ok("冇通知", notes.length === 0);
  }

  console.log("\n🧪 2. 夠 4 人 → succeeded + confirmed");
  {
    const db = makeDb(); seed(db, { n: 4, deadlineMin: 60 });
    const notes = [];
    const r = await processPooling(db, { notify: async (x) => notes.push(x), logger: { log() {}, error() {} } });
    ok("回傳 succeeded", r.succeeded.length === 1 && r.succeeded[0].people.length === 4);
    ok("狀態 succeeded", db.prepare("SELECT pooling_status p FROM class_schedules WHERE id='s1'").get().p === "succeeded");
    ok("4 筆 confirmed", db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='confirmed'").get().n === 4);
    ok("audit pooling.succeeded", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='pooling.succeeded'").get().n === 1);
    ok("通知一次（type=succeeded）", notes.length === 1 && notes[0].type === "succeeded");
  }

  console.log("\n🧪 3. 過截止未夠人 → failed + 取消 + 名額歸零");
  {
    const db = makeDb(); seed(db, { n: 3, deadlineMin: -5 });
    const notes = [];
    const r = await processPooling(db, { notify: async (x) => notes.push(x), logger: { log() {}, error() {} } });
    ok("回傳 failed", r.failed.length === 1);
    ok("狀態 failed", db.prepare("SELECT pooling_status p FROM class_schedules WHERE id='s1'").get().p === "failed");
    ok("enrolled_count=0", db.prepare("SELECT enrolled_count n FROM class_schedules WHERE id='s1'").get().n === 0);
    ok("booking cancelled + reason", db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='cancelled' AND cancel_reason='pooling_failed'").get().n === 3);
    ok("audit pooling.failed", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='pooling.failed'").get().n === 1);
    ok("通知 type=failed", notes.length === 1 && notes[0].type === "failed");
  }

  console.log("\n🧪 4. startPooling 設定門檻／截止");
  {
    const db = makeDb(); seed(db, { n: 0, deadlineMin: 0 });
    db.prepare("UPDATE class_schedules SET pooling_status='none' WHERE id='s1'").run();
    startPooling(db, "s1", { minThreshold: 5, deadline: future(120) });
    const s = db.prepare("SELECT * FROM class_schedules WHERE id='s1'").get();
    ok("pooling_status=pooling", s.pooling_status === "pooling");
    ok("min_threshold=5", Number(s.min_threshold) === 5);
    ok("audit pooling.started", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='pooling.started'").get().n === 1);
  }

  console.log("\n🧪 5. 通知失敗不影響狀態轉換");
  {
    const db = makeDb(); seed(db, { n: 4, deadlineMin: 60 });
    const r = await processPooling(db, { notify: async () => { throw new Error("WA down"); }, logger: { log() {}, error() {} } });
    ok("仍然 succeeded", r.succeeded.length === 1 && db.prepare("SELECT pooling_status p FROM class_schedules WHERE id='s1'").get().p === "succeeded");
  }

  console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
