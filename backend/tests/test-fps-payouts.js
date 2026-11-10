#!/usr/bin/env node
/** test-fps-payouts.js — 工單二十：FPS 出糧紀錄／沖抵／參考編號 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-fps-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
db.exec(`CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status TEXT, checkin_time TEXT, notes TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT)`);
for (const sql of [
  "ALTER TABLE bookings ADD COLUMN is_walkin INTEGER DEFAULT 0",
  "ALTER TABLE bookings ADD COLUMN payment_method TEXT",
  "ALTER TABLE bookings ADD COLUMN collected_by TEXT",
]) { try { db.exec(sql); } catch (e) {} }

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} } = {}) => new Promise((resolve) => {
  const res = {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; resolve(this); },
    send(o) { this.body = o; resolve(this); },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    removeHeader(k) { delete this.headers[k.toLowerCase()]; return this; },
  };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); }
  catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

const now = new Date();
const start = now.toISOString().slice(0, 19).replace("T", " ");
const month = now.toISOString().slice(0, 7);

db.prepare("INSERT INTO users (id,email,name,phone,role,commission_rate) VALUES ('cA','a@t.hk','蔡教練','98761111','coach',0.8)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('s1','s1@t.hk','陳大文','98765432','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('s2','s2@t.hk','黃伯','95550000','user')").run();
db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox) VALUES ('v1','青衣','active',0)").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,partner_venue_id,status) VALUES ('cl','cA','樂齡伸展','fitness',60,140,'v1','active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants) VALUES ('s','cl',?,?,20)").run(start, start);
db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_type,payment_status,amount) VALUES ('b1','R1','s1','s','cl','attended','single','paid',140)").run();
db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_type,payment_status,amount,is_walkin,payment_method,collected_by) VALUES ('b2','R2','s2','s','cl','attended','single','paid',140,1,'walkin_cash','coach')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a1','s','b1','陳大文','present')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('a2','s','b2','黃伯','present')").run();
db.prepare("INSERT INTO student_coach_affiliations (student_user_id,origin_coach_id) VALUES ('s1','cA')").run();

(async () => {
  console.log("🧪 1. 平台登記 FPS 出糧");
  const admin = require("../src/routes/admin-payouts");
  const disburse = handlerOf(admin, "post", "/coach-payouts/disburse");
  const r1 = await call(disburse, { user: { id: "admin1", role: "super_admin" }, body: { coach_id: "cA", month } });
  ok(r1.statusCode === 201, "201 登記成功", r1.body);
  ok(r1.body.gross_earnings_cents === 25200, "總應得 25200 cents", r1.body.gross_earnings_cents);
  ok(r1.body.offset_cash_cents === 14000, "現場沖抵 14000 cents", r1.body.offset_cash_cents);
  ok(r1.body.net_payout_cents === 11200, "實發 11200 cents", r1.body.net_payout_cents);
  ok(/^FPS-ZP-\d{6}-[A-Z0-9]{4}-\d{5}$/.test(r1.body.bank_reference_no), "參考編號格式", r1.body.bank_reference_no);

  const dup = await call(disburse, { user: { id: "admin1", role: "super_admin" }, body: { coach_id: "cA", month } });
  ok(dup.statusCode === 409 && dup.body.code === "DUPLICATE", "同月重複 → 409", dup.body);

  console.log("🧪 2. 教練查閱出糧紀錄");
  const cr = require("../src/routes/coach-earnings");
  const list = handlerOf(cr, "get", "/earnings/payouts");
  const l1 = await call(list, { user: { id: "cA", role: "coach" } });
  ok(l1.statusCode === 200 && l1.body.data.length === 1, "1 筆紀錄", l1.body);
  const p = l1.body.data[0];
  ok(p.net_payout_hkd === "112.00" && p.offset_cash_hkd === "140.00", "金額字串正確", p);
  ok(p.fps_proxy_masked === "9876****", "FPS Proxy 有遮罩", p.fps_proxy_masked);
  ok(p.status === "cleared", "狀態 cleared");
  ok(p.bank_reference_no === r1.body.bank_reference_no, "編號一致");

  console.log("🧪 3. 失敗狀態 + 審計");
  const patch = handlerOf(admin, "patch", "/coach-payouts/:id");
  const pr = await call(patch, { user: { id: "admin1", role: "super_admin" }, params: { id: r1.body.id }, body: { status: "failed", reason: "FPS 號碼未開通" } });
  ok(pr.statusCode === 200 && pr.body.status === "failed", "可標記 failed", pr.body);
  const l2 = await call(list, { user: { id: "cA", role: "coach" } });
  ok(l2.body.data[0].status === "failed" && /未開通/.test(l2.body.data[0].failure_reason), "教練見到失敗原因");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='payout.status_changed'").get(), "有狀態審計");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE action_type='payout.disbursed'").get(), "有發放審計");

  console.log("🧪 4. CSV 抬頭帶參考編號");
  const { buildEarningsCsv } = cr;
  const csv = buildEarningsCsv(db, "cA", month);
  ok(csv.includes("FPS 交易參考編號"), "CSV 有 FPS 參考編號欄");
  ok(csv.includes(r1.body.bank_reference_no), "CSV 有正確編號");

  console.log("🧪 4b. 風控解凍預排 pending → 正式出糧完成同一筆");
  const disbSvc = require("../src/services/payout-disbursements");
  const oldId = r1.body.id;
  db.prepare("DELETE FROM coach_payout_disbursements WHERE id=?").run(oldId);
  const pre = disbSvc.record(db, {
    coachId: "cA",
    month,
    grossCents: 25200,
    offsetCents: 14000,
    netCents: 11200,
    proxyId: "98761111",
    status: "pending",
  });
  const preRow = db.prepare("SELECT * FROM coach_payout_disbursements WHERE id=?").get(pre.id);
  ok(preRow.status === "pending", "預排記錄為 pending");
  const d2 = await call(disburse, { user: { id: "admin1", role: "super_admin" }, body: { coach_id: "cA", month } });
  ok(d2.statusCode === 201 && d2.body.id === pre.id, "正式登記完成同一筆（唔會 409）", d2.body);
  const after = db.prepare("SELECT * FROM coach_payout_disbursements WHERE id=?").get(pre.id);
  ok(after.status === "cleared" && after.bank_reference_no === pre.bank_reference_no, "狀態 cleared、編號沿用");
  ok(db.prepare("SELECT COUNT(*) c FROM coach_payout_disbursements WHERE coach_id='cA' AND payout_month=?").get(month).c === 1, "同月仍然只有一筆");

  console.log("🧪 5. 前端與路由");
  const fs = require("fs");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-earnings.html"), "utf8");
  ok(/官方發放歷史/.test(page) && /FPS 出糧記錄/.test(page), "有出糧歷史模組");
  ok(/data-copyref/.test(page) && /複製/.test(page), "有複製參考編號");
  ok(/入數單/.test(page) && /\.print\(/.test(page), "有入數單列印");
  ok(/earnings\/payouts/.test(page), "前端接 API");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/routes\/admin-payouts/.test(idx), "admin-payouts 已掛載");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
