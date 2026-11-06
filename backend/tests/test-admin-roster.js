/**
 * 管理員紙本名冊（12/12 現場 backup）
 */
const fs = require("fs");
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { buildRoster } = require("../src/services/admin-roster");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT, emergency_name TEXT, emergency_phone TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, venue_name TEXT, venue_address TEXT, coach_id TEXT);
    CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT,
      enrolled_count INTEGER, max_participants INTEGER, status TEXT);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, class_id TEXT,
      status TEXT, payment_status TEXT, attendee_type TEXT, child_name TEXT, parent_name TEXT, parent_phone TEXT,
      medical_notes TEXT, emergency_phone TEXT, checked_in_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  d.prepare("INSERT INTO users VALUES ('u1','陳小明','91234567','陳太','92345678')").run();
  d.prepare("INSERT INTO users VALUES ('u2','李玉珍','98765432',NULL,NULL)").run();
  d.prepare("INSERT INTO users VALUES ('coach1','靜儀導師','90000000',NULL,NULL)").run();
  d.prepare("INSERT INTO classes VALUES ('c1','樂齡深層伸展','青衣楓樹窩體育館','楓樹窩路 1 號','coach1')").run();
  d.prepare("INSERT INTO class_schedules VALUES ('s1','c1','2026-12-12T02:30:00.000Z','2026-12-12T04:00:00.000Z',3,8,'scheduled')").run();
  d.prepare(`INSERT INTO bookings VALUES ('b1','ZP-001','u1','s1','c1','confirmed','paid','parent','陳大文','陳大文','91234567','右膝微創手術','',NULL,datetime('now'))`).run();
  d.prepare(`INSERT INTO bookings VALUES ('b2','ZP-002','u2','s1','c1','attended','paid','self',NULL,NULL,NULL,NULL,NULL,'2026-12-12 02:35:00',datetime('now'))`).run();
  d.prepare(`INSERT INTO bookings VALUES ('b3','ZP-003','u2','s1','c1','cancelled','refunded','self',NULL,NULL,NULL,NULL,NULL,NULL,datetime('now'))`).run();
  return d;
}

console.log("\n🧪 1. 名冊內容");
{
  const r = buildRoster(db(), "s1");
  ok("有班次資料", r && r.schedule.id === "s1");
  ok("導師名", r.schedule.coach_name === "靜儀導師");
  ok("學生數 = 2（排除 cancelled）", r.students.length === 2, String(r.students.length));
  const a = r.students.find((s) => s.booking_id === "b1");
  ok("代報顯示長者名（parent_name）", a.name === "陳大文", a.name);
  ok("標記子女代報", a.is_child === true);
  ok("電話", String(a.phone) === "91234567");
  ok("健康備註", a.health_notes.includes("右膝微創"));
  ok("緊急聯絡人", a.emergency_name === "陳太" && String(a.emergency_phone) === "92345678");
  ok("未簽到 checked_in=false", a.checked_in === false);
  const b = r.students.find((s) => s.booking_id === "b2");
  ok("已簽到 checked_in=true", b.checked_in === true);
  ok("自己報名 is_child=false", b.is_child === false);
  ok("已簽到人數統計", r.checked_in_count === 1, String(r.checked_in_count));
}

console.log("\n🧪 2. 邊界");
{
  ok("不存在班次 → null", buildRoster(db(), "nope") === null);
  ok("空 scheduleId → null", buildRoster(db(), "") === null);
  const d = db();
  d.prepare("DELETE FROM bookings").run();
  const r = buildRoster(d, "s1");
  ok("冇學生 → 空陣列（唔會爆）", Array.isArray(r.students) && r.students.length === 0);
}

console.log("\n🧪 3. 舊 DB 缺欄位唔會爆");
{
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, venue_name TEXT, venue_address TEXT, coach_id TEXT);
    CREATE TABLE class_schedules (id TEXT PRIMARY KEY, class_id TEXT, start_time TEXT, end_time TEXT,
      enrolled_count INTEGER, max_participants INTEGER, status TEXT);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, schedule_id TEXT, class_id TEXT,
      status TEXT, payment_status TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  d.prepare("INSERT INTO users VALUES ('u1','陳大文','91234567')").run();
  d.prepare("INSERT INTO classes VALUES ('c1','班','場地','地址',NULL)").run();
  d.prepare("INSERT INTO class_schedules VALUES ('s1','c1','2026-12-12T02:30:00.000Z','2026-12-12T04:00:00.000Z',1,8,'scheduled')").run();
  d.prepare("INSERT INTO bookings VALUES ('b1','ZP-9','u1','s1','c1','confirmed','paid',datetime('now'))").run();
  const r = buildRoster(d, "s1");
  ok("缺 medical_notes / checked_in_at 仍可出", r && r.students.length === 1 && r.students[0].health_notes === "");
}

console.log("\n🧪 4. API 與權限");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "admin-ops.js"), "utf8");
  ok("GET /roster/:scheduleId", /router\.get\("\/roster\/:scheduleId",\s*authenticateToken/.test(src));
  ok("需 admin + ops 角色", /roster\/:scheduleId",\s*authenticateToken,\s*requireAdmin,\s*requireOpsRole/.test(src));
  ok("只用服務層（唔直接寫 SQL 於 route）", /buildRoster\(getDb\(\), req\.params\.scheduleId\)/.test(src));
}

console.log("\n🧪 5. 列印頁");
{
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "roster-print.html"), "utf8");
  ok("@page A4 portrait", /@page\s*\{\s*size:\s*A4 portrait/.test(html));
  ok("邊界 12mm", /@page\s*\{[^}]*margin:\s*12mm/.test(html));
  ok("列印隱藏工具列", /@media print\{[\s\S]{0,200}\.no-print\{ display:none/.test(html));
  ok("有簽到格 ☐", /☐/.test(html));
  ok("健康備註高亮", /\.hi\{[^}]*fff7d6/.test(html));
  ok("導師簽名欄", /導師簽名/.test(html) && /實到人數/.test(html));
  ok("行不跨頁", /tr\{ page-break-inside:avoid/.test(html));
  ok("時間用 HKT 範圍（唔再用 UTC slice）", /fmtRange/.test(html) && !/slice\(11,16\)/.test(html));
  ok("用 admin bearer token 取數", /Authorization: "Bearer " \+ tok/.test(html));
}

console.log("\n🧪 6. 後台入口");
{
  const a = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "admin-ops.html"), "utf8");
  ok("課堂列表有 🖨️ 名冊", /🖨️ 名冊/.test(a) && /roster-print\.html\?sid=/.test(a));
  ok("還原清單有 💬 WhatsApp 快捷", /💬 WhatsApp/.test(a) && /wa\.me\/852/.test(a));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
