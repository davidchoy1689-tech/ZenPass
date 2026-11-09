#!/usr/bin/env node
/** test-coach-p5.js — 首發看板、沙盒重設、月結排除沙盒 */
const os = require("os"), path = require("path");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-p5-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const S = "2026-12-12T02:00:00.000Z", E = "2026-12-12T03:30:00.000Z";

const addCol = (t, col, ddl) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); } catch (e) {} };
addCol("partner_venues", "is_sandbox", "is_sandbox INTEGER DEFAULT 0");
db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_expiry TEXT, insurance_expiry_date TEXT, status TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS attendances (id TEXT PRIMARY KEY, session_id TEXT, booking_id TEXT, student_name TEXT, status TEXT, created_at TEXT, updated_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS coach_handbooks (id TEXT PRIMARY KEY, coach_id TEXT, schedule_id TEXT, booking_id TEXT, student_id TEXT, comment TEXT, photos TEXT, sha256 TEXT, block_id TEXT, created_at TEXT, updated_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS handbook_replies (id TEXT PRIMARY KEY, handbook_id TEXT, author_id TEXT, author_role TEXT, author_name TEXT, content TEXT, created_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS coach_substitution_requests (id TEXT PRIMARY KEY, session_id TEXT, from_coach_id TEXT, target_coach_id TEXT, reason TEXT, status TEXT DEFAULT 'pending', created_at TEXT, reviewed_at TEXT, reviewed_by TEXT, review_note TEXT)`);
addCol("bookings", "checked_in_at", "checked_in_at TEXT");
addCol("bookings", "cancel_reason", "cancel_reason TEXT");

db.prepare("INSERT INTO users (id,email,name,role) VALUES ('adm','a@t.hk','管理員','platform_manager')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('coach','c@t.hk','教練','coach')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('u1','u1@t.hk','學員一','user')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('u2','u2@t.hk','學員二','user')").run();
db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox) VALUES ('vreal','真場','active',0)").run();
db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox) VALUES ('vsand','沙盒場','active',1)").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,partner_venue_id,venue_name) VALUES ('creal','coach','真實班','新興運動',90,140,'active','vreal','真場')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,partner_venue_id,venue_name) VALUES ('csand','coach','演練班','新興運動',90,140,'inactive','vsand','沙盒場')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('sreal','creal',?,?,4,2,'available')").run(S, E);
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('seed-sandbox-session','csand',?,?,8,1,'available')").run(S, E);
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,amount,utm_source,utm_campaign) VALUES ('b1','u1','sreal','creal','confirmed','paid',140,'family_outreach','seed_dec12')").run();
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b2','u2','sreal','creal','confirmed','paid',140)").run();
db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('bs1','u1','seed-sandbox-session','csand','attended','paid',140)").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('at1','seed-sandbox-session','bs1','陳大文','present')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('at2','sreal','b1','學員一','present')").run();
db.prepare("INSERT INTO attendances (id,session_id,booking_id,student_name,status) VALUES ('at3','sreal','b2','學員二','present')").run();
db.prepare("INSERT INTO coach_handbooks (id,coach_id,schedule_id,booking_id) VALUES ('hb1','coach','seed-sandbox-session','bs1')").run();
db.prepare("INSERT INTO handbook_replies (id,handbook_id,content) VALUES ('rp1','hb1','多謝教練')").run();
db.prepare("INSERT INTO coach_substitution_requests (id,session_id,from_coach_id,target_coach_id,status) VALUES ('seed-sandbox-subreq-1','seed-sandbox-session','coach','x','approved')").run();
db.prepare("UPDATE class_schedules SET coach_override_id='x', enrolled_count=1 WHERE id='seed-sandbox-session'").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  console.log("🧪 1. 月結排除沙盒");
  const { buildMonthlyBreakdown } = require("../src/routes/coach-earnings");
  const m = buildMonthlyBreakdown(db, "coach", "2026-12");
  ok(m.total_sessions === 1, "只計 1 個正式班次", m.total_sessions);
  ok(m.sessions_breakdown[0].session_id === "sreal", "沙盒班次唔會出現", m.sessions_breakdown.map((x) => x.session_id).join(","));
  ok(m.total_earned === 224, "收入 2×$140×80% = $224", m.total_earned);

  console.log("🧪 2. 首發看板");
  const trackerRouter = require("../src/routes/admin-launch-tracker");
  const tracker = handlerOf(trackerRouter, "get", "/launch-tracker");
  const tr = await call(tracker, { user: { id: "adm", role: "platform_manager" }, query: { date: "2026-12-12" } });
  ok(tr.statusCode === 200 && tr.body.success, "200 OK", tr.statusCode);
  ok(tr.body.sessions.length === 1 && tr.body.sessions[0].session_id === "sreal", "沙盒班次被排除");
  ok(tr.body.summary.total_enrolled === 2, "售出 2 席", tr.body.summary.total_enrolled);
  ok(tr.body.summary.total_gross_hkd === 280, "預售 HK$280", tr.body.summary.total_gross_hkd);
  ok(tr.body.sessions[0].utm_breakdown.family_outreach === 1, "family_outreach = 1", JSON.stringify(tr.body.sessions[0].utm_breakdown));
  ok(tr.body.sessions[0].utm_breakdown.direct === 1, "direct = 1");
  ok(tr.body.summary.overall_occupancy === "50%", "滿座率 50%", tr.body.summary.overall_occupancy);

  console.log("🧪 3. 教練重設沙盒");
  const sbRouter = require("../src/routes/coach-sandbox");
  const reset = handlerOf(sbRouter, "post", "/sandbox/reset");
  const denied = await call(reset, { user: { id: "u1", role: "user" }, body: { session_id: "seed-sandbox-session" } });
  ok(denied.statusCode === 403, "非本人 → 403", denied.statusCode);
  const notSandbox = await call(reset, { user: { id: "coach", role: "coach" }, body: { session_id: "sreal" } });
  ok(notSandbox.statusCode === 403, "非沙盒班次 → 403", notSandbox.statusCode);

  const r1 = await call(reset, { user: { id: "coach", role: "coach" }, body: { session_id: "seed-sandbox-session" } });
  ok(r1.statusCode === 200 && r1.body.success, "重設成功", r1.body.error);
  const bk = db.prepare("SELECT status, checked_in_at FROM bookings WHERE id='bs1'").get();
  ok(bk.status === "confirmed" && !bk.checked_in_at, "預約回到未簽到");
  ok(db.prepare("SELECT COUNT(*) c FROM attendances WHERE session_id='seed-sandbox-session'").get().c === 0, "點名紀錄已清");
  ok(db.prepare("SELECT COUNT(*) c FROM coach_handbooks").get().c === 0, "手冊已清");
  ok(db.prepare("SELECT COUNT(*) c FROM handbook_replies").get().c === 0, "回覆已清");
  ok(db.prepare("SELECT status FROM coach_substitution_requests WHERE id='seed-sandbox-subreq-1'").get().status === "pending", "代堂申請回到 pending");
  ok(!db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='seed-sandbox-session'").get().coach_override_id, "導師 override 已清");

  console.log("🧪 4. 冪等");
  const r2 = await call(reset, { user: { id: "coach", role: "coach" }, body: { session_id: "seed-sandbox-session" } });
  ok(r2.statusCode === 200, "第二次重設唔會報錯", r2.body.error);

  console.log("🧪 5. 路由安全");
  ok(!!tracker && !!reset, "兩個 handler 存在");
  ok(trackerRouter.stack[0].route, "tracker router 第一層係 route（冇全局 middleware）");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
