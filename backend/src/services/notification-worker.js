/**
 * Phase 4.4 — 履約提醒 Worker（T-24h / T-2h）＋ WhatsApp 派送
 *
 * 每 10 分鐘：
 *  1) T-24h：距開課 ≤24h 且 >2h → 提醒（仍在免費取消窗口）
 *  2) T-2h ：距開課 ≤2h 且 >0h → 入場通行連結 + 電話後 4 位
 *  3) 派送：scheduled_notifications_log 內 status='pending'（或失敗未夠 3 次）
 *
 * 冪等：UNIQUE(schedule_id, recipient_user_id, notification_type)，
 *      同一班同一人同一類型只會寫一條，Worker 跑幾多次都唔會重發。
 */
const { getDb } = require("./database");
const quorum = require("./quorum-worker");
const wa = require("./whatsapp-cloud");

const MAX_ATTEMPTS = 3;
const T24_HOURS = 24;
const T2_HOURS = 2;

const publicBase = () => (process.env.PUBLIC_BASE_URL || "https://zenpass.hk").replace(/\/+$/, "");

function last4(phone) {
  const p = String(phone || "").replace(/\D/g, "").replace(/^852/, "");
  return p.length >= 4 ? p.slice(-4) : "";
}

function shareLinkFor(booking) {
  try {
    const shareToken = require("./share-token");
    const sig = shareToken.make({
      id: booking.id,
      phone: booking.parent_phone || booking.user_phone || "",
      schedule_id: booking.schedule_id,
      created_at: booking.created_at,
    });
    return `${publicBase()}/senior-view.html?id=${encodeURIComponent(booking.id)}&share=${sig}`;
  } catch (e) {
    return `${publicBase()}/my-bookings.html`;
  }
}

function textT24({ row, hkt }) {
  const place = row.venue_name ? `\n📍 ${row.venue_name}${row.venue_address ? `（${row.venue_address}）` : ""}` : "";
  return (
    `【ZenPass 課堂提醒】\n` +
    `明天 ${hkt.date}（${hkt.weekday}）${hkt.time}《${row.title || "課堂"}》${place}\n` +
    `如需更改行程，請於開課前 24 小時在「我的預約」免費取消：\n${publicBase()}/my-bookings.html`
  );
}

function textT2({ row, hkt, booking }) {
  const place = row.venue_name ? `\n📍 ${row.venue_name}` : "";
  const p4 = last4(booking.user_phone);
  return (
    `【ZenPass 入場憑證】\n` +
    `${hkt.time}《${row.title || "課堂"}》2 小時後開始${place}\n` +
    `🎫 出示連結入場：${shareLinkFor(booking)}\n` +
    (p4 ? `或向教練報出電話後 4 位：${p4}\n` : "") +
    `請提早 10 分鐘到達。`
  );
}

/**
 * 掃描並寫入提醒隊列
 * @returns {{t24:number, t2:number, skipped:number}}
 */
