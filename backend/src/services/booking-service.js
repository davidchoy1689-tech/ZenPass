/**
 * ZenPass 禪流 - 預約服務層
 * 從 routes/bookings.js 抽出嘅所有 Business Logic
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const { sendNotification } = require("./notification");
const { processRefund } = require("./refund");
const { audit, trackBookingChange, trackPaymentChange } = require("./audit");
const { writeBlock } = require("./blockchain-audit");

// ==================== Helpers ====================

function generateBookingRef() {
  const db = getDb();
  const max =
    db
      .prepare(
        "SELECT MAX(CAST(SUBSTR(booking_reference, 4) AS INTEGER)) as m FROM bookings WHERE booking_reference GLOB 'ZP-[0-9]*'",
      )
      .get().m || 0;
  return "ZP-" + String(max + 1).padStart(4, "0");
}

const TRIAL_WINDOW_DAYS = 7;
const TRIAL_MAX_COUNT = 30;

// ==================== Penalty Consent ====================

function checkPenaltyConsent(db, userId, penaltyConsent) {
  const userConsent = db
    .prepare("SELECT penalty_consent FROM users WHERE id = ?")
    .get(userId);
  if (!userConsent || !userConsent.penalty_consent) {
    if (penaltyConsent) {
      db.prepare("UPDATE users SET penalty_consent = 1 WHERE id = ?").run(
        userId,
      );
      return { ok: true };
    }
    return {
      ok: false,
      error: "請先同意缺席/遲取消罰款規則",
      code: "PENALTY_CONSENT_REQUIRED",
    };
  }
  return { ok: true };
}

// ==================== Trial Checks ====================

function checkTrialCreditEligibility(db, userId, classId) {
  const classData = db
    .prepare("SELECT credits_cost FROM classes WHERE id = ?")
    .get(classId);
  const neededCredits = classData?.credits_cost || 12;
  const userCredits = db
    .prepare("SELECT credits FROM users WHERE id = ?")
    .get(userId);
  if (!userCredits || userCredits.credits < neededCredits) {
    return {
      ok: false,
      error: `試玩預約需要至少 ${neededCredits} Credits 作為按金，你目前有 ${userCredits?.credits || 0} Credits。請先購買 Credits。`,
      required_credits: neededCredits,
      current_credits: userCredits?.credits || 0,
    };
  }
  return { ok: true, neededCredits };
}

function checkTrialEligibility(db, userId) {
  const user = db
    .prepare("SELECT role, created_at FROM users WHERE id = ?")
    .get(userId);
  if (!user || user.role !== "user") {
    return { ok: false, error: "試玩只限學生帳號" };
  }
  const regDate = new Date(user.created_at);
  const now = new Date();
  const daysSinceReg = Math.floor((now - regDate) / (1000 * 60 * 60 * 24));
  if (daysSinceReg >= TRIAL_WINDOW_DAYS) {
    return { ok: false, error: "試玩期已過（7天限）" };
  }
  const trialCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM bookings WHERE user_id = ? AND payment_type = 'membership_trial' AND status != 'cancelled'`,
    )
    .get(userId);
  if (trialCount.cnt >= TRIAL_MAX_COUNT) {
    return {
      ok: false,
      error: "試玩次數已滿，請聯絡 info@hklfcl.com",
    };
  }
  return { ok: true };
}

function getTrialStatus(db, userId) {
  const user = db
    .prepare("SELECT id, role, created_at FROM users WHERE id = ?")
    .get(userId);
  if (!user || user.role !== "user") {
    return { eligible: false, reason: "只限學生帳號試玩" };
  }
  const regDate = new Date(user.created_at);
  const now = new Date();
  const daysSinceReg = Math.floor((now - regDate) / (1000 * 60 * 60 * 24));
  const withinWindow = daysSinceReg < TRIAL_WINDOW_DAYS;
  const trialCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM bookings WHERE user_id = ? AND payment_type = 'membership_trial' AND status != 'cancelled'`,
    )
    .get(userId);
  const usedCount = trialCount.cnt;
  const remainingCount = Math.max(0, TRIAL_MAX_COUNT - usedCount);
  const hasRemaining = remainingCount > 0;
  const expiryDate = new Date(regDate);
  expiryDate.setDate(expiryDate.getDate() + TRIAL_WINDOW_DAYS);

  return {
    eligible: withinWindow && hasRemaining,
    trial_used: usedCount > 0,
    days_remaining: Math.max(0, TRIAL_WINDOW_DAYS - daysSinceReg),
    trial_window_days: TRIAL_WINDOW_DAYS,
    expires_at: expiryDate.toISOString(),
    reason: !withinWindow ? "試玩期已過" : !hasRemaining ? "" : "",
  };
}

// ==================== Schedule / Capacity ====================

function releaseExpiredHolds(db, scheduleId) {
  const expiredHolds = db
    .prepare(
      `UPDATE bookings SET status = 'cancelled', payment_status = 'refunded'
       WHERE schedule_id = ? AND status = 'pending_payment'
       AND fps_reference IS NULL AND payme_reference IS NULL
       AND created_at < datetime('now', '-15 minutes')`,
    )
    .run(scheduleId);
  if (expiredHolds.changes > 0) {
    db.prepare(
      "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - ?) WHERE id = ?",
    ).run(expiredHolds.changes, scheduleId);
  }
  return expiredHolds;
}

function incrementEnrolledCount(db, scheduleId) {
  return db
    .prepare(
      "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ? AND enrolled_count < max_participants",
    )
    .run(scheduleId);
}

function findExistingBookingForUser(db, userId, scheduleId) {
  return db
    .prepare(
      `SELECT id, status, payment_status FROM bookings
       WHERE user_id = ? AND schedule_id = ? AND (status = 'confirmed' OR status = 'pending_payment')`,
    )
    .get(userId, scheduleId);
}

// ==================== Payment Processing ====================

function deductCredits(db, userId, classId) {
  const classData = db
    .prepare("SELECT credits_cost FROM classes WHERE id = ?")
    .get(classId);
  if (!classData) return { ok: false, error: "課程不存在" };
  const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
  if (user.credits < classData.credits_cost) {
    return { ok: false, error: "點數不足，請先購買點數" };
  }
  db.prepare("UPDATE users SET credits = credits - ? WHERE id = ?").run(
    classData.credits_cost,
    userId,
  );
  return { ok: true, creditsCost: classData.credits_cost };
}

function processCorporatePayment(db, userId, classId) {
  const classData = db
    .prepare("SELECT credits_cost FROM classes WHERE id = ?")
    .get(classId);
  if (!classData) return { ok: false, error: "課程不存在" };
  const needed = classData.credits_cost || 12;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

  const corpMember = db
    .prepare(
      `SELECT cm.*, cc.name as company_name, cc.credit_pool, cc.credit_used
       FROM corporate_members cm
       JOIN corporate_companies cc ON cm.company_id = cc.id
       WHERE cm.user_id = ? AND cm.status = 'active' AND cc.status = 'active'`,
    )
    .get(userId);

  if (!corpMember) {
    return { ok: false, error: "你不是企業員工" };
  }

  let fromCompany = 0;
  let fromPersonal = 0;
  const availablePool = corpMember.credit_pool - corpMember.credit_used;
  const monthlyLimit = corpMember.monthly_credit_limit || 999999;
  const monthlyUsed = corpMember.monthly_credit_used || 0;
  const monthlyRemaining = monthlyLimit - monthlyUsed;

  if (availablePool <= 0 && (user.credits || 0) < needed) {
    return {
      ok: false,
      error: "公司 Credits 不足，你的個人 Credits 亦不足夠",
    };
  }

  if (availablePool > 0 && monthlyRemaining > 0) {
    fromCompany = Math.min(needed, availablePool, monthlyRemaining);
  }

  if (fromCompany < needed) {
    const remaining = needed - fromCompany;
    if ((user.credits || 0) >= remaining) {
      fromPersonal = remaining;
    } else {
      return {
        ok: false,
        error: `公司 Credits 不足（可用 ${availablePool} cr，月剩 ${monthlyRemaining} cr），你亦只有 ${user.credits || 0} 個人 Credits`,
      };
    }
  }

  if (fromCompany > 0) {
    db.prepare(
      "UPDATE corporate_companies SET credit_used = credit_used + ?, updated_at = datetime('now') WHERE id = ?",
    ).run(fromCompany, corpMember.company_id);
    db.prepare(
      "UPDATE corporate_members SET monthly_credit_used = COALESCE(monthly_credit_used, 0) + ?, updated_at = datetime('now') WHERE user_id = ? AND company_id = ?",
    ).run(fromCompany, userId, corpMember.company_id);
  }

  if (fromPersonal > 0) {
    db.prepare("UPDATE users SET credits = credits - ? WHERE id = ?").run(
      fromPersonal,
      userId,
    );
  }

  return {
    ok: true,
    deduction: {
      from_company: fromCompany,
      from_personal: fromPersonal,
      company_name: corpMember.company_name,
    },
  };
}

// ==================== Partner Commission ====================

function computePartnerCommission(db, classId, amount) {
  try {
    const partnerVenue = db
      .prepare(
        `SELECT pv.id, pv.commission_rate, pv.commission_plan, pv.name as venue_name
         FROM classes c
         JOIN partner_venues pv ON c.partner_venue_id = pv.id
         WHERE c.id = ? AND pv.status = 'active'`,
      )
      .get(classId);
    if (partnerVenue) {
      const planKey = partnerVenue.commission_plan || "basic";
      const planRates = { basic: 0.25, standard: 0.18, premium: 0.12 };
      const planRate =
        planRates[planKey] || partnerVenue.commission_rate || 0.25;
      const platformEarned =
        Math.round(amount * planRate * 100) / 100;
      const venueEarned =
        Math.round(amount * (1 - planRate) * 100) / 100;
      return {
        venue: partnerVenue,
        commissionRate: planRate,
        venueEarned,
        platformEarned,
      };
    }
  } catch (e) {
    // Non-critical
  }
  return null;
}

// ==================== Insert Booking ====================

function insertBookingRow(db, bookingData, partnerInfo) {
  const {
    bookingId,
    bookingRef,
    userId,
    scheduleId,
    classId,
    paymentType,
    paymentStatus,
    bookingStatus,
    amount,
  } = bookingData;

  if (partnerInfo) {
    db.prepare(
      `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount, venue_partner_id, platform_commission_rate, venue_earned_amount, platform_earned_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bookingId,
      bookingRef,
      userId,
      scheduleId,
      classId,
      paymentType,
      paymentStatus,
      bookingStatus,
      amount,
      partnerInfo.venue.id,
      partnerInfo.commissionRate,
      partnerInfo.venueEarned,
      partnerInfo.platformEarned,
    );
  } else {
    db.prepare(
      `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bookingId,
      bookingRef,
      userId,
      scheduleId,
      classId,
      paymentType,
      paymentStatus,
      bookingStatus,
      amount,
    );
  }
}

// ==================== Notifications (fire-and-forget) ====================

function sendBookingNotifications(req, bookingId, classInfo, coachInfo, scheduleTimes, className, bookingStatus, amount) {
  if (classInfo) {
    setTimeout(async () => {
      try {
        sendNotification("booking.confirmed", {
          recipient: req.user.id,
          data: {
            class_title: classInfo?.title || "—",
            date: scheduleTimes?.start_time
              ? scheduleTimes.start_time.split("T")[0]
              : "—",
            time: scheduleTimes?.start_time
              ? scheduleTimes.start_time.split("T")[1]?.slice(0, 5)
              : "—",
            venue: classInfo?.venue_name || "—",
            coach_name: coachInfo?.name || "—",
          },
        });
      } catch (notifErr) {
        console.error("⚠️ 發送通知失敗:", notifErr.message);
      }

      if (bookingStatus !== "pending_payment" && classInfo?.coach_id) {
        try {
          sendNotification("coach.new_booking", {
            recipient: classInfo.coach_id,
            data: {
              student_name: req.user.name || "學生",
              class_title: classInfo?.title || "—",
              date: scheduleTimes?.start_time
                ? scheduleTimes.start_time.split("T")[0]
                : "—",
              time: scheduleTimes?.start_time
                ? scheduleTimes.start_time.split("T")[1]?.slice(0, 5)
                : "—",
              amount: amount || classInfo?.price_hkd || "—",
            },
          });
        } catch (notifErr) {
          console.error("⚠️ 發送教練通知失敗:", notifErr.message);
        }
      }
    }, 0);
  }
}

function trackUserActionAsync(userId, classId, category) {
  try {
    const { trackUserAction } = require("./recommendation");
    trackUserAction(userId, "book_class", {
      class_id: classId,
      category: category || null,
    });
  } catch (trackErr) {
    // Non-critical
  }
}

function trackBookingAudit(bookingId, userId, oldStatus, newStatus, req) {
  try {
    trackBookingChange(bookingId, userId, oldStatus, newStatus, req);
  } catch (auditErr) {
    console.error("⚠️ Audit record failed:", auditErr.message);
  }
}

function writeBookingBlock(data) {
  try {
    writeBlock({
      entityType: "booking",
      entityId: data.entityId,
      data: data.blockData,
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }
}

// ==================== Core: Create Booking ====================

function createBooking(req) {
  const { schedule_id, class_id, payment_type, amount, penalty_consent } =
    req.body;

  if (!schedule_id || !class_id || !payment_type) {
    return { status: 400, body: { success: false, error: "缺少預約資料" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  // 1. Penalty consent
  const consent = checkPenaltyConsent(db, req.user.id, penalty_consent);
  if (!consent.ok) {
    return { status: 400, body: { error: consent.error, code: consent.code } };
  }

  // 2. Trial checks
  if (payment_type === "membership_trial") {
    const creditCheck = checkTrialCreditEligibility(db, req.user.id, class_id);
    if (!creditCheck.ok) {
      return { status: 400, body: { error: creditCheck.error, required_credits: creditCheck.required_credits, current_credits: creditCheck.current_credits } };
    }
    const trialCheck = checkTrialEligibility(db, req.user.id);
    if (!trialCheck.ok) {
      return { status: 403, body: { success: false, error: trialCheck.error } };
    }
  }

  // 3. Validate schedule
  const schedule = db
    .prepare(
      "SELECT * FROM class_schedules WHERE id = ? AND status = 'available'",
    )
    .get(schedule_id);
  if (!schedule) {
    return { status: 404, body: { success: false, error: "該時段不存在或已滿" } };
  }

  // 4. Release expired holds
  releaseExpiredHolds(db, schedule_id);

  // 5. Capacity check (atomic)
  const capResult = incrementEnrolledCount(db, schedule_id);
  if (capResult.changes === 0) {
    return { status: 400, body: { success: false, error: "該時段已滿額" } };
  }

  // 6. Duplicate check
  const existing = findExistingBookingForUser(db, req.user.id, schedule_id);
  if (existing) {
    if (existing.status === "pending_payment") {
      return {
        status: 200,
        body: {
          message: "你有一個未完成付款的預約，請繼續付款",
          booking_id: existing.id,
          status: "pending_payment",
          requires_payment: true,
        },
      };
    }
    return { status: 409, body: { success: false, error: "你已經預約了此課程時段" } };
  }

  // 7. Payment processing
  let corporateDeduction = null;
  if (payment_type === "credits") {
    const result = deductCredits(db, req.user.id, class_id);
    if (!result.ok) {
      return { status: 400, body: { success: false, error: result.error } };
    }
  }

  if (payment_type === "corporate") {
    const result = processCorporatePayment(db, req.user.id, class_id);
    if (!result.ok) {
      return { status: 400, body: { error: result.error } };
    }
    corporateDeduction = result.deduction;
  }

  // 8. Partner commission
  const partnerInfo = computePartnerCommission(db, class_id, amount || 0);

  // 9. Create booking record
  const bookingId = uuidv4();
  const bookingRef = generateBookingRef();
  const bookingStatus =
    payment_type === "single" ? "pending_payment" : "confirmed";
  const paymentStatus = payment_type === "single" ? "pending" : "paid";

  insertBookingRow(
    db,
    { bookingId, bookingRef, userId: req.user.id, scheduleId: schedule_id, classId: class_id, paymentType: payment_type, paymentStatus, bookingStatus, amount: amount || 0 },
    partnerInfo,
  );

  // 10. Read related info
  let classInfo, coachInfo, scheduleTimes;
  try {
    classInfo = db
      .prepare(
        "SELECT title, venue_name, coach_id, price_hkd, category FROM classes WHERE id = ?",
      )
      .get(class_id);
    coachInfo = db
      .prepare("SELECT name FROM users WHERE id = ?")
      .get(classInfo?.coach_id || null);
    scheduleTimes = db
      .prepare("SELECT start_time, end_time FROM class_schedules WHERE id = ?")
      .get(schedule_id);
  } catch (e) {
    // Non-critical
  }

  // 11. Fire-and-forget: notifications, tracking, audit, blockchain
  sendBookingNotifications(req, bookingId, classInfo, coachInfo, scheduleTimes, null, bookingStatus, amount);
  trackUserActionAsync(req.user.id, class_id, classInfo?.category);
  trackBookingAudit(bookingId, req.user.id, null, bookingStatus, req);

  writeBookingBlock({
    entityId: bookingId,
    blockData: {
      booking_reference: bookingRef,
      user_id: req.user.id,
      class_id,
      schedule_id,
      amount: amount || 0,
      payment_type,
      status: bookingStatus,
      payment_status: paymentStatus,
      action: "created",
    },
  });

  return {
    status: 201,
    body: {
      message:
        "預約成功" +
        (bookingStatus === "pending_payment" ? "，請完成付款" : ""),
      booking_id: bookingId,
      booking_reference: bookingRef,
      status: bookingStatus,
      payment_status: paymentStatus,
      requires_payment: bookingStatus === "pending_payment",
      class: classInfo
        ? {
            title: classInfo.title,
            venue: classInfo.venue_name,
            price: classInfo.price_hkd,
          }
        : null,
      schedule: scheduleTimes
        ? {
            start_time: scheduleTimes.start_time,
            end_time: scheduleTimes.end_time,
          }
        : null,
      corporate: corporateDeduction || null,
    },
  };
}

// ==================== Complete Payment ====================

function completePayment(req) {
  const { payment_method, payment_reference, amount } = req.body;
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const booking = db
    .prepare(
      "SELECT * FROM bookings WHERE id = ? AND user_id = ? AND status = 'pending_payment'",
    )
    .get(req.params.id, req.user.id);

  if (!booking) {
    return { status: 404, body: { success: false, error: "未找到待付款的預約" } };
  }

  // Update booking
  const updateFields = [
    "status = 'confirmed'",
    "payment_status = 'paid'",
    "amount = ?",
  ];
  const updateParams = [amount || booking.amount || 0];

  if (payment_method === "stripe" && payment_reference) {
    updateFields.push("stripe_payment_intent_id = ?");
    updateParams.push(payment_reference);
  } else if (payment_method === "fps" && payment_reference) {
    updateFields.push("fps_reference = ?");
    updateParams.push(payment_reference);
  } else if (payment_method === "payme" && payment_reference) {
    updateFields.push("payme_reference = ?");
    updateParams.push(payment_reference);
  }

  updateParams.push(req.params.id);
  db.prepare(
    `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ?`,
  ).run(...updateParams);

  // Record transaction
  const refField =
    payment_method === "stripe"
      ? "stripe_payment_intent_id"
      : payment_method === "fps"
        ? "fps_reference"
        : "payme_reference";

  db.prepare(
    `INSERT INTO transactions (id, user_id, type, amount, payment_method, ${refField}, status)
     VALUES (?, ?, 'single_booking', ?, ?, ?, 'completed')`,
  ).run(
    uuidv4(),
    req.user.id,
    amount || booking.amount || 0,
    payment_method || "fps",
    payment_reference || null,
  );

  // Notifications
  const classDataNotif = db
    .prepare("SELECT title FROM classes WHERE id = ?")
    .get(booking.class_id);
  try {
    sendNotification("booking.confirmed", {
      recipient: req.user.id,
      data: {
        class_title: classDataNotif?.title || "—",
        date: "—",
        time: "—",
        venue: "—",
        coach_name: "—",
      },
    });
    sendNotification("coach.new_booking", {
      recipient: null,
      data: {
        student_name: req.user.name || "學生",
        class_title: classDataNotif?.title || "—",
      },
    });
  } catch (notifErr) {
    console.error("⚠️ 發送通知失敗:", notifErr.message);
  }

  // Audit
  try {
    trackPaymentChange(
      req.params.id,
      req.user.id,
      "pending",
      "paid",
      amount || booking.amount || 0,
      payment_method || "fps",
      req,
    );
  } catch (auditErr) {
    console.error("⚠️ Audit record failed:", auditErr.message);
  }

  // Blockchain
  try {
    writeBlock({
      entityType: "booking",
      entityId: booking.id,
      data: {
        booking_reference: booking.booking_reference,
        user_id: req.user.id,
        class_id: booking.class_id,
        schedule_id: booking.schedule_id,
        amount: amount || booking.amount || 0,
        payment_method: payment_method || "fps",
        payment_reference: payment_reference || null,
        status: "confirmed",
        payment_status: "paid",
        action: "payment_completed",
      },
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }

  return {
    status: 200,
    body: {
      message: "付款成功，預約已確認！",
      booking_id: booking.id,
      status: "confirmed",
      payment_status: "paid",
    },
  };
}

// ==================== Cancel Booking ====================

function cancelBooking(req) {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  const { reason } = req.body;

  const booking = db
    .prepare(
      `SELECT b.*, cs.start_time FROM bookings b
       JOIN class_schedules cs ON b.schedule_id = cs.id
       WHERE b.id = ? AND b.user_id = ?`,
    )
    .get(req.params.id, req.user.id);

  if (!booking) {
    return { status: 404, body: { success: false, error: "預約不存在" } };
  }

  const isPendingPayment = booking.status === "pending_payment";

  if (!isPendingPayment) {
    const now = new Date();
    const classTime = new Date(booking.start_time);
    const hoursUntilClass = (classTime - now) / (1000 * 60 * 60);

    if (hoursUntilClass < 2) {
      return {
        status: 400,
        body: { error: "開課前 2 小時內無法取消預約（太遲）" },
      };
    }

    if (hoursUntilClass < 12) {
      return _processLateCancel(db, booking, hoursUntilClass, reason, req);
    }
  }

  return _processNormalCancel(db, booking, reason, req);
}

function _processLateCancel(db, booking, hoursUntilClass, reason, req) {
  db.prepare(
    "UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?",
  ).run(reason || null, booking.id);
  db.prepare(
    "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?",
  ).run(booking.schedule_id);

  // Notify waitlist
  try {
    const { autoNotifyOnCancel } = require("../routes/waitlist");
    autoNotifyOnCancel(booking.schedule_id);
  } catch (e) {}

  // Penalty log
  try {
    const classCost = db
      .prepare("SELECT credits_cost FROM classes WHERE id = ?")
      .get(booking.class_id);
    db.prepare(
      `INSERT INTO penalty_logs (id, booking_id, user_id, type, class_cost, penalty_credits, status, reason, created_at)
       VALUES (?, ?, ?, 'late_cancel', ?, 0, 'applied', ?, datetime('now'))`,
    ).run(
      uuidv4(),
      booking.id,
      req.user.id,
      classCost?.credits_cost || 0,
      `遲取消（${hoursUntilClass.toFixed(1)}小時前）：已使用的 ${classCost?.credits_cost || 0} Credits 唔退還`,
    );
  } catch (e) {
    console.error("[PENALTY] late-cancel log error:", e.message);
  }

  // Audit
  try {
    trackBookingChange(booking.id, req.user.id, booking.status, "cancelled", req);
  } catch (e) {}

  // Blockchain
  try {
    writeBlock({
      entityType: "booking",
      entityId: booking.id,
      data: {
        booking_reference: booking.booking_reference,
        user_id: req.user.id,
        class_id: booking.class_id,
        schedule_id: booking.schedule_id,
        amount: booking.amount || 0,
        status: "cancelled",
        action: "late_cancelled",
        hours_before_class: hoursUntilClass,
        credits_forfeited: true,
        refunded: false,
      },
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }

  // Notification
  try {
    sendNotification("booking.cancelled", {
      recipient: req.user.id,
      data: {
        booking_reference: booking.booking_reference,
        class_title: booking.class_title || "your class",
        date: booking.start_time || "",
      },
    });
  } catch (e) {}

  return {
    status: 200,
    body: {
      message:
        "預約已取消（遲取消）。由於距離開課不足 12 小時，已使用的 Credits 唔會退還。",
      late_cancel: true,
      credits_forfeited: true,
    },
  };
}

function _processNormalCancel(db, booking, reason, req) {
  db.prepare(
    "UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?",
  ).run(reason || null, booking.id);

  db.prepare(
    "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?",
  ).run(booking.schedule_id);

  // Notify waitlist
  try {
    const { autoNotifyOnCancel } = require("../routes/waitlist");
    autoNotifyOnCancel(booking.schedule_id);
  } catch (e) {}

  // Refund credits
  if (booking.payment_type === "credits") {
    const classData = db
      .prepare("SELECT credits_cost FROM classes WHERE id = ?")
      .get(booking.class_id);
    if (classData) {
      db.prepare(
        "UPDATE users SET credits = credits + ? WHERE id = ?",
      ).run(classData.credits_cost, req.user.id);
    }
  }

  // Refund money if paid
  if (booking.payment_status === "paid" && booking.amount > 0) {
    try {
      const refundResult = processRefund({
        bookingId: req.params.id,
        amount: booking.amount,
        reason: "用戶取消預約",
        initiatedBy: req.user.id,
        approvedBy: "system",
        method: booking.payment_method || "fps",
      });
      console.log("[REFUND] Auto-refund:", refundResult.refund_id);

      if (refundResult.success) {
        try {
          writeBlock({
            entityType: "refund",
            entityId: refundResult.refund_id,
            data: {
              refund_id: refundResult.refund_id,
              booking_id: req.params.id,
              user_id: req.user.id,
              amount: booking.amount,
              currency: "HKD",
              payment_method: booking.payment_method || "fps",
              reason: "用戶取消預約",
              initiated_by: req.user.id,
              approved_by: "system",
              status: "completed",
            },
          });
        } catch (bcErr) {
          console.error(
            "⚠️ Blockchain write failed (auto-refund):",
            bcErr.message,
          );
        }
      }
    } catch (refundErr) {
      console.error("⚠️ Auto-refund failed:", refundErr.message);
    }
  }

  // Audit
  try {
    trackBookingChange(booking.id, req.user.id, booking.status, "cancelled", req);
  } catch (auditErr) {
    console.error("⚠️ Audit record failed:", auditErr.message);
  }

  // Blockchain
  try {
    writeBlock({
      entityType: "booking",
      entityId: booking.id,
      data: {
        booking_reference: booking.booking_reference,
        user_id: req.user.id,
        class_id: booking.class_id,
        schedule_id: booking.schedule_id,
        amount: booking.amount || 0,
        payment_type: booking.payment_type,
        status: "cancelled",
        action: "cancelled",
      },
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }

  // Notification
  try {
    sendNotification("booking.cancelled", {
      recipient: req.user.id,
      data: {
        booking_reference: booking.booking_reference,
        class_title: booking.class_title || "your class",
        date: booking.start_time || "",
      },
    });
  } catch (e) {}

  return {
    status: 200,
    body: { message: "預約已取消" },
  };
}

// ==================== Check-in Status ====================

function getCheckinStatus(bookingId, userId) {
  const db = getDb();
  const booking = db
    .prepare(
      `SELECT b.*, s.start_time, c.title AS class_title,
              c.venue_name, c.venue_address, c.latitude, c.longitude
       FROM bookings b
       JOIN class_schedules s ON b.schedule_id = s.id
       JOIN classes c ON s.class_id = c.id
       WHERE b.id = ? AND b.user_id = ?`,
    )
    .get(bookingId, userId);

  if (!booking) {
    return { status: 404, body: { success: false, error: "找不到該預約" } };
  }

  const now = new Date();
  const startTime = new Date(booking.start_time);
  const windowStart = new Date(startTime.getTime() - 15 * 60 * 1000);
  const windowEnd = new Date(startTime.getTime() + 60 * 60 * 1000);

  const canCheckin =
    booking.status === "confirmed" &&
    !booking.checked_in_at &&
    now >= windowStart &&
    now <= windowEnd;

  return {
    status: 200,
    body: {
      can_checkin: canCheckin,
      venue_name: booking.venue_name || "",
      venue_lat: booking.latitude,
      venue_lng: booking.longitude,
      venue_address: booking.venue_address || "",
      checkin_window_start: windowStart.toISOString(),
      checkin_window_end: windowEnd.toISOString(),
      checked_in: !!booking.checked_in_at,
      status: booking.status,
    },
  };
}

// ==================== Attend / Check-in ====================

function attendBooking(req) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const user = db
    .prepare("SELECT is_coach, coach_verified, role FROM users WHERE id = ?")
    .get(req.user.id);
  const isCoachOrAdmin =
    user && (user.is_coach || user.role === "admin" || user.coach_verified);

  let booking;
  if (!isCoachOrAdmin) {
    booking = db
      .prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);
    if (!booking) {
      return { status: 403, body: { success: false, error: "無權限執行此操作" } };
    }

    const bookingWithSchedule = db
      .prepare(
        `SELECT b.*, s.start_time
         FROM bookings b
         JOIN class_schedules s ON b.schedule_id = s.id
         WHERE b.id = ?`,
      )
      .get(req.params.id);

    if (bookingWithSchedule) {
      const now = new Date();
      const startTime = new Date(bookingWithSchedule.start_time);
      const windowStart = new Date(startTime.getTime() - 15 * 60 * 1000);
      const windowEnd = new Date(startTime.getTime() + 60 * 60 * 1000);

      if (now < windowStart) {
        return {
          status: 400,
          body: {
            success: false,
            error: "簽到時間未到（可於上課前 15 分鐘開始簽到）",
          },
        };
      }
      if (now > windowEnd) {
        return {
          status: 400,
          body: { success: false, error: "簽到時間已過" },
        };
      }
    }
  }

  const checkinMethod =
    req.body.checkin_method || (isCoachOrAdmin ? "coach" : "self");

  const result = db
    .prepare(
      "UPDATE bookings SET status = 'attended', checked_in_at = datetime('now'), checkin_method = ? WHERE id = ? AND status = 'confirmed'",
    )
    .run(checkinMethod, req.params.id);

  if (result.changes === 0) {
    return {
      status: 400,
      body: { error: "無法簽到，預約可能已取消或已完成" },
    };
  }

  // Update user stats
  const bookingData = db
    .prepare("SELECT user_id, schedule_id, amount FROM bookings WHERE id = ?")
    .get(req.params.id);
  if (bookingData) {
    db.prepare(
      "UPDATE users SET last_visit = datetime('now'), total_visits = COALESCE(total_visits, 0) + 1, total_spent = COALESCE(total_spent, 0) + COALESCE(?, 0) WHERE id = ?",
    ).run(bookingData.amount || 0, bookingData.user_id);

    try {
      const { syncCoachEarningsForSchedule } = require("../routes/coach-earnings");
      syncCoachEarningsForSchedule(bookingData.schedule_id);
    } catch (e) {}
  }

  // Audit + Blockchain
  try {
    trackBookingChange(req.params.id, req.user.id, "confirmed", "attended", req);
  } catch (auditErr) {
    console.error("⚠️ Audit record failed:", auditErr.message);
  }

  try {
    const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
    if (b) {
      writeBlock({
        entityType: "booking",
        entityId: req.params.id,
        data: {
          booking_reference: b.booking_reference,
          user_id: b.user_id,
          amount: b.amount || 0,
          status: "attended",
          action: "checked_in",
          checkin_method: checkinMethod,
        },
      });
    }
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }

  return { status: 200, body: { message: "✅ 簽到成功！" } };
}

// ==================== QR Check-in ====================

function processQRCheckin(req) {
  const { qr_data, booking_reference, schedule_id } = req.body;

  if (!qr_data && !booking_reference && !schedule_id) {
    return {
      status: 400,
      body: { success: false, error: "請提供 QR Code 資料或預約參考編號" },
    };
  }

  let parsedBookingRef = null;
  let parsedScheduleId = null;

  if (qr_data) {
    const parts = qr_data.split(":");
    if (parts.length >= 3 && parts[0] === "zenpass-checkin") {
      parsedBookingRef = parts[1];
      parsedScheduleId = parts[2];
    } else {
      return {
        status: 400,
        body: { success: false, error: "無效的 QR Code 格式" },
      };
    }
  }

  const ref = parsedBookingRef || booking_reference;
  if (!ref) {
    return {
      status: 400,
      body: { success: false, error: "無法識別預約" },
    };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  let booking;
  if (ref.startsWith("ZP-")) {
    booking = db
      .prepare("SELECT * FROM bookings WHERE booking_reference = ?")
      .get(ref);
  } else {
    booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(ref);
  }

  if (!booking) {
    return { status: 404, body: { success: false, error: "預約不存在" } };
  }

  if (booking.status === "attended") {
    return {
      status: 200,
      body: {
        message: "✅ 你已經簽到過了！",
        already_checked_in: true,
        booking,
      },
    };
  }

  if (booking.status !== "confirmed") {
    return {
      status: 400,
      body: {
        error: `無法簽到，預約狀態為「${booking.status}」`,
        current_status: booking.status,
      },
    };
  }

  const result = db
    .prepare(
      "UPDATE bookings SET status = 'attended' WHERE id = ? AND status = 'confirmed'",
    )
    .run(booking.id);

  if (result.changes === 0) {
    return { status: 400, body: { success: false, error: "簽到失敗" } };
  }

  // Update user stats
  db.prepare(
    "UPDATE users SET last_visit = datetime('now'), total_visits = COALESCE(total_visits, 0) + 1, total_spent = COALESCE(total_spent, 0) + COALESCE(?, 0) WHERE id = ?",
  ).run(booking.amount || 0, booking.user_id);

  // Audit
  try {
    const auditId = uuidv4();
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      auditId,
      "booking.checkin_qr",
      "booking",
      booking.id,
      req.user.id,
      JSON.stringify({ status: "confirmed" }),
      JSON.stringify({ status: "attended" }),
      `QR 簽到：${booking.booking_reference}`,
      req.ip || "",
      req.headers["user-agent"] || "",
    );
  } catch (e) {}

  // Blockchain
  try {
    writeBlock({
      entityType: "booking",
      entityId: booking.id,
      data: {
        booking_reference: booking.booking_reference,
        user_id: booking.user_id,
        class_id: booking.class_id,
        schedule_id: booking.schedule_id,
        amount: booking.amount || 0,
        status: "attended",
        action: "qr_checked_in",
        checkin_method: "qr",
      },
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }

  // Sync coach earnings
  try {
    const { syncCoachEarningsForSchedule } = require("../routes/coach-earnings");
    syncCoachEarningsForSchedule(booking.schedule_id);
  } catch (e) {
    console.error("⚠️ Coach earnings sync failed:", e.message);
  }

  return {
    status: 200,
    body: {
      message: "✅ 簽到成功！",
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
      status: "attended",
    },
  };
}

// ==================== No-show ====================

function markNoShow(req) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const user = db
    .prepare("SELECT is_coach, coach_verified, role FROM users WHERE id = ?")
    .get(req.user.id);
  const isCoachOrAdmin =
    user && (user.is_coach || user.role === "admin" || user.coach_verified);
  if (!isCoachOrAdmin) {
    return {
      status: 403,
      body: { success: false, error: "Only coach/admin can mark no-show" },
    };
  }

  const booking = db
    .prepare("SELECT * FROM bookings WHERE id = ? AND status = 'confirmed'")
    .get(req.params.id);
  if (!booking) {
    return {
      status: 404,
      body: {
        success: false,
        error: "Booking not found or already processed",
      },
    };
  }

  const result = db
    .prepare(
      "UPDATE bookings SET status = 'no_show', checked_in_at = datetime('now'), checkin_method = 'coach' WHERE id = ? AND status = 'confirmed'",
    )
    .run(req.params.id);

  if (result.changes === 0) {
    return { status: 400, body: { success: false, error: "Cannot mark no-show" } };
  }

  try {
    writeBlock({
      entityType: "booking",
      entityId: booking.id,
      data: {
        booking_reference: booking.booking_reference,
        user_id: booking.user_id,
        class_id: booking.class_id,
        schedule_id: booking.schedule_id,
        amount: booking.amount || 0,
        status: "no_show",
        action: "no_show",
      },
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (booking):", bcErr.message);
  }

  return { status: 200, body: { success: true, message: "Marked as no-show" } };
}

// ==================== Exports ====================

module.exports = {
  // Helpers / core
  generateBookingRef,
  checkPenaltyConsent,
  checkTrialEligibility,
  getTrialStatus,
  releaseExpiredHolds,
  incrementEnrolledCount,
  findExistingBookingForUser,
  deductCredits,
  processCorporatePayment,
  computePartnerCommission,
  insertBookingRow,

  // Main operations
  createBooking,
  completePayment,
  cancelBooking,
  getCheckinStatus,
  attendBooking,
  processQRCheckin,
  markNoShow,
};
