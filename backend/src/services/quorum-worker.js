/**
 * Phase 4.4 — 智慧開課門檻仲裁（Quorum Guard at T-12h）
 *
 * 每 10 分鐘掃描「未仲裁（quorum_status='pending'）」而距離開課 ≤ 12 小時的班次：
 *   人數 ≥ min_quorum → quorum_status='confirmed'，通知教練準備
 *   人數 <  min_quorum → 班次取消（cancelled_low_quorum）、預約取消、
 *                         Pass 堂數原子歸還、Credits 全額退回、
 *                         金錢付款（FPS／信用卡）標記待人手退款並通知 admin。
 *
 * 鐵律：
 *  - 只取消「confirmed」預約，pending_payment 不動（未付款本來就未鎖位）
 *  - Pass 用 passes.restoreInTx（按 pass_redemptions 實際扣幾張退幾張）
 *  - Credits 用 credit-ledger.applyCredits(type='refund')，可追溯
 *  - 金錢退款一律不自動執行（David 指示：金錢動作要人批）
 *  - 重複執行安全：quorum_status 一旦離開 'pending' 即不會再處理
 */
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");

const DEFAULT_MIN_QUORUM = 2;
const QUORUM_WINDOW_HOURS = 12;

const PUBLIC_BASE = () => (process.env.PUBLIC_BASE_URL || "https://zenpass.hk").replace(/\/+$/, "");

const parseUtc = (s) => {
  const str = String(s || "");
  if (!str) return null;
  const d = /[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? new Date(str) : new Date(str.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
};

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

function hktParts(d) {
  const fmt = new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    date: `${parts.month}/${parts.day}`,
    weekday: parts.weekday || "",
    time: `${parts.hour}:${parts.minute}`,
  };
}

function ensureSchema(db) {
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  const add = (name, type) => {
    if (!cols.includes(name)) db.prepare(`ALTER TABLE class_schedules ADD COLUMN ${name} ${type}`).run();
  };
  add("min_quorum", `INTEGER DEFAULT ${DEFAULT_MIN_QUORUM}`);
  add("quorum_checked_at", "TEXT");
  add("quorum_status", "TEXT DEFAULT 'pending'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_notifications_log (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      booking_id TEXT,
      recipient_user_id TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      channel TEXT DEFAULT 'whatsapp',
      status TEXT DEFAULT 'pending',
      provider_message_id TEXT,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(schedule_id, recipient_user_id, notification_type)
    )
  `);

  const ncols = db.prepare("PRAGMA table_info(scheduled_notifications_log)").all().map((c) => c.name);
  if (!ncols.includes("attempts")) db.prepare("ALTER TABLE scheduled_notifications_log ADD COLUMN attempts INTEGER DEFAULT 0").run();
  if (!ncols.includes("last_error")) db.prepare("ALTER TABLE scheduled_notifications_log ADD COLUMN last_error TEXT").run();
  if (!ncols.includes("payload")) db.prepare("ALTER TABLE scheduled_notifications_log ADD COLUMN payload TEXT").run();

  db.exec("CREATE INDEX IF NOT EXISTS idx_notify_schedule_user ON scheduled_notifications_log(schedule_id, recipient_user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_notify_status ON scheduled_notifications_log(status)");
}

function audit(db, action, entityId, values, description) {
  try {
    const { audit: writeAudit } = require("./audit");
    writeAudit({
      actionType: action,
      entityType: "class_schedule",
      entityId,
      userId: null,
      newValues: values || {},
      description: description || "",
    });
    return;
  } catch (e) {}
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
       VALUES (?,?,?,?,?,?,?,datetime('now'))`,
    ).run(uuidv4(), action, "class_schedule", entityId, null, JSON.stringify(values || {}), description || "");
  } catch (e) {}
}

/**
 * 寫入通知隊列（UNIQUE 保證同一班／同一人／同一類型只會有一條）
 * @returns {boolean} 今次是否新增
 */