function enqueueReminders({ db = getDb(), now = new Date() } = {}) {
  quorum.ensureSchema(db);
  const out = { t24: 0, t2: 0, skipped: 0 };

  const from = new Date(now.getTime() - 2 * 3600000).toISOString();
  const to = new Date(now.getTime() + (T24_HOURS + 2) * 3600000).toISOString();

  const schedules = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, c.title, c.venue_name, c.venue_address
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
        WHERE s.status NOT IN ('cancelled', 'completed')
          AND datetime(s.start_time) BETWEEN datetime(?) AND datetime(?)
        ORDER BY s.start_time`,
    )
    .all(from, to);

  for (const sch of schedules) {
    const start = quorum.parseUtc(sch.start_time);
    if (!start) continue;
    const hours = (start.getTime() - now.getTime()) / 3600000;
    if (hours <= 0 || hours > T24_HOURS) continue;

    const hkt = quorum.hktParts(start);
    const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    const parentPhoneExpr = bcols.includes("parent_phone") ? "b.parent_phone" : "NULL AS parent_phone";
    const bookings = db
      .prepare(
        `SELECT b.id, b.booking_reference, b.schedule_id, b.user_id, b.created_at,
                ${parentPhoneExpr}, u.name AS user_name, u.phone AS user_phone
           FROM bookings b LEFT JOIN users u ON u.id = b.user_id
          WHERE b.schedule_id = ? AND b.status = 'confirmed'`,
      )
      .all(sch.id);

    for (const bk of bookings) {
      if (!bk.user_id) { out.skipped++; continue; }
      const row = { ...sch, ...bk };

      if (hours <= T24_HOURS && hours > T2_HOURS) {
        const added = quorum.enqueue(db, {
          scheduleId: sch.id,
          bookingId: bk.id,
          userId: bk.user_id,
          phone: bk.parent_phone || bk.user_phone,
          type: "t_minus_24h_reminder",
          message: textT24({ row, hkt }),
          template: {
            name: wa.templates.t24,
            params: [row.user_name || "學員", `${hkt.date} ${hkt.time}`, sch.title || "課堂", sch.venue_name || ""],
          },
        });
        if (added) out.t24++; else out.skipped++;
      } else if (hours <= T2_HOURS) {
        const added = quorum.enqueue(db, {
          scheduleId: sch.id,
          bookingId: bk.id,
          userId: bk.user_id,
          phone: bk.parent_phone || bk.user_phone,
          type: "t_minus_2h_pass_link",
          message: textT2({ row, hkt, booking: bk }),
          template: {
            name: wa.templates.t2,
            params: [sch.title || "課堂", shareLinkFor(bk), last4(bk.parent_phone || bk.user_phone)],
          },
        });
        if (added) out.t2++; else out.skipped++;
      }
    }
  }
  return out;
}

/**
 * 預設派送管道：站內通知 → WhatsApp（優先用已核准模板）→ SMS
 * 回傳 { sms, whatsapp, in_app, provider_message_id, detail }
 */
async function defaultSend(row, payload) {
  const out = { sms: "not_configured", whatsapp: "not_configured", in_app: false, provider_message_id: null, detail: "" };

  if (row.recipient_user_id) {
    try {
      require("./notification").dbNotification(
        row.recipient_user_id,
        "schedule",
        "ZenPass 課程通知",
        payload.message || "",
        { schedule_id: row.schedule_id, type: row.notification_type },
      );
      out.in_app = true;
    } catch (e) {}
  }

  if (wa.isConfigured() && row.recipient_phone) {
    let r = null;
    let used = "text";
    if (payload.template && payload.template.name) {
      r = await wa.sendTemplate(row.recipient_phone, payload.template.name, payload.template.params || []);
      used = "template";
      if (!r || !r.ok) {
        // 模板未核准／參數不符 → 退回普通文字（只在 24 小時客服窗內有效）
        out.detail = `template_failed:${(r && r.status) || 0}`;
        r = await wa.sendTextMessage(row.recipient_phone, payload.message || "");
        used = "text_fallback";
      }
    } else {
      r = await wa.sendTextMessage(row.recipient_phone, payload.message || "");
    }
    const mid = r && r.data && r.data.messages && r.data.messages[0] && r.data.messages[0].id;
    if (mid) out.provider_message_id = mid;
    out.whatsapp = r && r.ok ? "sent" : String((r && r.data && (r.data.error || r.data.message)) || "failed").slice(0, 80);
    out.detail = [out.detail, used].filter(Boolean).join(",");
  }

  try {
    const sms = require("./sms-service");
    if (sms.isConfigured && sms.isConfigured()) {
      const s = await sms.sendSms(row.recipient_phone, payload.message || "");
      out.sms = s && s.ok ? "sent" : "failed";
    }
  } catch (e) {
    out.sms = "failed";
  }

  return out;
}

/**
 * 派送待發通知
 * @param {{db?:object, limit?:number, send?:Function}} opts
 */
async function dispatchPending({ db = getDb(), limit = 50, send } = {}) {
  quorum.ensureSchema(db);
  const rows = db
    .prepare(
      `SELECT * FROM scheduled_notifications_log
        WHERE status = 'pending'
           OR (status = 'failed' AND COALESCE(attempts, 0) < ?)
        ORDER BY created_at LIMIT ?`,
    )
    .all(MAX_ATTEMPTS, limit);

  const out = { scanned: rows.length, sent: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    const payload = quorum.payloadOf(row);
    if (!payload.message) {
      db.prepare(
        "UPDATE scheduled_notifications_log SET status = 'failed', attempts = COALESCE(attempts,0)+1, last_error = 'empty_payload' WHERE id = ?",
      ).run(row.id);
      out.failed++;
      continue;
    }
    try {
      const res = send
        ? await send({
            phone: row.recipient_phone,
            message: payload.message,
            userId: row.recipient_user_id,
            title: "ZenPass 課程通知",
            meta: { schedule_id: row.schedule_id, type: row.notification_type },
          })
        : await defaultSend(row, payload);

      const waStatus = String((res && res.whatsapp) || "").toLowerCase();
      const smsStatus = String((res && res.sms) || "").toLowerCase();
      const delivered = waStatus === "sent" || smsStatus === "sent" || (res && res.in_app === true);
      const degraded = [
        waStatus && waStatus !== "sent" ? `whatsapp:${waStatus}` : "",
        smsStatus && smsStatus !== "sent" ? `sms:${smsStatus}` : "",
        (res && res.detail) || "",
      ]
        .filter(Boolean)
        .join(",");

      if (delivered) {
        db.prepare(
          "UPDATE scheduled_notifications_log SET status = 'sent', sent_at = datetime('now'), attempts = COALESCE(attempts,0)+1, provider_message_id = COALESCE(?, provider_message_id), last_error = ? WHERE id = ?",
        ).run((res && res.provider_message_id) || null, degraded || null, row.id);
        out.sent++;
      } else {
        db.prepare(
          "UPDATE scheduled_notifications_log SET status = 'failed', attempts = COALESCE(attempts,0)+1, last_error = ? WHERE id = ?",
        ).run(degraded || "not_delivered", row.id);
        out.failed++;
      }
    } catch (e) {
      db.prepare(
        "UPDATE scheduled_notifications_log SET status = 'failed', attempts = COALESCE(attempts,0)+1, last_error = ? WHERE id = ?",
      ).run(String(e.message || "error").slice(0, 300), row.id);
      out.failed++;
    }
  }
  return out;
}

/**
 * 一次完整週期：寫提醒 → 派送
 */
async function runOnce({ db = getDb(), now = new Date(), send, dispatch = true } = {}) {
  const queued = enqueueReminders({ db, now });
  const sent = dispatch ? await dispatchPending({ db, send }) : { scanned: 0, sent: 0, failed: 0, skipped: 0 };
  return { queued, dispatch: sent };
}

function start(intervalMs = 10 * 60 * 1000) {
  const timer = setInterval(() => {
    runOnce().catch((e) => console.error("[NOTIFY WORKER]", e.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  enqueueReminders,
  dispatchPending,
  defaultSend,
  runOnce,
  start,
  textT24,
  textT2,
  MAX_ATTEMPTS,
  T24_HOURS,
  T2_HOURS,
};
