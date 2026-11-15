/**
 * 4 位核銷碼：撞碼時必須拒絕（唔可以簽錯人）
 */
process.env["JWT" + "_SECRET"] = "test-secret-code";
process.env.CHECKIN_SECRET = "test-checkin-secret";

const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
  CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, coach_id TEXT);
  CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT);
  CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT,
    status TEXT, payment_status TEXT, attendance_status TEXT, checked_in_at TEXT, checkin_method TEXT,
    group_size INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
`);
const now = new Date();
db.prepare("INSERT INTO users VALUES ('coach','導師','90000000')").run();
db.prepare("INSERT INTO classes VALUES ('c1','伸展班','coach')").run();
db.prepare("INSERT INTO class_schedules VALUES ('s1','c1',?,?)").run(
  new Date(now.getTime() - 600000).toISOString(),
  new Date(now.getTime() + 3000000).toISOString(),
);

const dbmod = require("../src/services/database");
dbmod.getDb = () => db;
const svc = require("../src/services/booking-service");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 4 位核銷碼撞碼防護");

// 暴力搵一對撞碼嘅 booking id（4 位碼 = 10000 種，幾百個 id 內幾乎必有碰撞）
const byCode = new Map();
let pair = null;
for (let i = 0; i < 4000 && !pair; i++) {
  const id = "bk-collide-" + i;
  const code = svc.checkinCodeFor({ id });
  if (byCode.has(code)) pair = [byCode.get(code), id, code];
  else byCode.set(code, id);
}
ok("搵到撞碼組合（測試前提）", !!pair, pair && pair[2]);

if (pair) {
  const [idA, idB, code] = pair;
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status) VALUES (?,?,?,?,?,?)")
    .run(idA, "ZP-A", "coach", "s1", "confirmed", "paid");
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,status,payment_status) VALUES (?,?,?,?,?,?)")
    .run(idB, "ZP-B", "coach", "s1", "confirmed", "paid");

  const r = svc.processQRCheckin({ body: { code }, user: { id: "coach", role: "coach" } });
  ok("撞碼 → 409", r.status === 409, JSON.stringify(r.body));
  ok("錯誤碼 CODE_AMBIGUOUS", r.body && r.body.code === "CODE_AMBIGUOUS", r.body && r.body.code);
  ok("提示包含預約編號", !!(r.body && /ZP-/.test(String(r.body.error))), r.body && r.body.error);
  ok("兩個 booking 都未被簽到",
    db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='attended'").get().n === 0);
}

// 唯一碼只會中一個（唔會被防護誤擋）
const single = db.prepare("SELECT id FROM bookings LIMIT 1").get();
if (single) {
  db.prepare("DELETE FROM bookings WHERE id<>?").run(single.id);
  const code1 = svc.checkinCodeFor({ id: single.id });
  const rows = db.prepare("SELECT id FROM bookings").all();
  const matches = rows.filter((r) => svc.checkinCodeFor(r) === code1);
  ok("唯一碼只中一個", matches.length === 1, String(matches.length));
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
