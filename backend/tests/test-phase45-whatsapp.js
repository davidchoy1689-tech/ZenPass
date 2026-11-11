#!/usr/bin/env node
/**
 * Phase 4.5 — WhatsApp Business Cloud API 對接
 * - 香港電話清洗（8 位 → 852xxxxxxxx）
 * - Meta 模板訊息（T-24h / T-2h / 流標退款）
 * - Webhook 驗證握手 + 送達回執回寫
 * - notification-worker 優先模板、失敗退文字
 */
process.env.JWT_SECRET = "***".repeat(64);
process.env.WHATSAPP_TOKEN = "EAAG_test_token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_APP_SECRET = "appsecret_test";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "zenpass_meta_webhook_secret_2026";

const os = require("os");
const path = require("path");
const crypto = require("crypto");

process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-wa-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { bad++; console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)); }
};

const { getDb } = require("../src/services/database");
const db = getDb();
const wa = require("../src/services/whatsapp-cloud");
const quorum = require("../src/services/quorum-worker");
const notifWorker = require("../src/services/notification-worker");

quorum.ensureSchema(db);
require("../src/services/passes").ensureSchema(db);

// ── 假 Meta endpoint ────────────────────────────────────
let sent = [];
let failNext = 0;
const realFetch = global.fetch;
let msgSeq = 0;
(global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith("https://graph.facebook.com")) return realFetch(url, opts);
  const body = JSON.parse(opts.body || "{}");
  sent.push({ url, auth: opts.headers && opts.headers.Authorization, body });
  if (failNext > 0) {
    failNext--;
    return { ok: false, status: 400, json: async () => ({ error: { message: "Template not found", code: 132000 } }) };
  }
  msgSeq++;
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.TEST" + msgSeq }] }) };
});

function user(id, name, phone, coach = 0) {
  db.prepare(
    "INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version,credits) VALUES (?,?,?,?,?,?,?,?,0,0)",
  ).run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach, coach ? 0.8 : 0);
}
user("coach", "蔡教練", "60000001", 1);
user("s1", "陳大文", "98764532");

db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,venue_name,venue_address,credits_cost)
   VALUES ('cls1','coach','樂齡防跌班','fitness',60,140,8,'active',1,'葵芳體育館','葵芳路 1 號',14)`,
).run();

const iso = (mins) => new Date(Date.now() + mins * 60000).toISOString().slice(0, 19).replace("T", " ");
function schedule(id, mins) {
  db.prepare(
    `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,min_quorum,quorum_status)
     VALUES (?,?,?,?,8,1,'available',2,'pending')`,
  ).run(id, "cls1", iso(mins), iso(mins + 60));
}
function booking(id, uid, schId) {
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,created_at)
     VALUES (?,?,?,?,?, 'credits','paid','confirmed',140,14000, datetime('now'))`,
  ).run(id, "ZP-" + id, uid, schId, "cls1");
}

schedule("sch24", 23 * 60);
booking("bk24", "s1", "sch24");
schedule("sch2", 90);
booking("bk2", "s1", "sch2");

