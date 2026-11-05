/**
 * ZenPass — 管理員預約操作（改期 / 加位升級）
 * 全部喺 SQLite transaction 內完成，任何一步失敗即 rollback。
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { notifySponsor } = require("./sponsor-notify");

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


// ===== 現場簽到（櫃檯／客服）＋ 子女報平安連結 =====
function checkInBooking(db, { bookingId, actorId, ip, ua }) {
  const run = db.transaction(() => {
    const b = db
      .prepare(
        `SELECT b.*, u.name AS booker_name, u.phone AS booker_phone,
                c.title, c.venue_name, u2.name AS coach_name,
                cs.end_time
           FROM bookings b
           JOIN users u ON u.id = b.user_id
           LEFT JOIN users u2 ON u2.id = (SELECT coach_id FROM classes WHERE id=b.class_id)
           JOIN classes c ON c.id = b.class_id
           JOIN class_schedules cs ON cs.id = b.schedule_id
          WHERE b.id = ?`,
      )
      .get(bookingId);
    if (!b) throw new ActionError("BOOKING_NOT_FOUND", "找不到預約", 404);
    if (b.status === "attended") throw new ActionError("ALREADY_CHECKED_IN", "此學員已簽到", 409);
    if (b.status === "cancelled") throw new ActionError("BOOKING_CANCELLED", "已取消的預約不可簽到", 409);
    if (b.status !== "confirmed") throw new ActionError("BOOKING_NOT_CONFIRMED", "預約未確認，不可簽到", 409);
    if (b.payment_status !== "paid") throw new ActionError("BOOKING_NOT_PAID", "未付款不可簽到", 409);

    db.prepare(
      "UPDATE bookings SET status='attended', checked_in_at=datetime('now'), checkin_method='admin' WHERE id=?",
    ).run(b.id);

    audit(db, {
      action: "booking.checked_in", entityId: b.id, actorId,
      values: { method: "admin", attendee_type: b.attendee_type, parent_name: b.parent_name || null },
      description: `現場簽到：${b.booking_reference}（${b.parent_name || b.booker_name}）`, ip, ua,
    });

    let sponsor = null;
    const attendeeName = b.attendee_type === "parent" && b.parent_name ? b.parent_name : b.booker_name;
    if (b.attendee_type === "parent" && Number(b.notify_sponsor_on_checkin) === 1 && b.booker_phone) {
      const rawEnd = String(b.end_time);
      const end = /[zZ]$|[+-]\d\d:?\d\d$/.test(rawEnd) ? new Date(rawEnd) : new Date(rawEnd.replace(" ", "T") + "Z");
      const endHKT = new Date(end.getTime() + 8 * 3600e3);
      const hhmm = `${String(endHKT.getUTCHours()).padStart(2, "0")}:${String(endHKT.getUTCMinutes()).padStart(2, "0")}`;
      const text =
        `【ZenPass 課堂報平安】您為 ${attendeeName} 預約的${b.title}班已順利簽到！` +
        `目前精神良好，由${b.coach_name || "導師"}親自帶領，預計 ${hhmm} 下課，請放心 🌿`;
      const phone = normPhone(b.booker_phone);
      sponsor = {
        phone,
        message: text,
        wa_url: /^[4-9]\d{7}$/.test(phone) ? `https://wa.me/852${phone}?text=${encodeURIComponent(text)}` : null,
      };
      audit(db, {
        action: "checkin.sponsor_notified", entityId: b.id, actorId,
        values: { parent_name: attendeeName, sponsor_phone: phone, booking_reference: b.booking_reference },
        description: `簽到報平安：${attendeeName} → ${phone}`, ip, ua,
      });
      sponsor._push = { userId: b.user_id, name: attendeeName, text, bookingId: b.id, coach: b.coach_name };
    }

    return { booking_id: b.id, attendee_name: attendeeName, sponsor };
  });
  const result = run();
  if (result.sponsor && result.sponsor._push) {
    const p = result.sponsor._push;
    delete result.sponsor._push;
    result.sponsor.push_queued = true;
    notifySponsor({ userId: p.userId, parentName: p.name, text: p.text, bookingId: p.bookingId, coachName: p.coach })
      .then((push) => {
        if (push && push.sent > 0) {
          try {
            audit(db, {
              action: "checkin.sponsor_push", entityId: p.bookingId, actorId,
              values: { parent_name: p.name, sent: push.sent },
              description: `簽到 Push 報平安：${p.name}`, ip, ua,
            });
          } catch (e) { console.error("sponsor push audit:", e.message); }
        }
      })
      .catch((e) => console.error("sponsor push:", e.message));
  }
  return result;
}

module.exports = { rescheduleBooking, upgradeSeats, checkInBooking, ActionError };
