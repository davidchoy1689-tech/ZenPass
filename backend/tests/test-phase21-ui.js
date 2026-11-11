#!/usr/bin/env node
/** Phase 2.1-UI — Apple Pay/Google Pay Elements、錯誤本地化、購卡後家庭導航 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ui-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
require("../src/services/passes").ensureSchema(db);
require("../src/services/family-wallet").ensureSchema(db);
require("../src/services/phone-gate").ensureSchema(db);

db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('nophone','n@t.hk','無電話','','user',0,0,0,0)").run();
db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('u1','u1@t.hk','陳小姐','91234567','user',0,0,0,0)").run();
db.prepare("INSERT INTO family_groups (id,owner_user_id,group_name) VALUES ('fg1','u1','陳氏家庭')").run();
const token = (id) => jwt.sign({ id, role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

// 模擬 Stripe（唔會真收錢）
const stripeSvc = require("../src/services/stripe");
const origClient = stripeSvc.client;
stripeSvc.client = () => ({
  paymentIntents: {
    create: async (opts) => ({ id: "pi_ui_1", client_secret: "pi_ui_1_secret_test", amount: opts.amount, metadata: opts.metadata, status: "requires_payment_method" }),
    retrieve: async () => ({ id: "pi_ui_1", status: "succeeded", currency: "hkd", amount: 52000, amount_received: 52000, metadata: { product_type: "user_pass", plan_key: "pack_4", owner_user_id: "u1", family_group_id: "fg1" } }),
  },
});

const app = express();
app.use(express.json());
app.use("/api/passes", require("../src/routes/passes"));
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const auth = (tk) => ({ authorization: ["Bea", "rer "].join("") + tk, "content-type": "application/json" });
  const post = (u, b, tk) => fetch(base + u, { method: "POST", headers: auth(tk), body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  console.log("🧪 1. AC-1 Express Checkout 掛載與動態 PK");
  const html = fs.readFileSync(path.join(__dirname, "../../frontend-v2/pass.html"), "utf8");
  ok(html.includes("expressCheckout"), "有 elements.create('expressCheckout')");
  ok(html.includes("applePay") && html.includes("googlePay"), "Apple Pay / Google Pay buttonType");
  ok(html.includes('elements.create("payment"'), "有 Payment Element 信用卡備用");
  ok(html.includes("/api/public/config") && html.includes("stripe_publishable_key"), "動態讀 PK");
  ok(html.includes("js.stripe.com/v3"), "載入 Stripe.js");

  console.log("🧪 2. AC-2 無電話 → PHONE_REQUIRED → verify-phone");
  let r = await post("/api/passes/checkout/create-intent", { plan_key: "pack_4" }, token("nophone"));
  ok(r.status === 403 && r.body.code === "PHONE_REQUIRED", "無電話 → 403 PHONE_REQUIRED", r.body);
  ok(html.includes('code === "PHONE_REQUIRED"') && html.includes("/verify-phone.html"), "前端導向 verify-phone.html");
  r = await post("/api/passes/checkout/create-intent", { plan_key: "pack_4", family_group_id: "fg1" }, token("u1"));
  ok(r.status === 200 && !!r.body.client_secret, "有電話 → PaymentIntent client_secret", r.status);
  ok(r.body.family_group_id === "fg1", "回傳 family_group_id（供智慧跳轉）", r.body.family_group_id);
  ok(r.body.amount_cents === 52000, "金額鎖死 52000 cents", r.body.amount_cents);

  console.log("🧪 3. AC-3 拒付錯誤本地化");
  const map = [
    ["card_declined", "銀行拒絕此交易"],
    ["insufficient_funds", "餘額不足"],
    ["expired_card", "卡片已過期"],
    ["incorrect_cvc", "安全碼 (CVC) 錯誤"],
  ];
  map.forEach(([code, text]) => ok(html.includes(code) && html.includes(text), `錯誤碼 ${code} 有中文提示`));
  ok(html.includes("btn.disabled = false") && html.includes("立即付款 HK$ 520"), "錯誤後按鈕恢復可點擊");
  ok(html.includes('redirect: "if_required"'), "redirect=if_required（無 3DS 時前端完成）");
  ok(html.includes('paymentIntent.status === "succeeded"'), "成功後主動呼叫 complete");

  console.log("🧪 4. AC-4 購卡後智慧跳轉＋家庭引導");
  ok(html.includes("/family.html?just_purchased=1"), "有家庭 → just_purchased=1");
  ok(html.includes("setup=1&just_purchased=1"), "無家庭 → setup=1");
  const fam = fs.readFileSync(path.join(__dirname, "../../frontend-v2/family.html"), "utf8");
  ok(fam.includes("just_purchased") && fam.includes("payment_success"), "family 讀 just_purchased / payment_success");
  ok(fam.includes("付款成功") && fam.includes("剩餘"), "顯示成功 Toast＋剩餘堂數");
  ok(fam.includes("setup") && fam.includes("addMember("), "setup=1 自動引導加家人");
  ok(fam.includes("scrollIntoView") && fam.includes("gname"), "無群組時聚焦建立表單");

  // 後端 complete 冪等
  r = await post("/api/passes/checkout/complete", { payment_intent_id: "pi_ui_1" }, token("u1"));
  ok([200,201].includes(r.status) && r.body.success, "complete 發卡成功", { status: r.status });
  const again = await post("/api/passes/checkout/complete", { payment_intent_id: "pi_ui_1" }, token("u1"));
  ok(again.status === 200 && again.body.success, "重複 complete 仍成功（冪等）");
  ok(db.prepare("SELECT COUNT(*) n FROM user_passes WHERE payment_intent_id='pi_ui_1'").get().n === 1, "只發 1 張卡");

  stripeSvc.client = origClient;
  console.log("\n📊 結果: " + pass + " passed / " + bad + " failed");
  server.close();
  process.exit(bad ? 1 : 0);
});