function enqueue(db, { scheduleId, bookingId = null, userId, phone, type, message = "", channel = "whatsapp", template = null }) {
  if (!scheduleId || !userId) return false;
  let payload = null;
  if (message || template) payload = JSON.stringify({ message, template: template || null });
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO scheduled_notifications_log
         (id, schedule_id, booking_id, recipient_user_id, recipient_phone, notification_type, channel, status, payload)
       VALUES (?,?,?,?,?,?,?,'pending',?)`,
    )
    .run(uuidv4(), scheduleId, bookingId, userId, String(phone || ""), type, channel, payload);
  return r.changes > 0;
}

function payloadOf(row) {
  try {
    const p = JSON.parse((row && row.payload) || "{}");
    return { message: p.message || "", template: p.template || null };
  } catch (e) {
    return { message: "", template: null };
  }
}

function messageOfLog(row) {
  return payloadOf(row).message;
}

function activeBookings(db, scheduleId) {
  return db
    .prepare(
      `SELECT b.id, b.booking_reference, b.user_id, b.class_id, b.pass_id, b.payment_type,
              b.payment_status, b.amount, b.group_size, b.created_at,
              u.name AS user_name, u.phone AS user_phone
         FROM bookings b LEFT JOIN users u ON u.id = b.user_id
        WHERE b.schedule_id = ? AND b.status = 'confirmed'
        ORDER BY b.created_at`,
    )
    .all(scheduleId);
}

function resolveMinQuorum(sch) {
  const own = Number(sch.min_quorum);
  if (Number.isFinite(own) && own > 0) return own;
  const fromClass = Number(sch.min_participants);
  if (Number.isFinite(fromClass) && fromClass > 1) return fromClass;
  return DEFAULT_MIN_QUORUM;
}

/** 原路退還：Pass 堂數 > Credits > 金錢（只標記，等人手） */
function refundBooking(db, bk) {
  const out = { booking_id: bk.id, method: "none", credits: 0, pass_restored: false };

  if (bk.pass_id) {
    try {
      const ok = require("./passes").restoreInTx(db, { passId: bk.pass_id, bookingId: bk.id });
      if (ok) {
        out.method = "pass";
        out.pass_restored = true;
        return out;
      }
    } catch (e) {
      console.error("[QUORUM] pass restore failed:", e.message);
    }
  }

  if (bk.payment_type === "credits") {
    let credits = 0;
    if (Number(bk.amount) > 0) credits = money(Number(bk.amount) / 10);
    else {
      const cls = db.prepare("SELECT credits_cost FROM classes WHERE id = ?").get(bk.class_id);
      credits = Number(cls && cls.credits_cost) || 0;
    }
    credits = Math.round(credits * 10) / 10;
    if (credits > 0) {
      try {
        require("./credit-ledger").applyCredits(db, {
          userId: bk.user_id,
          credits,
          type: "refund",
          source: "quorum_cancel",
          referenceId: bk.id,
          description: "課程人數不足自動流標，全額退回 Credits",
        });
        out.method = "credits";
        out.credits = credits;
        return out;
      } catch (e) {
        console.error("[QUORUM] credit refund failed:", e.message);
        out.method = "failed";
        return out;
      }
    }
  }

  if (bk.payment_status === "paid" && Number(bk.amount) > 0) {
    out.method = "manual_refund_required";
    out.credits = 0;
    return out;
  }

  return out;
}

function textForCancelled({ sch, bk, enrolled, minQuorum, refund }) {
  const t = hktParts(parseUtc(sch.start_time) || new Date());
  const refundText =
    refund.method === "pass"
      ? "✅ 已將 1 堂原路退回你的通行證。"
      : refund.method === "credits"
        ? `✅ 已將 ${refund.credits} Credits 全額退回你的錢包。`
        : refund.method === "manual_refund_required"
          ? "💰 我們會於下一個工作天以 FPS 全額退款，客服會 WhatsApp 你確認。"
          : "如需協助請回覆此訊息，客服會盡快處理。";
  return `【ZenPass 課程取消通知】\n${t.date}（${t.weekday}）${t.time}《${sch.title || "課堂"}》因報名人數不足（${enrolled}/${minQuorum} 人）已取消。\n${refundText}\n造成不便，敬請見諒。`;
}

function textForConfirmed({ sch, enrolled, minQuorum }) {
  const t = hktParts(parseUtc(sch.start_time) || new Date());
  const place = sch.venue_name ? `\n📍 ${sch.venue_name}` : "";
  return `【ZenPass 開班確認】\n${t.date}（${t.weekday}）${t.time}《${sch.title || "課堂"}》已達開班人數（${enrolled}/${minQuorum}）。\n請準時到場，記得帶飲用水。${place}`;
}

function textForCoachCancelled({ sch, enrolled, minQuorum }) {
  const t = hktParts(parseUtc(sch.start_time) || new Date());
  return `【ZenPass 課程流標】\n${t.date}（${t.weekday}）${t.time}《${sch.title || "課堂"}》只有 ${enrolled} 人報名（門檻 ${minQuorum}），系統已自動取消並退款。\n你唔需要到場，該時段已釋放。`;
}

/**
 * 單次仲裁掃描
 * @returns {{checked:number, confirmed:number, cancelled:number, queued:number, skipped_past:number, details:Array}}
 */
async function runOnce({ db = getDb(), now = new Date(), notify } = {}) {
  ensureSchema(db);
  const out = { checked: 0, confirmed: 0, cancelled: 0, queued: 0, skipped_past: 0, details: [] };

  // 只取 pending 嘅班次（避免 SQL 字串時間格式差異，精確判斷交畀 JS）
  const classCols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  const minExpr = classCols.includes("min_participants") ? "c.min_participants" : "NULL AS min_participants";
  const candidates = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, s.min_quorum, s.quorum_checked_at,
              s.quorum_status, s.coach_override_id, s.enrolled_count,
              c.title, c.venue_name, c.venue_address, ${minExpr},
              COALESCE(s.coach_override_id, c.coach_id) AS actual_coach_id
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
        WHERE s.quorum_status = 'pending'
          AND s.status NOT IN ('cancelled', 'completed')
        ORDER BY s.start_time`,
    )
    .all();

  for (const sch of candidates) {
    const start = parseUtc(sch.start_time);
    if (!start) continue;
    const hoursUntil = (start.getTime() - now.getTime()) / 3600000;

    // 已開課都未仲裁 → 唔應該取消（可能已上堂），標記 confirmed 收工
    if (hoursUntil < 0) {
      db.prepare(
        "UPDATE class_schedules SET quorum_status = 'confirmed', quorum_checked_at = datetime('now') WHERE id = ? AND quorum_status = 'pending'",
      ).run(sch.id);
      audit(db, "schedule.quorum_past_confirmed", sch.id, { hours_until: Math.round(hoursUntil * 10) / 10 }, "班次已開始，略過流標仲裁");
      out.skipped_past++;
      continue;
    }

    // 只在開課前 12 小時內仲裁
    if (hoursUntil > QUORUM_WINDOW_HOURS) continue;

    out.checked++;
    const minQuorum = resolveMinQuorum(sch);
    const bookings = activeBookings(db, sch.id);
    const enrolled = bookings.length;

    if (enrolled >= minQuorum) {
      db.prepare(
        "UPDATE class_schedules SET quorum_status = 'confirmed', quorum_checked_at = datetime('now') WHERE id = ?",
      ).run(sch.id);
      audit(db, "schedule.quorum_confirmed", sch.id, { enrolled, min_quorum: minQuorum, hours_until: Math.round(hoursUntil * 10) / 10 }, `達開班門檻：${enrolled}/${minQuorum}`);

      const coach = sch.actual_coach_id
        ? db.prepare("SELECT id, phone FROM users WHERE id = ?").get(sch.actual_coach_id)
        : null;
      if (coach) {
        const added = enqueue(db, {
          scheduleId: sch.id,
          userId: coach.id,
          phone: coach.phone,
          type: "coach_quorum_confirmed",
          message: textForConfirmed({ sch, enrolled, minQuorum }),
        });
        if (added) out.queued++;
      }
      out.confirmed++;
      out.details.push({ schedule_id: sch.id, result: "confirmed", enrolled, min_quorum: minQuorum });
      continue;
    }

    // 未達門檻 → 原子取消＋退款＋通知
    const coach = sch.actual_coach_id
      ? db.prepare("SELECT id, phone FROM users WHERE id = ?").get(sch.actual_coach_id)
      : null;

    const run = db.transaction(() => {
      db.prepare(
        "UPDATE class_schedules SET status = 'cancelled', quorum_status = 'cancelled_low_quorum', quorum_checked_at = datetime('now') WHERE id = ?",
      ).run(sch.id);

      const results = [];
      for (const bk of bookings) {
        const hasCancelledAt = db.prepare("PRAGMA table_info(bookings)").all().some((c) => c.name === "cancelled_at");
        if (hasCancelledAt) {
          db.prepare(
            "UPDATE bookings SET status = 'cancelled', cancel_reason = 'system_low_quorum_auto_refund', cancelled_at = datetime('now') WHERE id = ? AND status = 'confirmed'",
          ).run(bk.id);
        } else {
          db.prepare(
            "UPDATE bookings SET status = 'cancelled', cancel_reason = 'system_low_quorum_auto_refund' WHERE id = ? AND status = 'confirmed'",
          ).run(bk.id);
        }
        const refund = refundBooking(db, bk);
        results.push({ booking: bk, refund });
      }

      db.prepare("UPDATE class_schedules SET enrolled_count = 0 WHERE id = ?").run(sch.id);

      audit(
        db,
        "schedule.quorum_auto_cancelled",
        sch.id,
        {
          enrolled,
          min_quorum: minQuorum,
          booking_ids: bookings.map((b) => b.id),
          refunds: results.map((r) => ({ booking_id: r.booking.id, method: r.refund.method, credits: r.refund.credits })),
          hours_until: Math.round(hoursUntil * 10) / 10,
        },
        `人數不足自動流標：${enrolled}/${minQuorum}`,
      );

      return results;
    });

    const results = run();

    for (const { booking: bk, refund } of results) {
      const t = hktParts(parseUtc(sch.start_time) || new Date());
      const units = refund.method === "pass" ? 1 : refund.method === "credits" ? 1 : 0;
      const added = enqueue(db, {
        scheduleId: sch.id,
        bookingId: bk.id,
        userId: bk.user_id,
        phone: bk.user_phone,
        type: "quorum_cancelled_refund",
        message: textForCancelled({ sch, bk, enrolled, minQuorum, refund }),
        template: {
          name: require("./whatsapp-cloud").templates.quorum,
          params: [sch.title || "課堂", `${t.date} ${t.time}`, String(units || 1)],
        },
      });
      if (added) out.queued++;
    }

    if (coach) {
      const added = enqueue(db, {
        scheduleId: sch.id,
        userId: coach.id,
        phone: coach.phone,
        type: "coach_quorum_cancelled",
        message: textForCoachCancelled({ sch, enrolled, minQuorum }),
      });
      if (added) out.queued++;
    }

    const manual = results.filter((r) => r.refund.method === "manual_refund_required");
    if (manual.length) {
      try {
        require("./notify-admins").notifyAdmins("quorum_manual_refund", {
          schedule_id: sch.id,
          title: sch.title,
          count: manual.length,
          booking_ids: manual.map((r) => r.booking.id),
        });
      } catch (e) {}
    }

    out.cancelled++;
    out.details.push({
      schedule_id: sch.id,
      result: "cancelled_low_quorum",
      enrolled,
      min_quorum: minQuorum,
      refunds: results.map((r) => ({ booking_id: r.booking.id, method: r.refund.method, credits: r.refund.credits })),
    });

    if (typeof notify === "function") {
      try {
        await notify({ type: "cancelled_low_quorum", schedule: sch, enrolled, min_quorum: minQuorum });
      } catch (e) {}
    }
  }

  return out;
}

function start(intervalMs = 10 * 60 * 1000) {
  const timer = setInterval(() => {
    runOnce().catch((e) => console.error("[QUORUM]", e.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  ensureSchema,
  runOnce,
  start,
  enqueue,
  messageOfLog,
  payloadOf,
  activeBookings,
  resolveMinQuorum,
  refundBooking,
  DEFAULT_MIN_QUORUM,
  QUORUM_WINDOW_HOURS,
  PUBLIC_BASE,
  hktParts,
  parseUtc,
};
