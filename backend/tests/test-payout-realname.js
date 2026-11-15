#!/usr/bin/env node
/**
 * 出糧實名制（2026-11-16 David）
 *  - 教練未登記收款戶口 → 唔可以提款／平台唔可以出糧
 *  - 收款人姓名必須與教練登記姓名一致
 */
const path = require("path"), os = require("os");
process.env.JWT_SECRET = "payout-realname-test-secret-0123456789";
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-rn-" + Date.now() + ".db");

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
const ps = require("../src/services/payout-settings");

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

try { db.exec("ALTER TABLE users ADD COLUMN stripe_account_id TEXT"); } catch (e) {}
db.prepare("INSERT INTO users (id,email,name,role,is_coach,commission_rate,wallet_balance) VALUES ('coach','c@t.hk','Chan Tai Man','coach',1,0.8,500)").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {} }) => new Promise((resolve) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, headers: {}, ip: "127.0.0.1", query: {} }, res); } catch (e) { resolve({ code: 500, body: { error: e.message } }); }
});

(async () => {
  const adminPayouts = require("../src/routes/admin-payouts");
  const disburse = handlerOf(adminPayouts, "post", "/coach-payouts/disburse");
  const earnings = require("../src/routes/coach-earnings");
  const request = handlerOf(earnings, "post", "/payouts/request");

  console.log("\n🧪 1. 未登記戶口 → 擋");
  ps.ensureSchema(db);
  let r = await call(disburse, { user: { id: "admin1", role: "super_admin" }, body: { coach_id: "coach", month: "2026-11" } });
  ok(r.code === 400 && r.body.code === "BANK_REQUIRED", "後台出糧擋（BANK_REQUIRED）", JSON.stringify(r.body));

  db.prepare("UPDATE users SET wallet_balance=500 WHERE id='coach'").run();
  r = await call(request, { user: { id: "coach", role: "coach" }, body: { amount: 100 } });
  ok(r.code === 400 && r.body.code === "BANK_REQUIRED", "教練提款擋（BANK_REQUIRED）", JSON.stringify(r.body));

  console.log("\n🧪 2. 姓名不一致 → 擋");
  db.prepare(
    `INSERT INTO coach_payout_settings (coach_id, fps_type, fps_proxy_value, bank_code, account_holder_name, verified_at)
     VALUES ('coach','mobile','91234567','004','LEE SIU MING',datetime('now'))`,
  ).run();
  r = await call(disburse, { user: { id: "admin1", role: "super_admin" }, body: { coach_id: "coach", month: "2026-11" } });
  ok(r.code === 400 && r.body.code === "NAME_MISMATCH", "姓名不符 → NAME_MISMATCH", JSON.stringify(r.body));

  console.log("\n🧪 3. 姓名一致 → 通過實名檢查");
  db.prepare("UPDATE coach_payout_settings SET account_holder_name='CHAN TAI MAN' WHERE coach_id='coach'").run();
  r = await call(disburse, { user: { id: "admin1", role: "super_admin" }, body: { coach_id: "coach", month: "2026-11" } });
  ok(!(r.body && r.body.code === "BANK_REQUIRED"), "唔再係 BANK_REQUIRED", JSON.stringify(r.body).slice(0, 120));
  ok(!(r.body && r.body.code === "NAME_MISMATCH"), "唔再係 NAME_MISMATCH");

  console.log("\n🧪 4. 設定服務本身都會驗名");
  const svcSrc = require("fs").readFileSync(path.join(__dirname, "..", "src", "services", "payout-settings.js"), "utf8");
  ok(svcSrc.includes("NAME_MISMATCH"), "validateAndUpdate 有實名比對");

  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
