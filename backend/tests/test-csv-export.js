#!/usr/bin/env node
/**
 * test-csv-export.js — 工單十七（CSV 對數單）
 *  UTF-8 BOM、RFC 4180 逸出、區段欄數對齊、HTTP headers
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-csv-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase();
updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const affiliate = require("../src/services/coach-affiliate");
const { syncCoachEarningsForSchedule, buildEarningsCsv } = require("../src/routes/coach-earnings");

db.exec(`CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, booking_id TEXT NOT NULL,
  student_name TEXT NOT NULL, status TEXT NOT NULL, checkin_time TEXT, notes TEXT,
  updated_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};

function mkUser(id, name, role, phone) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,commission_rate) VALUES (?,?,?,?,?,0.8)").run(id, `${id}@t.hk`, name, phone, role);
}
function mkVenue(id) {
  db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox) VALUES (?,?, 'active', 0)").run(id, "青衣楓樹窩體育館");
}
function mkClass(id, coach, title, vid) {
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,partner_venue_id,status) VALUES (?,?,?,?,?,140,?,'active')").run(id, coach, title, "fitness", 60, vid);
}
function mkSched(id, cid, start) {
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants) VALUES (?,?,?,?,20)").run(id, cid, start, start);
}
function mkBooking(id, uid, sid, cid, amount) {
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_type,payment_status,amount) VALUES (?,?,?,?,?,'attended','single','paid',?)").run(id, "R" + id, uid, sid, cid, amount);
}

const now = new Date();
const start = now.toISOString().slice(0, 19).replace("T", " ");
const month = now.toISOString().slice(0, 7);

mkUser("coachA", "蔡教練", "coach", "91111111");
mkUser("coachB", "黃 Sir", "coach", "92222222");
mkUser("s1", "陳大文", "user", "98765432");
mkVenue("v1");
mkClass("cA", "coachA", '樂齡深層伸展, "週末班"', "v1");
mkClass("cB", "coachB", "水中健體活力班（何文田）", "v1");
mkSched("sA", "cA", start);
mkSched("sB", "cB", start);
mkBooking("b1", "s1", "sA", "cA", 140);
mkBooking("b2", "s1", "sB", "cB", 140);
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a1','sA','b1','陳大文','present')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a2','sB','b2','陳大文','present')").run();
affiliate.bindStudent(db, "s1", "coachA");
syncCoachEarningsForSchedule("sA");
syncCoachEarningsForSchedule("sB");
db.prepare("UPDATE coach_affiliate_payouts SET cleared_at='2026-12-14 03:30:00' WHERE booking_id='b2'").run();

console.log("🧪 1. BOM 與 Buffer 前 3 bytes");
const csv = buildEarningsCsv(db, "coachA", month);
ok(csv.charCodeAt(0) === 0xfeff, "字串第一個字元係 U+FEFF");
const buf = Buffer.from(csv, "utf8");
ok(buf.slice(0, 3).toString("hex").toUpperCase() === "EFBBBF", "Buffer 前 3 bytes = EF BB BF", buf.slice(0, 3).toString("hex"));

console.log("🧪 2. RFC 4180 逸出");
ok(csv.includes('"樂齡深層伸展, ""週末班"""'), "逗號＋引號正確封裝轉義", csv.split("\r\n").find((l) => l.includes("樂齡")));
ok(/"HK\$ 140\.00"/.test(csv), "金額有引號（含逗號/符號安全）");

console.log("🧪 3. 區段欄數對齊");
// RFC 4180 欄位計數器（處理 "" 轉義）
function countFields(line) {
  let n = 1, inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') i++;
      else if (c === '"') inQ = false;
    } else if (c === '"') inQ = true;
    else if (c === ",") n++;
  }
  return { n, balanced: !inQ };
}
const lines = csv.slice(1).split("\r\n").filter((l) => l !== "");
const iSess = lines.findIndex((l) => l.includes("執教課堂明細"));
const iAff = lines.findIndex((l) => l.includes("跨界 5% 被動分佣明細"));
const sessLines = lines.slice(iSess, iAff - 1);
const affLines = lines.slice(iAff);
const sessCounts = sessLines.map(countFields);
const affCounts = affLines.map(countFields);
ok(sessCounts.slice(1).every((x) => x.n === 7), "執教區段每行 7 欄（含合計）", sessCounts.map((x) => x.n));
ok(affCounts.slice(1).every((x) => x.n === 8), "跨界區段每行 8 欄（含小計）", affCounts.map((x) => x.n));
ok([...sessCounts, ...affCounts].every((x) => x.balanced), "冇未閉合引號");

console.log("🧪 4. 內容正確");
ok(csv.includes("蔡教練") && csv.includes("coachA"), "有教練姓名＋編號");
ok(csv.includes("自有學生100%"), "自有學生班次標示 100%");
ok(csv.includes("陳*文") && csv.includes("9876****"), "學員識別有遮罩＋電話");
ok(csv.includes("黃 Sir") && csv.includes("水中健體活力班（何文田）"), "跨界課程＋帶班導師");
ok(csv.includes("2026-12-14 03:30"), "入帳時間格式正確");
ok(csv.split("\r\n").every((l) => !l.includes("undefined") && !l.includes("null")), "冇 undefined/null 字串");

console.log("🧪 5. HTTP headers");
const router = require("../src/routes/coach-earnings");
const h = handlerOf(router, "get", "/earnings/export-csv");
const headers = {};
let body = null;
const res = {
  statusCode: 200,
  setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
  removeHeader(k) { delete headers[k.toLowerCase()]; return this; },
  status(c) { this.statusCode = c; return this; },
  send(b) { body = b; return this; },
  json(o) { body = o; return this; },
};
h({ query: { month }, user: { id: "coachA", role: "coach" }, headers: {}, cookies: {} }, res);
ok(res.statusCode === 200, "HTTP 200");
ok(headers["content-type"] === "text/csv; charset=utf-8", "Content-Type 正確", headers["content-type"]);
ok(/ZenPass_Monthly_Earnings_2026|ZenPass_Monthly_Earnings_\d{4}-\d{2}/.test(headers["content-disposition"] || ""), "檔名帶月份", headers["content-disposition"]);
ok(headers["content-disposition"].includes("coachA"), "檔名帶教練 ID");
ok(headers["cache-control"] === "no-cache, no-store, must-revalidate", "Cache-Control 正確");
ok(body && body.charCodeAt(0) === 0xfeff, "回應 Body 有 BOM");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