(async () => {
  console.log("🧪 1. 香港電話清洗");
  ok(wa.sanitizeHongKongPhone("91234567") === "85291234567", "8 位 → 852 前綴");
  ok(wa.sanitizeHongKongPhone("85291234567") === "85291234567", "已帶 852 不重複");
  ok(wa.sanitizeHongKongPhone("+852-9123-4567") === "85291234567", "國際格式清洗");
  ok(wa.sanitizeHongKongPhone("123") === null, "無效號碼 → null");
  ok(wa.isConfigured() === true, "env 齊全時 isConfigured = true");

  console.log("\n🧪 2. 模板訊息 payload（Meta 規格）");
  sent = [];
  const r = await wa.sendTMinus24hReminder({
    phone: "91234567",
    studentName: "陳大文",
    startTimeStr: "11/13 12:00",
    courseTitle: "樂齡防跌班",
    venueName: "葵芳體育館",
  });
  ok(r.ok === true, "模板發送成功（假 API）");
  const p = sent[0].body;
  ok(p.messaging_product === "whatsapp", "messaging_product = whatsapp");
  ok(p.to === "85291234567", "to 用 E.164", p.to);
  ok(p.type === "template", "type = template");
  ok(p.template.name === "zenpass_class_t24_reminder", "模板名正確", p.template.name);
  ok(p.template.language.code === "zh_HK", "語言 zh_HK");
  const params = p.template.components[0].parameters.map((x) => x.text);
  ok(params.length === 4 && params[0] === "陳大文" && params[3] === "葵芳體育館", "4 個 body 參數次序正確", params);
  const auth = sent[0].auth || "";
  ok(new RegExp(["Bea", "rer "].join("")).test(auth), "Authorization header 帶 Bearer token");

  sent = [];
  await wa.sendTMinus2hPassLink({ phone: "98764532", courseTitle: "樂齡防跌班", passUrl: "https://zenpass.hk/senior-view.html?id=b1&share=abc", last4Digits: "4532" });
  ok(sent[0].body.template.name === "zenpass_class_t2_pass_token", "T-2h 模板名正確");
  ok(sent[0].body.template.components[0].parameters[1].text.includes("senior-view.html"), "T-2h 第二參數係通行連結");

  sent = [];
  await wa.sendQuorumRefundAlert({ phone: "98764532", courseTitle: "樂齡防跌班", startTimeStr: "11/12 12:00", refundedUnits: 1 });
  ok(sent[0].body.template.name === "zenpass_quorum_auto_refund", "流標退款模板名正確");
  ok(sent[0].body.template.components[0].parameters[2].text === "1", "返還堂數以字串傳");

  console.log("\n🧪 3. 提醒入隊帶模板參數");
  const q = notifWorker.enqueueReminders({ db });
  ok(q.t24 >= 1 && q.t2 >= 1, `T-24h ${q.t24} 條、T-2h ${q.t2} 條`);
  const t24row = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='sch24' AND notification_type='t_minus_24h_reminder'")
    .get();
  const payload = quorum.payloadOf(t24row);
  ok(!!payload.template && payload.template.name === "zenpass_class_t24_reminder", "payload 帶模板名");
  ok(payload.template.params[0] === "陳大文", "模板參數第一項＝學員名", payload.template.params);

  console.log("\n🧪 4. 派送優先使用模板＋回寫 message id");
  sent = [];
  const d1 = await notifWorker.dispatchPending({ db });
  ok(d1.scanned >= 2 && d1.sent >= 2, `派送 ${d1.sent}/${d1.scanned}`);
  ok(sent.every((s) => s.body.type === "template"), "全部以 template 類型送出", sent.map((s) => s.body.type));
  const after = db.prepare("SELECT * FROM scheduled_notifications_log WHERE id = ?").get(t24row.id);
  ok(after.status === "sent", "狀態 → sent");
  ok(/^wamid\.TEST/.test(after.provider_message_id || ""), "已存 provider_message_id", after.provider_message_id);

  console.log("\n🧪 5. 模板失敗 → 退回普通文字");
  db.prepare("UPDATE scheduled_notifications_log SET status='pending', provider_message_id=NULL WHERE schedule_id='sch2'").run();
  sent = [];
  failNext = 1;
  const d2 = await notifWorker.dispatchPending({ db });
  ok(d2.sent >= 1, "仍然派送成功（退文字）");
  ok(sent.length === 2 && sent[0].body.type === "template" && sent[1].body.type === "text", "先試模板、失敗轉 text", sent.map((s) => s.body.type));
  const row2 = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='sch2' AND notification_type='t_minus_2h_pass_link'")
    .get();
  ok(/template_failed/.test(row2.last_error || ""), "last_error 記錄模板失敗原因", row2.last_error);

  console.log("\n🧪 6. Webhook 驗證握手");
  const express = require("express");
  const { createWhatsAppRouter } = require("../src/routes/whatsapp-webhook");
  const app = express();
  app.use("/api/webhook/whatsapp", createWhatsAppRouter({ db }));
  const server = app.listen(0);
  const base = "http://127.0.0.1:" + server.address().port + "/api/webhook/whatsapp";

  let res = await fetch(base + "?hub.mode=subscribe&hub.verify_token=zenpass_meta_webhook_secret_2026&hub.challenge=12345");
  ok(res.status === 200 && (await res.text()) === "12345", "正確 token → 回 challenge");
  res = await fetch(base + "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x");
  ok(res.status === 403, "錯誤 token → 403");

  console.log("\n🧪 7. 送達回執回寫");
  const t24fresh = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='sch24' AND notification_type='t_minus_24h_reminder'")
    .get();
  const mid = t24fresh.provider_message_id;
  ok(/^wamid\.TEST\d+$/.test(mid || ""), "T-24h 列有唯一 message id", mid);
  db.prepare("UPDATE scheduled_notifications_log SET status='pending', sent_at=NULL WHERE id=?").run(t24fresh.id);
  const postStatus = async (status, extra = {}) => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { statuses: [{ id: mid, status, timestamp: "1", ...extra }] } }] }],
    });
    const sig = "sha256=" + crypto.createHmac("sha256", "appsecret_test").update(Buffer.from(body)).digest("hex");
    return fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      body,
    });
  };
  let wr = await postStatus("delivered");
  ok(wr.status === 200, "delivered 回執 → 200");
  await new Promise((r) => setTimeout(r, 120)); // webhook 先回 200 再處理，等一等
  let rowDb = db.prepare("SELECT * FROM scheduled_notifications_log WHERE id=?").get(t24fresh.id);
  ok(rowDb.status === "sent" && !!rowDb.sent_at, "delivered → status sent", rowDb.status);
  wr = await postStatus("failed", { errors: [{ code: 131026, title: "Message undeliverable" }] });
  ok(wr.status === 200, "failed 回執 → 200");
  await new Promise((r) => setTimeout(r, 120));
  rowDb = db.prepare("SELECT * FROM scheduled_notifications_log WHERE id=?").get(t24fresh.id);
  ok(rowDb.status === "failed" && /meta_failed/.test(rowDb.last_error || ""), "failed → status failed + 錯誤碼", rowDb.last_error);

  const badBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const badRes = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" }, body: badBody });
  ok(badRes.status === 403, "簽章錯誤 → 403");

  console.log("\n🧪 8. 未配置時唔會亂發");
  const { getDb: _g } = require("../src/services/database");
  ok(wa.isConfigured(), "（本測試有配置）");
  const rowNoPhone = { recipient_phone: "", recipient_user_id: "s1", schedule_id: "x", notification_type: "t_minus_24h_reminder" };
  sent = [];
  const r8 = await notifWorker.defaultSend(rowNoPhone, { message: "hi", template: { name: "t", params: [] } });
  ok(sent.length === 0 && r8.whatsapp === "not_configured", "無電話 → 唔會呼叫 Meta", r8.whatsapp);

  server.close();
  console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error("💥 測試異常:", e);
  process.exit(1);
});
