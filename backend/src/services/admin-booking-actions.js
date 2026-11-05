/**
 * ZenPass — 管理員預約操作（改期 / 加位升級）
 * 全部喺 SQLite transaction 內完成，任何一步失敗即 rollback。
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

class ActionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const normPhone = (raw) => {
  let p = String(raw || "").replace(/\D/g, "");
  if (p.startsWith("852") && p.length === 11) p = p.slice(3);
  if (p.startsWith("0") && p.length === 9) p = p.slice(1);
  return p;
};

function nextRefFactory(db) {
  const max = db
    .prepare("SELECT MAX(CAST(SUBSTR(booking_reference, 4) AS INTEGER)) AS m FROM bookings WHERE booking_reference GLOB 'ZP-[0-9]*'")
    .get().m || 0;
  let n = Number(max) || 0;
  return () => "ZP-" + String(++n).padStart(4, "0");
}

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function splitAmount(amount, rate) {
  const a = money(amount);
  const r = Number.isFinite(Number(rate)) ? Number(rate) : 0.25;
  const platform = money(a * r);
  return { platform, venue: money(a - platform), rate: r };
}

function audit(db, { action, entityId, actorId, values, description, ip, ua }) {
  db.prepare(
    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, ip_address, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`,
  ).run(uuidv4(), action, "booking", entityId, actorId || null, JSON.stringify(values || {}), description || "", ip || "", ua || "");
}

function seatCount(db, userId, scheduleId) {
  return db
    .prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE user_id=? AND schedule_id=? AND status IN ('confirmed','pending_payment')",
    )
    .get(userId, scheduleId).n;
}

// ===== 改期：整組同行 booking 一齊搬 =====
function rescheduleBooking(db, { bookingId, newScheduleId, reason, actorId, ip, ua }) {
  if (!bookingId || !newScheduleId) throw new ActionError("INVALID_INPUT", "缺少 booking 或新班次");
  if (!reason || String(reason).trim().length < 4) throw new ActionError("REASON_REQUIRED", "請填寫改期原因（最少 4 個字）");

  const run = db.transaction(() => {
    const old = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId);
    if (!old) throw new ActionError("BOOKING_NOT_FOUND", "找不到預約", 404);
    if (!["confirmed", "pending_payment"].includes(old.status))
      throw new ActionError("BOOKING_STATUS_INVALID", `此預約狀態（${old.status}）不可改期`, 409);

    const target = db
      .prepare(
        `SELECT cs.id, cs.class_id, cs.start_time, cs.status, cs.enrolled_count, cs.max_participants
           FROM class_schedules cs WHERE cs.id=?`,
      )
      .get(newScheduleId);
    if (!target) throw new ActionError("SCHEDULE_NOT_FOUND", "找不到目標班次", 404);
    if (target.class_id !== old.class_id) throw new ActionError("CLASS_MISMATCH", "只可以改去同一課程嘅班次");
    if (target.status === "cancelled") throw new ActionError("SCHEDULE_CANCELLED", "目標班次已取消");
    if (new Date(String(target.start_time).replace(" ", "T") + "Z") <= new Date())
      throw new ActionError("SCHEDULE_PAST", "不可以改去已開始的班次");
    if (target.id === old.schedule_id) throw new ActionError("SAME_SCHEDULE", "新舊班次相同");

    // 同行座位：同一用戶同一班的所有有效 booking 一齊搬
    const group = db
      .prepare(
        `SELECT * FROM bookings WHERE user_id=? AND schedule_id=? AND status IN ('confirmed','pending_payment') ORDER BY created_at`,
      )
      .all(old.user_id, old.schedule_id);
    const seats = group.length || 1;

    // 原子扣新班名額（避免超賣）
    const upd = db
      .prepare(
        "UPDATE class_schedules SET enrolled_count = enrolled_count + ? WHERE id=? AND enrolled_count + ? <= max_participants",
      )
      .run(seats, target.id, seats);
    if (upd.changes === 0) throw new ActionError("CLASS_FULL", "目標班次名額不足", 409);

    // 釋放舊班名額
    db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - ?) WHERE id=?").run(seats, old.schedule_id);

    const makeRef = nextRefFactory(db);
    const newIds = [];
    for (const b of group) {
      const id = uuidv4();
      const split = splitAmount(b.amount, b.platform_commission_rate);
      db.prepare(
        `INSERT INTO bookings
          (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount,
           payment_method, fps_reference, payme_reference, group_size, group_invite_code,
           venue_partner_id, platform_commission_rate, venue_earned_amount, platform_earned_amount,
           amount_cents, venue_earned_amount_cents, platform_earned_amount_cents)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id, makeRef(), b.user_id, target.id, b.class_id, b.payment_type, b.payment_status,
        b.status === "pending_payment" ? "pending_payment" : "confirmed",
        money(b.amount), b.payment_method || null, b.fps_reference || null, b.payme_reference || null,
        b.group_size || 1, b.group_invite_code || null,
        b.venue_partner_id || null, split.rate, split.venue, split.platform,
        Math.round(money(b.amount) * 100), Math.round(split.venue * 100), Math.round(split.platform * 100),
      );
      newIds.push(id);
      db.prepare("UPDATE bookings SET status='cancelled', cancel_reason=? WHERE id=?").run(
        `rescheduled: ${String(reason).slice(0, 160)}`, b.id,
      );
    }

    audit(db, {
      action: "booking.rescheduled",
      entityId: old.id,
      actorId,
      values: {
        old_booking_ids: group.map((b) => b.id),
        new_booking_ids: newIds,
        old_schedule_id: old.schedule_id,
        new_schedule_id: target.id,
        seats,
        reason: String(reason).slice(0, 200),
      },
      description: `改期 ${group.map((b) => b.booking_reference).join("、")} → ${target.id}（${seats} 位）`,
      ip, ua,
    });

    return { old_booking_ids: group.map((b) => b.id), new_booking_ids: newIds, seats, new_schedule_id: target.id };
  });

  return run();
}

// ===== 加位升級：補 HK$100 → 多開 1 個位（朋友建訪客帳號，名冊可分開顯示） =====
function upgradeSeats(db, { bookingId, friendName, friendPhone, topUpAmount, paymentReference, actorId, ip, ua }) {
  const amount = money(topUpAmount);
  if (!bookingId) throw new ActionError("INVALID_INPUT", "缺少 booking");
  const name = String(friendName || "").trim();
  if (name.length < 2) throw new ActionError("FRIEND_NAME_REQUIRED", "請填寫朋友姓名（最少 2 個字）");
  const phone = normPhone(friendPhone);
  if (!/^[4-9]\d{7}$/.test(phone)) throw new ActionError("FRIEND_PHONE_INVALID", "朋友電話必須為 8 位香港手機號碼");
  if (amount !== 100) throw new ActionError("TOPUP_AMOUNT_INVALID", "二人同行補款固定為 HK$100");
  if (!paymentReference || String(paymentReference).trim().length < 3)
    throw new ActionError("PAYMENT_REF_REQUIRED", "請填寫 FPS 交易參考");

  const run = db.transaction(() => {
    const old = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId);
    if (!old) throw new ActionError("BOOKING_NOT_FOUND", "找不到預約", 404);
    if (!["confirmed", "pending_payment"].includes(old.status))
      throw new ActionError("BOOKING_STATUS_INVALID", `此預約狀態（${old.status}）不可加位`, 409);
    if (old.payment_status !== "paid")
      throw new ActionError("BOOKING_NOT_PAID", "原預約未付款，請先核實付款才可加位", 409);

    const existing = db.prepare("SELECT id FROM users WHERE phone=?").get(phone);
    if (existing) throw new ActionError("FRIEND_PHONE_EXISTS", "此電話已有帳戶，請朋友自行報名或提供另一個電話", 409);

    const sched = db
      .prepare("SELECT id, start_time, status, enrolled_count, max_participants FROM class_schedules WHERE id=?")
      .get(old.schedule_id);
    if (!sched) throw new ActionError("SCHEDULE_NOT_FOUND", "找不到班次", 404);
    if (sched.status === "cancelled") throw new ActionError("SCHEDULE_CANCELLED", "班次已取消");
    if (new Date(String(sched.start_time).replace(" ", "T") + "Z") <= new Date())
      throw new ActionError("SCHEDULE_PAST", "班次已開始，不可加位");

    const upd = db
      .prepare(
        "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id=? AND enrolled_count + 1 <= max_participants",
      )
      .run(sched.id);
    if (upd.changes === 0) throw new ActionError("CLASS_FULL", "班次已滿", 409);

    // 朋友建獨立訪客帳號（無法登入），令點名單可分開顯示姓名
    const friendId = uuidv4();
    const email = `guest+${friendId.slice(0, 8)}@guest.zenpass.local`;
    const hash = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10);
    const ref = "G" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
    db.prepare(
      `INSERT INTO users (id, user_reference, email, password_hash, name, phone, auth_provider, email_verified, agree_terms, penalty_consent, role, lead_source, tags)
       VALUES (?,?,?,?,?,?,'email',1,1,1,'user','admin_upgrade','guest')`,
    ).run(friendId, ref, email, hash, name, phone);

    const makeRef = nextRefFactory(db);
    const newId = uuidv4();
    const split = splitAmount(amount, old.platform_commission_rate);
    db.prepare(
      `INSERT INTO bookings
        (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount,
         payment_method, fps_reference, group_size, venue_partner_id, platform_commission_rate,
         venue_earned_amount, platform_earned_amount, amount_cents, venue_earned_amount_cents, platform_earned_amount_cents)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      newId, makeRef(), friendId, old.schedule_id, old.class_id, old.payment_type, "paid", "confirmed",
      amount, "fps", String(paymentReference).trim(), 1,
      old.venue_partner_id || null, split.rate, split.venue, split.platform,
      Math.round(amount * 100), Math.round(split.venue * 100), Math.round(split.platform * 100),
    );

    audit(db, {
      action: "booking.upgraded_seats",
      entityId: old.id,
      actorId,
      values: {
        original_booking_id: old.id,
        new_booking_id: newId,
        friend_name: name,
        friend_phone: phone,
        top_up_amount: amount,
        payment_reference: String(paymentReference).trim(),
      },
      description: `加位：${old.booking_reference} + 1 位（${name}），補 HK$${amount}`,
      ip, ua,
    });

    return { original_booking_id: old.id, new_booking_id: newId, friend_user_id: friendId, top_up_amount: amount };
  });

  return run();
}

module.exports = { rescheduleBooking, upgradeSeats, ActionError };
