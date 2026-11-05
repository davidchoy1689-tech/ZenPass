/**
 * WhatsApp Cloud API Webhook
 * GET  /api/webhook/whatsapp  → Meta 驗證
 * POST /api/webhook/whatsapp  → 文字關鍵字自動回覆、圖片收據入待核實
 *
 * 安全性：X-Hub-Signature-256 必須用原始 body 驗簽。
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const wa = require("../services/whatsapp-cloud");

const TRAFFIC_REPLY = `您好！課堂地點：【青衣楓樹窩體育館・活動室】（青衣楓樹窩路 1 號）。

交通：港鐵青衣站 B 出口轉乘接駁交通，或沿行人天橋步行約 10 分鐘。
到達後請依大堂水牌指示前往活動室（館內有無障礙電梯），或向大堂職員查詢。靜儀導師會於 10:20 在門口接待大家！`;

const HEALTH_REPLY = `請放心！這堂課專為 50+ 樂齡朋友設計：
• 全程慢速、深呼吸、坐姿及平躺伸展，無跳躍或高負擔動作。
• 課前導師會個別了解關節情況，角度緊繃會即場指導替代動作，量力而為即可。`;

const SIGNUP_REPLY = `多謝查詢！11/09（一）10:30 樂齡深層伸展仍有位。
單人 HK$140；二人同行 HK$240（SILVER2 減 $40）。
報名：https://zenpass.hk/c/ching-yee`;

function pickReply(text) {
  const t = String(text || "");
  if (/交通|地點|地址|點去|邊度/.test(t)) return TRAFFIC_REPLY;
  if (/關節|膝頭|膝|腰|痛|舊患|做唔做到/.test(t)) return HEALTH_REPLY;
  if (/報名|幾錢|價錢|收費/.test(t)) return SIGNUP_REPLY;
  return null;
}

function ensureReceiptCols(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    [
      ["fps_receipt_received", "INTEGER DEFAULT 0"],
      ["receipt_media_id", "TEXT"],
      ["payment_reported_at", "TEXT"],
    ].forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) {
    console.error("[WA] receipt cols:", e.message);
  }
}

function auditOnce(db, action, entityId, values, description) {
  const exists = db.prepare("SELECT 1 FROM audit_log WHERE action_type=? AND entity_id=?").get(action, entityId);
  if (exists) return false;
  db.prepare(
    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))`,
  ).run(crypto.randomUUID(), action, "whatsapp", entityId, null, JSON.stringify(values || {}), description || "");
  return true;
}

function createWhatsAppRouter({
  db = null,
  sendText = wa.sendTextMessage,
  verifyToken = wa.config.VERIFY_TOKEN,
  appSecret = wa.config.APP_SECRET,
  allowUnsigned = false,
} = {}) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token && token === verifyToken) return res.status(200).send(String(challenge || ""));
    return res.status(403).json({ error: "verification failed" });
  });

  router.post("/", express.raw({ type: "*/*", limit: "5mb" }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!allowUnsigned && !wa.verifySignature(raw, req.headers["x-hub-signature-256"], appSecret)) {
      return res.status(403).json({ error: "invalid signature" });
    }
    // Meta 要求快速 200；處理錯誤只記錄
    res.status(200).json({ received: true });

    try {
      const payload = JSON.parse(raw.toString("utf8"));
      const database = db || getDb();
      ensureReceiptCols(database);
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const contacts = value.contacts || [];
          const messages = value.messages || [];
          for (const msg of messages) {
            const from = (contacts[0] && contacts[0].wa_id) || msg.from;
            if (!msg.id) continue;
            if (!auditOnce(database, "whatsapp.inbound", "wa:" + msg.id, { type: msg.type, from }, "WhatsApp 收到訊息")) continue;

            if (msg.type === "text") {
              const reply = pickReply(msg.text && msg.text.body);
              if (reply) await sendText(from, reply);
            }

            if (msg.type === "image") {
              const mediaId = msg.image && msg.image.id;
              const phone = wa.normalizePhone(from);
              const booking = database
                .prepare(
                  `SELECT b.id, b.booking_reference FROM bookings b JOIN users u ON u.id=b.user_id
                    WHERE u.phone=? AND b.status IN ('pending_payment','confirmed')
                    ORDER BY b.created_at DESC LIMIT 1`,
                )
                .get(phone);
              if (booking) {
                database
                  .prepare(
                    "UPDATE bookings SET receipt_image=?, receipt_media_id=?, fps_receipt_received=1, payment_reported_at=datetime('now') WHERE id=?",
                  )
                  .run(`wa:${mediaId}`, mediaId, booking.id);
                database
                  .prepare(
                    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
                     VALUES (?,?,?,?,?,?,?,datetime('now'))`,
                  )
                  .run(
                    crypto.randomUUID(), "payment.receipt_received", "booking", booking.id, null,
                    JSON.stringify({ media_id: mediaId, channel: "whatsapp" }),
                    `WhatsApp 收到 FPS 截圖（${booking.booking_reference}）`,
                  );
                await sendText(from, "收到！已將您的付款截圖轉交客服核實，核實後會再通知您，謝謝 🙏");
              } else {
                await sendText(from, "收到圖片！但搵唔到對應預約，請提供報名姓名或電話，客服會跟進 🙏");
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[WA] webhook error:", err.message);
    }
  });

  return router;
}

module.exports = { createWhatsAppRouter, pickReply, TRAFFIC_REPLY, HEALTH_REPLY, SIGNUP_REPLY };
