#!/usr/bin/env node
/** Phase 2.1 — 4 堂 Pass 線上購買／自動發卡 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-passcheckout-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const { getDb } = require("../src/services/database");
const passes = require("../src/services/passes");
const fw = require("../src/services/family-wallet");
const db = getDb();
passes.ensureSchema(db);
fw.ensureSchema(db);

db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('daughter','d@t.hk','陳小姐','60002001','user')").run();
db.prepare("INSERT INTO users (id,email,name,phone,role) VALUES ('father','f@t.hk','陳大文','60002002','user')").run();
db.prepare("INSERT INTO family_groups (id,owner_user_id,group_name) VALUES ('fg1','daughter','陳氏家庭')").run();
db.prepare("INSERT INTO family_members (id,family_group_id,member_user_id,relation_title,can_consume_pass) VALUES ('fm1','fg1','father','father',1)").run();

console.log("🧪 1. 方案與金額");
ok(passes.PASS_PLANS.pack_4.price_cents === 52000 && passes.PASS_PLANS.pack_4.units === 4, "4 堂 = HK$520 / 52000 cents");
ok(passes.PASS_PLANS.pack_4.valid_days === 60, "4 堂有效期 60 天");
ok(passes.PASS_PLANS.pack_8.price_cents === 96000 && passes.PASS_PLANS.pack_8.units === 8, "8 堂 = HK$960 / 8 堂");
ok(passes.resolvePlan("pack_4_pain_relief").id === "pack_4", "規格 key pack_4_pain_relief 可解析");
ok(passes.resolvePlan("pack_8_pain_relief").price_cents === 96000, "規格 key pack_8_pain_relief 可解析");

console.log("🧪 2. 付款成功自動發卡");
const r1 = passes.fulfillPassPurchase(db, {
  userId: "daughter",
  planId: "pack_4",
  familyGroupId: "fg1",
  paymentIntentId: "pi_test_phase21_001",
});
ok(r1.ok && !r1.duplicated, "首次發卡成功");
const row = db.prepare("SELECT * FROM user_passes WHERE payment_intent_id=?").get("pi_test_phase21_001");
ok(row && Number(row.total_credits) === 4 && Number(row.remaining_credits) === 4, "Pass 4 堂全額入賬");
ok(Number(row.price_paid) === 520, "實付 HK$520 記錄正確");
ok(row.family_group_id === "fg1" && row.owner_user_id === "daughter", "自動綁定家庭群組與付款人");
ok(row.pass_type === "pack_4" && row.notes === "online:pack_4", "Pass 類型與來源正確");

console.log("🧪 3. Webhook / 回跳重複處理");
const r2 = passes.fulfillPassPurchase(db, {
  userId: "daughter",
  planId: "pack_4",
  familyGroupId: "fg1",
  paymentIntentId: "pi_test_phase21_001",
});
ok(r2.ok && r2.duplicated, "同一 payment intent 重複呼叫 → 回傳原卡");
ok(db.prepare("SELECT COUNT(*) c FROM user_passes WHERE payment_intent_id=?").get("pi_test_phase21_001").c === 1, "只會有一張 Pass");

console.log("🧪 4. 家庭扣堂連動");
const applicable = fw.findApplicablePass(db, "father");
ok(applicable && applicable.source === "family" && applicable.pass.id === row.id, "父親可扣女兒家庭 Pass", applicable && applicable.source);
const badge = fw.describePass(db, "father", row.id);
ok(badge.pass_type === "family" && badge.display_badge.includes("陳小姐") && badge.remaining_units === 4, "Roster badge 正確");

console.log("🧪 5. 安全與錯誤處理");
const badPlan = passes.fulfillPassPurchase(db, { userId: "daughter", planId: "hack", paymentIntentId: "pi_x" });
ok(!badPlan.ok && badPlan.error === "PASS_PLAN_INVALID", "無效方案拒絕");
const badOwner = passes.fulfillPassPurchase(db, { userId: "father", planId: "pack_4", familyGroupId: "fg1", paymentIntentId: "pi_y" });
ok(!badOwner.ok && badOwner.error === "FAMILY_OWNER_MISMATCH", "非付款人不可用他人家庭群組");
const noFriend = passes.fulfillPassPurchase(db, { userId: "father", planId: "pack_4", paymentIntentId: "pi_z" });
ok(noFriend.ok, "個人 Pass 可獨立購買");
ok(!noFriend.pass.family_group_id, "個人 Pass 不會綁家庭");

console.log("🧪 5b. FPS 備用通路");
const fps = passes.fulfillPassPurchase(db, { userId: "daughter", planId: "pack_4", familyGroupId: "fg1", paymentIntentId: "fps_order_1" });
ok(fps.ok && fps.pass.family_group_id === "fg1", "FPS 確認後用同一函數發家庭 Pass");
const fps2 = passes.fulfillPassPurchase(db, { userId: "daughter", planId: "pack_4", familyGroupId: "fg1", paymentIntentId: "fps_order_1" });
ok(fps2.ok && fps2.duplicated, "FPS 重複確認不會重複發卡");

console.log("🧪 6. API / Webhook / 前端接線");
const fs = require("fs");
const route = fs.readFileSync(path.join(__dirname, "../src/routes/passes.js"), "utf8");
ok(/create-checkout/.test(route) && /complete-checkout/.test(route), "Pass 購買 API 已存在");
ok(/session\.payment_status !== "paid"/.test(route), "回跳會驗證 Stripe 已付款");
ok(/session\.amount_total\) !== plan\.price_cents/.test(route), "會驗證實付金額");
ok(/fps-order/.test(route) && /admin\/orders\/:id\/confirm/.test(route), "FPS 落單／後台確認 API 已存在");
ok(/checkout\/create-intent/.test(route) && /checkout\/complete/.test(route), "規格 PaymentIntent 端點已存在");
ok(/automatic_payment_methods/.test(route), "PaymentIntent 啟用 Apple Pay／自動支付方式");
const pay = fs.readFileSync(path.join(__dirname, "../src/routes/payments.js"), "utf8");
ok(/pass_purchase/.test(pay) && /fulfillPassPurchase/.test(pay), "Stripe webhook 會自動發卡");
ok(/payment_intent\.succeeded/.test(pay) && /product_type === "user_pass"/.test(pay), "PaymentIntent webhook 會自動發卡");
const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/pass.html"), "utf8");
ok(/4 堂全家健康通行 Pass/.test(page) && /HK\$520/.test(page), "pass.html 有 4 堂 $520 購卡卡");
ok(/passes\/create-checkout/.test(page) && /passes\/complete-checkout/.test(page), "前端接建立付款與回跳發卡");
ok(/fps-order/.test(page) && /轉數快 FPS/.test(page), "前端有 FPS 備用通路");
const admin = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
ok(/loadPassOrders/.test(admin) && /passes\/admin\/orders/.test(admin), "後台有 FPS 購卡待確認面板");
const fam = fs.readFileSync(path.join(__dirname, "../../frontend-v2/family.html"), "utf8");
ok(/購買 4 堂 Pass/.test(fam) && /pass\.html\?group=/.test(fam), "家庭頁有快速購卡 CTA");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
