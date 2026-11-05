/**
 * P1：WhatsApp Cloud API（mock，不接觸真實 Meta API）
 */
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.WHATSAPP_ERROR_LOG = "/tmp/wa-test-error.log";

const path = require("path");
const http = require("http");
const assert = require("assert");
const express = require(path.join(__dirname, "..", "node_modules", "express"));
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const crypto = require("crypto");
const wa = require("../src/services/whatsapp-cloud");
const { createWhatsAppRouter, pickReply } = require("../src/routes/whatsapp-webhook");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, status TEXT,
      receipt_image TEXT, payment_reported_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, action_type TEXT, entity_type TEXT, entity_id TEXT,
      user_id TEXT, new_values TEXT, description TEXT, created_at TEXT);
  `);
  db.prepare("INSERT INTO users VALUES ('u1','陳小姐','98770001')").run();
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,status) VALUES ('b1','ZP-0001','u1','pending_payment')").run();
  return db;
}

(async () => {
  console.log("\n🧪 1. 簽名驗證");
  const body = Buffer.from(JSON.stringify({ hello: "世界" }));
  const sig = "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
  ok("正確簽名", wa.verifySignature(body, sig, "test-secret") === true);
  ok("錯誤簽名", wa.verifySignature(body, sig, "wrong") === false);
  ok("缺簽名", wa.verifySignature(body, null, "test-secret") === false);

  console.log("\n🧪 2. 重試（500 ×2 → 200）");
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return calls < 3
      ? { ok: false, status: 500, json: async () => ({ error: "boom" }) }
      : { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.X" }] }) };
  };
  const r = await wa.sendTextMessage("9876 5432", "hello", { fetchImpl: fakeFetch, baseDelayMs: 1 });
  ok("第 3 次成功", r.ok === true && calls === 3);

  console.log("\n🧪 3. 4xx 不重試");
  let c4 = 0;
  const fetch4 = async () => { c4++; return { ok: false, status: 400, json: async () => ({ error: { message: "bad" } }) }; };
  const r4 = await wa.sendTextMessage("98765432", "x", { fetchImpl: fetch4, baseDelayMs: 1 });
  ok("只叫一次", r4.ok === false && c4 === 1);

  console.log("\n🧪 4. Payload 格式");
  let sent = null;
  const capture = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; };
  await wa.sendTemplateMessage("+852 9123-4567", "class_reminder", { components: [{ type: "body", parameters: [] }], fetchImpl: capture });
  ok("電話正規化 852", sent.to === "85291234567", sent.to);
  ok("template 結構", sent.type === "template" && sent.template.name === "class_reminder");

  console.log("\n🧪 5. 關鍵字回覆");
  ok("交通", pickReply("想問交通點去")?.includes("楓樹窩路 1 號"));
  ok("關節", pickReply("我膝頭痛做唔做到")?.includes("量力而為"));
  ok("報名", pickReply("幾錢？想報名")?.includes("SILVER2"));
  ok("其他", pickReply("你好") === null);

  console.log("\n🧪 6. Webhook（圖片收據）");
  const db = makeDb();
  const replies = [];
  const app = express();
  app.use("/webhook", createWhatsAppRouter({
    db, allowUnsigned: true, sendText: async (to, text) => { replies.push({ to, text }); return { ok: true }; },
  }));
  const server = app.listen(0);
  const port = server.address().port;
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: "85298770001" }],
      messages: [{ id: "wamid.IMG1", from: "85298770001", type: "image", image: { id: "MEDIA-123" } }],
    } }] }],
  };
  const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  await new Promise((r) => setTimeout(r, 300));
  server.close();
  const b = db.prepare("SELECT * FROM bookings WHERE id='b1'").get();
  ok("HTTP 200", res.status === 200);
  ok("receipt_media_id 寫入", b.receipt_media_id === "MEDIA-123");
  ok("fps_receipt_received=1", Number(b.fps_receipt_received) === 1);
  ok("audit payment.receipt_received", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='payment.receipt_received'").get().n === 1);
  ok("回覆確認", replies.length === 1 && replies[0].text.includes("轉交客服"));

  console.log("\n🧪 7. 重複 message id 只處理一次");
  const app2 = express();
  const db2 = makeDb();
  app2.use("/webhook", createWhatsAppRouter({ db: db2, allowUnsigned: true, sendText: async () => ({ ok: true }) }));
  const s2 = app2.listen(0); const p2 = s2.address().port;
  const send = () => fetch(`http://127.0.0.1:${p2}/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  await send(); await new Promise((r) => setTimeout(r, 200)); await send(); await new Promise((r) => setTimeout(r, 200));
  s2.close();
  ok("inbound 只有一筆", db2.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type='whatsapp.inbound'").get().n === 1);

  console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
