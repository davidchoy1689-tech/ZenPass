/**
 * 客服營運補救工具（2026-11-06）
 * 1) extendHold：人手延長未付款訂單嘅鎖位時間（寫 hold_until，releaseExpiredHolds 會尊重）
 * 2) restoreBooking：把已被系統／人手取消嘅訂單還原成 confirmed（需有名額）
 * 3) searchRestorable：按參考編號／電話／姓名搵可還原訂單
 *
 * 鐵律：
 * - 只改 booking 狀態，唔會新增／刪除任何金錢紀錄
 * - 全部寫 audit_log
 * - 還原必須有名額（原子條件式 UPDATE，防超賣）
 */
const crypto = require("crypto");

class HoldError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function ensureHoldCols(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    [
      ["hold_until", "TEXT"],
      ["payment_claimed", "INTEGER DEFAULT 0"],
      ["payment_claimed_at", "TEXT"],
    ].forEach(([n, t]) => {
      if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run();
    });
  } catch (e) {
    console.error("[HOLD] cols:", e.message);
  }
}

function writeAudit(db, { type, entityId, actorId, before, after, description }) {
  db.prepare(
    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
     VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
  ).run(
    crypto.randomUUID(),
    type,
    "booking",
    entityId,
    actorId || null,
    before ? JSON.stringify(before) : null,
    JSON.stringify(after || {}),
    description || type,
  );
}

/** 人手延長鎖位；minutes 預設 60（上限 720） */
function extendHold(db, { bookingId, minutes = 60, actorId = null } = {}) {
  ensureHoldCols(db);
  const mins = Math.min(720, Math.max(5, Number(minutes) || 60));
  const run = db.transaction(() => {
    const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId);
    if (!b) throw new HoldError("BOOKING_NOT_FOUND", "找不到預約", 404);
    if (b.status !== "pending_payment") {
      throw new HoldError("NOT_PENDING", "只有待付款訂單可以延長鎖位", 409);
    }
    db.prepare(
      `UPDATE bookings SET hold_until = datetime('now', '+' || ? || ' minutes') WHERE id=? AND status='pending_payment'`,
    ).run(mins, bookingId);
    const after = db.prepare("SELECT hold_until FROM bookings WHERE id=?").get(bookingId);
    writeAudit(db, {
      type: "booking.hold_extended",
      entityId: bookingId,
      actorId,
      before: { old_status: b.status, old_hold_until: b.hold_until || null },
      after: { hold_until: after && after.hold_until, minutes: mins },
      description: `人手延長鎖位 ${mins} 分鐘：${b.booking_reference || bookingId}`,
    });
    return { booking_id: bookingId, hold_until: after && after.hold_until, minutes: mins };
  });
  return run();
}

/** 還原已取消訂單 → confirmed（有名額才可） */
function restoreBooking(db, { bookingId, reason, actorId = null, markPaid = true, force = false } = {}) {
  ensureHoldCols(db);
  const why = String(reason || "").trim().slice(0, 200);
  if (why.length < 4) throw new HoldError("REASON_REQUIRED", "請填寫還原原因（最少 4 字）", 400);

  const run = db.transaction(() => {
    const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId);
    if (!b) throw new HoldError("BOOKING_NOT_FOUND", "找不到預約", 404);
    if (b.status !== "cancelled" && b.status !== "expired") {
      throw new HoldError("NOT_CANCELLED", "此預約唔係已取消狀態", 409);
    }
    const s = db
      .prepare("SELECT id, start_time, max_participants, enrolled_count, status FROM class_schedules WHERE id=?")
      .get(b.schedule_id);
    if (!s) throw new HoldError("SCHEDULE_NOT_FOUND", "課堂時段已不存在", 409);
    if (s.status === "cancelled") throw new HoldError("SCHEDULE_CANCELLED", "課堂已取消，請改期而唔係還原", 409);
    const started = new Date(String(s.start_time || "").replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(String(s.start_time || "")) ? "" : "Z"));
    if (!force && !Number.isNaN(started.getTime()) && started.getTime() < Date.now()) {
      throw new HoldError("SCHEDULE_STARTED", "課堂已開始，不可還原（如要補錄請用出席補簽）", 409);
    }

    const dup = db
      .prepare(
        `SELECT id FROM bookings WHERE user_id=? AND schedule_id=? AND id<>? AND status IN ('confirmed','attended') LIMIT 1`,
      )
      .get(b.user_id, b.schedule_id, b.id);
    if (dup) throw new HoldError("DUPLICATE_BOOKING", "此學員在此班已有有效預約，無需還原", 409);

    const seats = Math.max(1, Number(b.group_size) || 1);
    const cap = db
      .prepare(
        "UPDATE class_schedules SET enrolled_count = enrolled_count + ? WHERE id=? AND enrolled_count + ? <= max_participants",
      )
      .run(seats, b.schedule_id, seats);
    if (cap.changes === 0) {
      throw new HoldError("CLASS_FULL", "該班已滿，請改期或加開名額", 409);
    }

    const newPayment = markPaid ? "paid" : b.payment_status || "pending";
    db.prepare(
      `UPDATE bookings
          SET status='confirmed', payment_status=?, cancel_reason=NULL,
              hold_until=NULL, payment_claimed=0
        WHERE id=? AND status IN ('cancelled','expired')`,
    ).run(newPayment, b.id);

    writeAudit(db, {
      type: "booking.restored",
      entityId: b.id,
      actorId,
      before: { status: b.status, payment_status: b.payment_status, cancel_reason: b.cancel_reason || null },
      after: { status: "confirmed", payment_status: newPayment, reason: why, seats, force: !!force },
      description: `還原已取消預約：${b.booking_reference || b.id}（${why}）`,
    });

    return {
      booking_id: b.id,
      booking_reference: b.booking_reference,
      status: "confirmed",
      payment_status: newPayment,
      seats,
      enrolled_count: (Number(s.enrolled_count) || 0) + seats,
      max_participants: s.max_participants,
    };
  });
  return run();
}

/** 搵可還原訂單：參考編號／電話／姓名 */
function searchRestorable(db, { q, limit = 20 } = {}) {
  ensureHoldCols(db);
  const term = String(q || "").trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const digits = term.replace(/\D/g, "");
  const n = Math.min(50, Math.max(1, Number(limit) || 20));
  return db
    .prepare(
      `SELECT b.id AS booking_id, b.booking_reference, b.status, b.payment_status, b.amount,
              b.cancel_reason, b.payment_claimed, b.hold_until, b.created_at,
              COALESCE(${hasChildCol(db) ? "NULLIF(b.child_name,'')" : "NULL"}, u.name) AS student_name,
              u.name AS user_name, u.phone,
              c.title AS class_title, cs.start_time, cs.status AS schedule_status,
              cs.enrolled_count, cs.max_participants
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         JOIN classes c ON c.id = b.class_id
         LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
        WHERE b.status IN ('cancelled','expired')
          AND (b.booking_reference LIKE ? OR u.phone LIKE ? OR u.name LIKE ?
               ${digits.length >= 4 ? "OR REPLACE(REPLACE(u.phone,' ',''),'-','') LIKE ?" : ""})
        ORDER BY b.created_at DESC
        LIMIT ${n}`,
    )
    .all(...[like, like, like, ...(digits.length >= 4 ? [`%${digits}%`] : [])]);
}

function hasChildCol(db) {
  try {
    return !!db.prepare("PRAGMA table_info(bookings)").all().find((c) => c.name === "child_name");
  } catch (e) {
    return false;
  }
}

module.exports = { extendHold, restoreBooking, searchRestorable, ensureHoldCols, HoldError };
