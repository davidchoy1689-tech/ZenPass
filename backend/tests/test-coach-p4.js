#!/usr/bin/env node
/** test-coach-p4.js — 沙盒 PLI 豁免、UTM 歸因、種子資料冪等 */
const os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const DB = path.join(os.tmpdir(), "zenpass-p4-" + Date.now() + ".db");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = DB;
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const S = "2026-12-20T02:30:00.000Z", E = "2026-12-20T04:00:00.000Z";

db.prepare("INSERT INTO users (id,email,name,role) VALUES ('adm','a@t.hk','管理員','platform_manager')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('ca','ca@t.hk','原教練','coach')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('cb','cb@t.hk','代堂教練','coach')").run();
for (const [col, ddl] of [["is_sandbox", "is_sandbox INTEGER DEFAULT 0"], ["pli_status", "pli_status TEXT DEFAULT 'unverified'"], ["pli_expiry", "pli_expiry TEXT"]]) {
  try { db.exec(`ALTER TABLE partner_venues ADD COLUMN ${ddl}`); } catch (e) {}
}
db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox,pli_status) VALUES ('vs','沙盒館','active',1,'unverified')").run();
db.prepare("INSERT INTO partner_venues (id,name,status,is_sandbox,pli_status) VALUES ('vr','真實館','active',0,'unverified')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,partner_venue_id) VALUES ('c1','ca','芬蘭木柱','新興運動',90,200,'active','vs')").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,partner_venue_id) VALUES ('c2','ca','地板冰壺','新興運動',90,200,'active','vr')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,10,0,'available')").run(S, E);
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c2',?,?,10,0,'available')").run(S, E);
db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
  id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT, license_expiry TEXT,
  first_aid_type TEXT, first_aid_expiry TEXT, doc_url TEXT, certificate_url TEXT,
  insurance_policy_url TEXT, insurance_expiry_date TEXT, is_starred INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', reviewer_id TEXT, created_at TEXT DEFAULT (datetime('now')))`);
db.prepare("INSERT INTO coach_credentials (id,user_id,license_type,license_expiry,insurance_expiry_date,status) VALUES ('cc','cb','一級教練','2027-12-31','2027-06-30','verified')").run();
db.exec(`CREATE TABLE IF NOT EXISTS coach_substitution_requests (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, from_coach_id TEXT NOT NULL, target_coach_id TEXT NOT NULL,
  reason TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT, reviewed_by TEXT, review_note TEXT)`);
