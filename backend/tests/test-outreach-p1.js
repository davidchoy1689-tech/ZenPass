#!/usr/bin/env node
/** test-outreach-p1.js — 孝親直通參數、.ics 時區、WhatsApp 核數 */
const fs = require("fs"), os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-outreach-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const root = path.join(__dirname, "../../frontend-v2");
const detail = fs.readFileSync(path.join(root, "detail.html"), "utf8");
const booking = fs.readFileSync(path.join(root, "booking.html"), "utf8");

console.log("🧪 1. 直通參數（detail.html）");
ok(/direct_sid/.test(detail), "支援 direct_sid");
ok(/autoselect/.test(detail), "支援 autoselect=1");
ok(/專為父母設計/.test(detail), "有孝親橫幅文案");
ok(/famBanner/.test(detail), "橫幅容器存在");
ok(/get\("direct_sid"\)/.test(detail) && /_free\(direct\) > 0/.test(detail), "直通鎖定該班且檢查剩餘席位");
ok(/get\("sid"\)/.test(detail), "兼容 sid 參數");

console.log("🧪 2. 預約成功頁 .ics");
ok(/api\/calendar\/schedule\.ics\?ids=/.test(booking), "成功頁用伺服器 .ics");
ok(/加到手機行事曆/.test(booking), "有加入日曆按鈕");
ok(/X-WR-TIMEZONE:Asia\/Hong_Kong/.test(fs.readFileSync(path.join(__dirname, "../src/routes/calendar.js"), "utf8")), "ICS 標明香港時區");

console.log("🧪 3. WhatsApp 快速核數");
ok(/傳送入數紙/.test(booking), "有 WhatsApp 入數紙按鈕");
ok(/85290335538/.test(booking), "用 9033 5538 客服號");
ok(/訂單編號：/.test(booking) && /已付金額：HK\$/.test(booking), "訊息含訂單編號＋金額");
ok(/encodeURIComponent\(waPayText\)/.test(booking), "訊息有編碼（換行／中文安全）");
const sample = "你好 ZenPass 客服，我已完成課堂 FPS 付款：\n訂單編號：ZP-0001\n學員姓名：陳大文\n已付金額：HK$140.00";
ok(decodeURIComponent(encodeURIComponent(sample)) === sample, "Emoji／中文／換行 round-trip");

console.log("🧪 4. .ics 實際輸出（HKT → UTC）");
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('c1','c@t.hk','教練','coach')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,venue_name,venue_address) VALUES ('cl1','c1','樂齡深層伸展','樂齡',90,140,'active','青衣楓樹窩體育館','青衣楓樹窩路 1 號')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','cl1','2026-12-12T02:00:00.000Z','2026-12-12T03:30:00.000Z',8,0,'available')").run();

const router = require("../src/routes/calendar");
const layer = router.stack.find((x) => x.route && x.route.path === "/schedule.ics");
const handler = layer.route.stack[layer.route.stack.length - 1].handle;
let out = null;
const res = {
  statusCode: 200,
  headers: {},
  status(c) { this.statusCode = c; return this; },
  setHeader(k, v) { this.headers[k] = v; },
  send(b) { out = b; },
};
handler({ query: { ids: "s1" }, headers: {} }, res);
ok(res.statusCode === 200 && typeof out === "string", "回傳 200 + 內容", res.statusCode);
ok(/DTSTART:20261212T020000Z/.test(out), "DTSTART 02:00Z（= HKT 10:00）", (out.match(/DTSTART:[^\r\n]*/) || [])[0]);
ok(/DTEND:20261212T033000Z/.test(out), "DTEND 03:30Z（90 分鐘）", (out.match(/DTEND:[^\r\n]*/) || [])[0]);
ok(/青衣楓樹窩體育館/.test(out), "含場地名稱");
ok(/text\/calendar/.test(res.headers["Content-Type"] || ""), "Content-Type 係 text/calendar");
ok(/BEGIN:VALARM/.test(out) && /TRIGGER:-PT60M/.test(out), "有上課前 60 分鐘提醒");

console.log("🧪 5. 安全");
ok(!/javascript:/i.test(detail) && !/eval\(/.test(detail), "detail 無危險 inline 執行");
ok(/slice\(0, 40\)/.test(fs.readFileSync(path.join(__dirname, "../src/routes/calendar.js"), "utf8")), "ICS 最多 40 個班次（防濫用）");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
