#!/usr/bin/env node
/**
 * 取消保留費用全數歸平台（David 2026-11-15）
 *  24–72h 取消 → 退 50%，保留 50% 入平台收入，教練 0%
 *  <24h／no-show → 100% 歸平台，教練 0%
 *  ≥72h → 全退，平台 0%
 */
const path = require("path"), os = require("os");
process.env.JWT_SECRET = "test-secret-cancelfee-0123456789-abcdef";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-cf-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const svc = require("../src/services/booking-service");

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString().replace("T", " ").slice(0, 19);

db.prepare("INSERT INTO users (id,email,name,phone,role,credits) VALUES ('u1','u1@t.hk','學生一','91110001','user',0)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('u2','u2@t.hk','學生二','91110002','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,commission_rate) VALUES ('coach','c@t.hk','教練','90000001','coach',1,0.8)").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,credits_cost,status,max_participants) VALUES ('cl','coach','伸展班','樂齡',60,140,14,'active',8)").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s48','cl',?,?,8,1,'available')").run(iso(48), iso(49.5));
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s96','cl',?,?,8,1,'available')").run(iso(96), iso(97.5));

const ins = db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,payment_method,amount,created_at)
  VALUES (?,?,?,?,'cl','confirmed','paid','single','fps',140,datetime('now'))`);
ins.run("b48", "C48", "u1", "s48");
ins.run("b96", "C96", "u2", "s96");

const call = (id, uid) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try {
    const out = svc.cancelBooking({ params: { id }, body: { reason: "test" }, user: { id: uid, role: "user" }, headers: {}, ip: "127.0.0.1" });
    if (out && typeof out.then === "function") out.then((r) => { res.statusCode = r.status; res.body = r.body; resolve(res); }).catch((e) => resolve({ statusCode: 500, body: { error: e.message } }));
    else { res.statusCode = out.status; res.body = out.body; resolve(res); }
  } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  console.log("\n🧪 24–72h 取消（48h）");
  const r1 = await call("b48", "u1");
  ok(r1.statusCode === 200, "取消成功", JSON.stringify(r1.body).slice(0, 120));
  const b1 = db.prepare("SELECT * FROM bookings WHERE id='b48'").get();
  ok(Math.round(Number(b1.cancellation_fee) * 100) === 7000, "保留 50% = $70 歸平台", b1.cancellation_fee);
  ok(b1.status === "cancelled");

  console.log("\n🧪 ≥72h 取消（96h）");
  const r2 = await call("b96", "u2");
  ok(r2.statusCode === 200, "取消成功");
  const b2 = db.prepare("SELECT * FROM bookings WHERE id='b96'").get();
  ok(Math.round(Number(b2.cancellation_fee || 0) * 100) === 0, "全退 → 平台保留 $0", b2.cancellation_fee);

  console.log("\n🧪 Credits 取消：退回 Credits，唔可以再開 FPS 現金退款");
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s48c','cl',?,?,8,1,'available')").run(iso(48), iso(49.5));
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,payment_type,amount,created_at)
    VALUES ('bcr','CCR','u1','s48c','cl','confirmed','paid','credits',140,datetime('now'))`).run();
  const rcr = await call("bcr", "u1");
  ok(rcr.statusCode === 200, "Credits 預約取消成功");
  const bcr = db.prepare("SELECT * FROM bookings WHERE id='bcr'").get();
  ok(Number(bcr.cancellation_fee || 0) === 0, "Credits 取消唔計現金取消費");
  ok(bcr.payment_status === "partial_refund" && bcr.refund_channel === "credit", "標記已退部分 Credits（扣 50%）");
  ok(db.prepare("SELECT COUNT(*) n FROM refund_logs WHERE booking_id='bcr'").get().n === 0, "冇開 FPS 退款紀錄（防雙重退款）");

  console.log("\n🧪 平台收入包含取消費、教練零分成");
  const stats = require("../src/services/admin-service").getDashboardStats().stats;
  ok(Math.round(Number(stats.total_revenue) * 100) === 7000, "平台收入 = $70（只計取消保留費）", stats.total_revenue);
  const ce = db.prepare("SELECT COUNT(*) n FROM coach_earnings").get().n;
  ok(ce === 0, "教練冇 earnings（取消唔拆帳）", String(ce));

  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