db.prepare("INSERT INTO coach_substitution_requests (id,session_id,from_coach_id,target_coach_id,status) VALUES ('r1','s1','ca','cb','pending')").run();
db.prepare("INSERT INTO coach_substitution_requests (id,session_id,from_coach_id,target_coach_id,status) VALUES ('r2','s2','ca','cb','pending')").run();
try {
  db.prepare("INSERT INTO platform_settings (key,value) VALUES ('venue.pli_gate','enforce') ON CONFLICT(key) DO UPDATE SET value='enforce'").run();
} catch (e) { db.exec("CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT)"); db.prepare("INSERT OR REPLACE INTO platform_settings (key,value) VALUES ('venue.pli_gate','enforce')").run(); }

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/admin-substitutes");
  const pending = handlerOf(router, "get", "/substitutes/pending");
  const approve = handlerOf(router, "post", "/substitutes/:id/approve");
  const admin = { id: "adm", role: "platform_manager" };

  console.log("🧪 1. enforce 模式下沙盒場地豁免");
  const list = await call(pending, { user: admin });
  const it1 = list.body.items.find((x) => x.id === "r1");
  ok(it1 && it1.eligible === true, "沙盒場地 → eligible", JSON.stringify(it1 && it1.blockers));
  ok((it1.warnings || []).some((w) => w.includes("豁免 PLI")), "有「測試環境豁免 PLI」警告");
  const ap1 = await call(approve, { user: admin, params: { id: "r1" } });
  ok(ap1.statusCode === 200 && /豁免 PLI/.test(ap1.body.warning || ""), "核准成功並回傳豁免警告", ap1.body.error);
  ok(db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s1'").get().coach_override_id === "cb", "班次已轉代堂教練");

  console.log("🧪 2. enforce 模式下真實場地硬擋");
  const it2 = (await call(pending, { user: admin })).body.items.find((x) => x.id === "r2");
  ok(it2 && it2.eligible === false && it2.blockers.some((b) => b.includes("PLI 未核實")), "未核實真實場地 → blocker");
  const ap2 = await call(approve, { user: admin, params: { id: "r2" } });
  ok(ap2.statusCode === 409, "核准被拒 409", ap2.statusCode);
  ok(!db.prepare("SELECT coach_override_id FROM class_schedules WHERE id='s2'").get().coach_override_id, "真實場地導師不變");

  console.log("🧪 3. 審計");
  const types = db.prepare("SELECT action_type FROM audit_log").all().map((x) => x.action_type);
  ok(types.includes("pli_warning_bypassed"), "有 pli_warning_bypassed 審計");
  ok(types.includes("coach.substitute_approved"), "有 coach.substitute_approved 審計");

  console.log("🧪 4. UTM 清洗與歸因");
  const { clean, recordAttribution } = require("../src/services/attribution");
  ok(clean("family_outreach") === "family_outreach", "正常 utm_source 通過");
  ok(clean("seed_dec12") === "seed_dec12", "底線數字通過");
  ok(clean("<script>alert(1)</script>") === null, "HTML／腳本被拒");
  ok(clean("a".repeat(41)) === null, "超長被拒");
  ok(clean("") === null, "空值回 null");
  db.prepare("INSERT INTO bookings (id,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','ca','s1','c1','confirmed','paid',200)").run();
  const n = recordAttribution(db, "b1", "family_outreach", "seed_dec12");
  ok(n === 1, "寫入 1 筆歸因");
  const row = db.prepare("SELECT utm_source, utm_campaign FROM bookings WHERE id='b1'").get();
  ok(row.utm_source === "family_outreach" && row.utm_campaign === "seed_dec12", "UTM 已存");
  recordAttribution(db, ["b1"], "other_src", "other_camp");
  ok(db.prepare("SELECT utm_source FROM bookings WHERE id='b1'").get().utm_source === "family_outreach", "首次歸因不被覆寫");

  console.log("🧪 5. 種子腳本（冪等）");
  const env = Object.assign({}, process.env, { DB_PATH: DB });
  const runSeed = () => execFileSync(process.execPath, [path.join(__dirname, "../scripts/seed-coach-sandbox.js"), "--coach-email", "ca@t.hk"], { env, encoding: "utf8" });
  const o1 = runSeed();
  ok(/沙盒演練資料就緒/.test(o1), "第一次執行成功");
  runSeed();
  const cnt = (t, w) => db.prepare(`SELECT COUNT(*) c FROM ${t} ${w || ""}`).get().c;
  ok(cnt("partner_venues", "WHERE id='seed-sandbox-venue'") === 1, "場地唯一");
  ok(cnt("classes", "WHERE id='seed-sandbox-class'") === 1, "課程唯一");
  ok(cnt("class_schedules", "WHERE id='seed-sandbox-session'") === 1, "班次唯一");
  ok(cnt("bookings", "WHERE id LIKE 'seed-sandbox-bk-%'") === 2, "2 筆演練預約");
  ok(cnt("users", "WHERE id LIKE 'seed-sandbox-%'") === 3, "3 個演練帳號（A/B/Sarah）");
  ok(cnt("coach_substitution_requests", "WHERE id='seed-sandbox-subreq-1'") === 1, "代堂申請唯一");
  const sess = db.prepare("SELECT start_time,end_time FROM class_schedules WHERE id='seed-sandbox-session'").get();
  ok(/Z$/.test(sess.start_time) && /Z$/.test(sess.end_time), "時間用 ISO Z（與生產一致）", sess.start_time);
  ok(Math.abs(new Date(sess.start_time).getTime() - Date.now()) < 2 * 3600e3, "班次時間喺現在 ±2 小時內");
  ok(db.prepare("SELECT is_sandbox FROM partner_venues WHERE id='seed-sandbox-venue'").get().is_sandbox === 1, "場地標記 is_sandbox");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
