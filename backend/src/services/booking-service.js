/**
 * ZenPass 禪流 - 預約服務層
 * 從 routes/bookings.js 抽出嘅所有 Business Logic
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const Booking = require("../models/Booking");
const { sendNotification } = require("./notification");
const { processRefund } = require("./refund");
const { audit, trackBookingChange, trackPaymentChange } = require("./audit");
const { writeBlock } = require("./blockchain-audit");
const { postBookingLedger } = require("./accounting");
const { splitByRate } = require("../lib/money");
const { validatePromo, redeemPromo } = require("./promo");
const { awardPointsOnce, EARN_RULES } = require("./points");


/**
 * createBooking 流程中止錯誤：攜帶要回傳嘅 response。
 * 喺 db.transaction 內拋出 → 會令整個 transaction 回滾（
 * 避免 enrolled_count / credits 因中途失敗而洩漏）。
 */
class BookingFlowError extends Error {
  constructor(response) {
    super("booking_flow_aborted");
    this.name = "BookingFlowError";
    this.response = response;
  }
}


// ==================== Helpers ====================

// 2026-10-25：家長代報名／未成年人免責（idempotent ALTER）
function ensureAttendeeColumns(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    const add = [
      ["attendee_type", "TEXT DEFAULT 'self'"],
      ["child_name", "TEXT"],
      ["child_age", "INTEGER"],
      ["emergency_phone", "TEXT"],
      ["medical_notes", "TEXT"],
      ["guardian_name", "TEXT"],
      ["guardian_hkid4", "TEXT"],
      ["waiver_at", "TEXT"],
      ["terms_version", "TEXT"],
    ];
    add.forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) {
    console.error("attendee 欄位遷移失敗:", e.message);
  }
}

const crypto = require("crypto");

// 🎫 4 位現場驗證碼：由 booking id + server secret 派生，穩定、唔可猜
function checkinCodeFor(booking) {
  const secret = process.env.CHECKIN_SECRET || "zenpass-checkin-v1";
  const h = crypto
    .createHmac("sha256", secret)
    .update(String(booking.id))
    .digest();
  const n = ((h[0] << 8) | h[1]) % 10000;
  return String(n).padStart(4, "0");
}

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
// 🎁 2026-10-19 David 定：新用戶只可以有一次半價迎新優惠
const TRIAL_MAX_COUNT = 1;
const TRIAL_DISCOUNT = 0.5;

function trialCreditsCost(classCredits) {
  const base = Number(classCredits) || 12;
  return Math.max(0.1, Math.round(base * TRIAL_DISCOUNT * 10) / 10);
}

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
  const fullCredits = classData?.credits_cost || 12;
  const neededCredits = trialCreditsCost(fullCredits);
  const userCredits = db
    .prepare("SELECT credits FROM users WHERE id = ?")
    .get(userId);
  if (!userCredits || userCredits.credits < neededCredits) {
    return {
      ok: false,
      error: `迎新半價優惠需要 ${neededCredits} Credits（原價 ${fullCredits}），你目前有 ${userCredits?.credits || 0} Credits。請先購買 Credits。`,
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

function incrementEnrolledCount(db, scheduleId, seats = 1) {
  const n = Math.max(1, Number(seats) || 1);
  return db
    .prepare(
      "UPDATE class_schedules SET enrolled_count = enrolled_count + ? WHERE id = ? AND enrolled_count + ? <= max_participants",
    )
    .run(n, scheduleId, n);
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

function deductCredits(db, userId, classId, overrideCost, meta = {}) {
  const classData = db
    .prepare("SELECT credits_cost FROM classes WHERE id = ?")
    .get(classId);
  if (!classData) return { ok: false, error: "課程不存在" };
  const baseCost = overrideCost != null ? Number(overrideCost) : classData.credits_cost;
  // 🌗 高峰附加費（預設關閉；有 premium_peak 權益則豁免）
  let peakInfo = { cost: baseCost, surcharge: 0, waived: false, peak: false };
  if (meta.applyPeak !== false) {
    try {
      peakInfo = require("./peak-pricing").applyPeakSurcharge(db, userId, baseCost, meta.startTime);
    } catch (e) {}
  }
  const cost = peakInfo.cost;
  const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
  if (user.credits < cost) {
    return { ok: false, error: "點數不足，請先購買點數" };
  }
  const peakNote = peakInfo.surcharge > 0 ? `（含高峰附加 ${peakInfo.surcharge} cr）` : "";
  // 🧾 2026-10-19：所有 credits 變動寫入流水
  require("./credit-ledger").applyCredits(db, {
    userId,
    credits: -cost,
    type: "spend",
    source: meta.source || "booking",
    referenceId: meta.referenceId || null,
    description: (meta.description || "預約課堂扣除 Credits") + peakNote,
  });
  return { ok: true, creditsCost: cost, peak: peakInfo };
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
    require("./credit-ledger").applyCredits(db, {
      userId,
      credits: -fromPersonal,
      type: "spend",
      source: "corporate",
      referenceId: classId,
      description: "企業混合付款：個人 Credits 補足",
    });
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
      // 用整數 cents 拆賬，餘額歸場地 → platform + venue 必定等於原額（審計用）
      const split = splitByRate(amount, planRate);
      return {
        venue: partnerVenue,
        commissionRate: planRate,
        venueEarned: split.venue,
        platformEarned: split.platform,
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
    groupSize = 1,
    groupInviteCode = null,
    attendee = null,
  } = bookingData;

  const A = attendee || {};
  const aVals = [
    A.type === "child" ? "child" : "self",
    A.childName || null,
    A.childAge ? Number(A.childAge) : null,
    A.emergencyPhone || null,
    A.medicalNotes || null,
    (A.waiver && A.waiver.guardianName) || null,
    (A.waiver && A.waiver.guardianHKIDLast4) || null,
    A.waiver && A.waiver.agreed ? (A.waiver.timestamp || new Date().toISOString()) : null,
    A.waiver && A.waiver.agreed ? "v2026.1_hk_minor" : null,
  ];

  if (partnerInfo) {
    db.prepare(
      `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount, venue_partner_id, platform_commission_rate, venue_earned_amount, platform_earned_amount, group_size, group_invite_code,
        attendee_type, child_name, child_age, emergency_phone, medical_notes, guardian_name, guardian_hkid4, waiver_at, terms_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      groupSize,
      groupInviteCode,
      ...aVals,
    );
  } else {
    db.prepare(
      `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount, group_size, group_invite_code,
        attendee_type, child_name, child_age, emergency_phone, medical_notes, guardian_name, guardian_hkid4, waiver_at, terms_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      groupSize,
      groupInviteCode,
      ...aVals,
    );
  }

  // 🕒 v2.1：兩階段 hold（落單即 hold，付款/取消再 commit/void）
  if (bookingStatus === "pending_payment") {
    try {
      require("./ledger-holds").createHold(
        bookingId,
        userId,
        amount,
        paymentType === "credits" ? "credits" : "hkd",
      );
    } catch (e) {
      console.error("⚠️ [HOLD] create failed:", e.message);
    }
  }

  // 💳 v2.1：PaymentIntent（統一支付編排）
  if (bookingStatus === "pending_payment") {
    try {
      require("./payment-intents").upsertIntent({
        bookingId,
        userId,
        amount,
        method: paymentType,
        state: "requires_payment",
      });
    } catch (e) {
      console.error("⚠️ [PAYINTENT] create failed:", e.message);
    }
  }

  // 🧾 v2.1：booking timeline（append-only）
  try {
    require("./booking-events").logBookingEvent({
      bookingId,
      event: "created",
      toStatus: bookingStatus,
    });
  } catch (e) {}

  // 🕒💳 credits 即時付款：補記 committed hold + succeeded intent（審計完整性，零行為改動）
  if (bookingStatus === "confirmed" && paymentType === "credits") {
    try {
      const lh = require("./ledger-holds");
      lh.createHold(bookingId, userId, amount, "credits");
      lh.commitHold(bookingId);
    } catch (e) {
      console.error("⚠️ [HOLD] credits record failed:", e.message);
    }
    try {
      require("./payment-intents").upsertIntent({
        bookingId,
        userId,
        amount,
        method: "credits",
        state: "succeeded",
      });
    } catch (e) {
      console.error("⚠️ [PAYINTENT] credits record failed:", e.message);
    }
    try {
      let ledAmt = Number(amount) || 0;
      if (ledAmt <= 0) {
        const cr = db.prepare("SELECT credits_cost FROM classes WHERE id = ?").get(classId);
        ledAmt = (cr && cr.credits_cost ? cr.credits_cost : 0) * 10; // 1 credit = HK$10
      }
      if (ledAmt > 0) require("./accounting").postBookingSplitLedger(bookingId, userId, ledAmt, "credits");
    } catch (e) {
      console.error("⚠️ [LEDGER] credits split failed:", e.message);
    }
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

// ==================== VIP 優先預約 ====================

/**
 * 是否 VIP（只計付費 VIP Pass；鉑金會員等級唔算）
 * - users.membership_type = 'gold' 且未過期，或
 * - memberships 表有生效中 gold 會籍
 */
function isVipCustomer(db, userId) {
  try {
    // 權益單一來源：會籍授予嘅 priority_booking（VIP Pass）
    try {
      const { hasEntitlement } = require("./membership-catalog");
      if (hasEntitlement(userId, "priority_booking")) return true;
    } catch (e) {}
    const u = db
      .prepare("SELECT membership_type, membership_expires_at FROM users WHERE id = ?")
      .get(userId);
    if (u && u.membership_type === "gold") {
      const exp = u.membership_expires_at ? new Date(u.membership_expires_at) : null;
      if (!exp || isNaN(exp) || exp >= new Date()) return true;
    }
    const m = db
      .prepare(
        `SELECT 1 FROM memberships
         WHERE user_id = ? AND type = 'gold' AND status = 'active'
           AND date(end_date) >= date('now') LIMIT 1`,
      )
      .get(userId);
    return !!m;
  } catch (e) {
    return false;
  }
}

/**
 * 新課 VIP 優先窗口檢查
 * @returns {{allowed:boolean, until?:Date}}
 */
function checkVipPriorityWindow(db, cls, userId, now = new Date()) {
  const hours = Number(cls && cls.vip_priority_hours) || 0;
  if (!hours) return { allowed: true };
  // SQLite datetime('now') 係 UTC 但冇時區標記 → 補 Z，避免當成本地時間
  const raw = String((cls && cls.created_at) || "");
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z";
  const created = new Date(iso);
  if (isNaN(created)) return { allowed: true };
  const until = new Date(created.getTime() + hours * 3600 * 1000);
  if (now >= until) return { allowed: true };
  if (isVipCustomer(db, userId)) return { allowed: true };
  return { allowed: false, until };
}

// ==================== Core: Create Booking ====================

function createBooking(req, options = {}) {
  const { schedule_id, class_id, payment_type, penalty_consent } = req.body;
  // 👨‍👩‍👧 家長代報名（未成年人）
  const attendee = req.body.attendee || null;
  const attendeeType = attendee && attendee.type === "child" ? "child" : "self";
  let amount = req.body.amount;
  const promo_code = req.body.promo_code || req.body.promoCode;
  // credits override 只可以由伺服器內部（batch promo）傳入，唔可以信 req.body
  let creditsOverride =
    options.creditsOverride != null ? Number(options.creditsOverride) : undefined;

  if (!schedule_id || !class_id || !payment_type) {
    return { status: 400, body: { success: false, error: "缺少預約資料" } };
  }

  // 🔒 2026-10-19：只接受已知付款方式（原本傳 "free" 或其他字串 → 直接 confirmed + paid，金額 0）
  const ALLOWED_PAYMENT_TYPES = ["single", "credits", "corporate", "membership_trial", "free"];
  if (!ALLOWED_PAYMENT_TYPES.includes(payment_type)) {
    return { status: 400, body: { success: false, error: "付款方式無效" } };
  }

  // 👥 三人同行（2026-10-20）：只限單次付款／Credits
  const groupSize = Number(req.body.group_size) === 3 ? 3 : 1;
  if (groupSize === 3 && !["single", "credits"].includes(payment_type)) {
    return { status: 400, body: { success: false, error: "三人同行只適用於單次付款或 Credits" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");
  ensureAttendeeColumns(db);

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

  // 🔒 2026-10-19：時段必須屬於同一課程（否則可以用平班價錢 book 貴班嘅位）
  if (schedule.class_id !== class_id) {
    return { status: 400, body: { success: false, error: "時段與課程不相符" } };
  }

  // 3.1 課程狀態 / 是否已開放預約（資料未齊嘅活動只展示、唔收預約）
  const clsGuard = db
    .prepare("SELECT status, booking_open, created_at, vip_priority_hours FROM classes WHERE id = ?")
    .get(class_id);
  if (!clsGuard || clsGuard.status !== "active") {
    return { status: 400, body: { success: false, error: "此課程已完結或已下架" } };
  }
  if (clsGuard.booking_open === 0) {
    return { status: 400, body: { success: false, error: "此課程暫未開放預約，敬請期待" } };
  }

  // 3.1.1 VIP 優先預約：新課開放頭 24 小時只限 VIP
  const vipWin = checkVipPriorityWindow(db, clsGuard, req.user.id);
  if (!vipWin.allowed) {
    const untilStr = vipWin.until
      ? vipWin.until.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })
      : "";
    return {
      status: 403,
      body: {
        success: false,
        error: `此課程設 VIP 優先預約，${untilStr} 起開放給所有會員`,
        code: "VIP_PRIORITY",
        vip_only_until: vipWin.until ? vipWin.until.toISOString() : null,
      },
    };
  }

  // 3.2 預約期：只接受「未開始」而且「未來 2 個月內」嘅課堂
  {
    // 統一時間解析：DB 冇時區標記時當 UTC（同 API 一致），避免本機時區落差 8 小時
    const _raw = String(schedule.start_time || "");
    const _iso = /Z|[+-]\d\d:?\d\d$/.test(_raw) ? _raw : _raw.replace(" ", "T") + "Z";
    const _start = new Date(_iso);
    const _max = new Date();
    _max.setMonth(_max.getMonth() + 2);
    if (isNaN(_start)) {
      return { status: 400, body: { success: false, error: "時段資料有誤" } };
    }
    // 已開始／已過去嘅堂唔可以 book（容許 1 分鐘網絡延遲）
    if (_start.getTime() < Date.now() - 60 * 1000) {
      return { status: 400, body: { success: false, error: "此課堂已開始或已過去，無法預約" } };
    }
    if (_start > _max) {
      return { status: 400, body: { success: false, error: "課程只開放未來 2 個月內預約" } };
    }
  }

  // 3.5 優惠碼（只適用於單次付款；用伺服器端課程價計算，唔信 client amount）
  let promoApply = null;
  if (promo_code && (payment_type === "single" || payment_type === "credits")) {
    const clsRow = db.prepare("SELECT price_hkd FROM classes WHERE id = ?").get(class_id);
    const v = validatePromo(db, {
      code: promo_code,
      basePrice: clsRow ? clsRow.price_hkd : 0,
      classId: class_id,
      userId: req.user.id,
    });
    if (!v.ok) return { status: 400, body: { success: false, error: v.error } };
    amount = v.final_price;
    promoApply = v.promo;
    // 用 credits 付款：扣折後 credits（$95 → 9.5cr），保留 1 位小數
    if (payment_type === "credits") creditsOverride = Math.round((v.final_price / 10) * 10) / 10;
  }

  // 4-9. 原子化：釋放過期 hold → 佔位 → 重複檢查 → 扣款 → 寫 booking row
  //      任何一步失敗 → 成個 transaction 回滾（避免 enrolled_count / credits 洩漏）
  //      （fire-and-forget 嘅通知/審計/ledger 留喺 commit 之後）
  const bookingId = uuidv4();
  const bookingRef = generateBookingRef();
  const bookingStatus =
    payment_type === "single" ? "pending_payment" : "confirmed";
  const paymentStatus = payment_type === "single" ? "pending" : "paid";

  let partnerInfo = null;
  let corporateDeduction = null;
  let usedCredits = null;
  let groupInviteCode = null;
  const clsPricing = db
    .prepare("SELECT price_hkd, credits_cost FROM classes WHERE id = ?")
    .get(class_id);

  // 🔒 2026-10-19：只有真正免費（HK$0 + 0 credits）嘅活動可以用 free 預約
  if (payment_type === "free") {
    const p = Number(clsPricing && clsPricing.price_hkd) || 0;
    const c = Number(clsPricing && clsPricing.credits_cost) || 0;
    if (p > 0 || c > 0) {
      return { status: 400, body: { success: false, error: "此課程需要付費，請選擇付款方式" } };
    }
  }

  const bookingFlow = db.transaction(() => {
    // 4. Release expired holds
    releaseExpiredHolds(db, schedule_id);

    // 5. Capacity check (atomic conditional update)
    const capResult = incrementEnrolledCount(db, schedule_id, groupSize);
    if (capResult.changes === 0) {
      throw new BookingFlowError({
        status: 400,
        body: { success: false, error: "該時段已滿額" },
      });
    }

    // 6. Duplicate check
    const existing = findExistingBookingForUser(db, req.user.id, schedule_id);
    if (existing) {
      if (existing.status === "pending_payment") {
        throw new BookingFlowError({
          status: 200,
          body: {
            message: "你有一個未完成付款的預約，請繼續付款",
            booking_id: existing.id,
            status: "pending_payment",
            requires_payment: true,
          },
        });
      }
      throw new BookingFlowError({
        status: 409,
        body: { success: false, error: "你已經預約了此課程時段" },
      });
    }

    // 7. Payment processing
    if (payment_type === "credits") {
      const baseCost = creditsOverride != null ? Number(creditsOverride) : Number(clsPricing && clsPricing.credits_cost) || 0;
      const groupCost = Math.round(baseCost * groupSize * (groupSize === 3 ? 0.8 : 1) * 10) / 10;
      const result = deductCredits(db, req.user.id, class_id, groupCost, {
        source: "booking",
        referenceId: bookingId,
        description: `預約課堂（${class_id}）`,
        startTime: schedule && schedule.start_time,
      });
      if (!result.ok) {
        throw new BookingFlowError({
          status: 400,
          body: { success: false, error: result.error },
        });
      }
      usedCredits = result.creditsCost;
    }

    // 🎁 迎新半價：扣一半 credits（每次新用戶只限一次）
    if (payment_type === "membership_trial") {
      const baseCredits = Number(clsPricing && clsPricing.credits_cost) || 12;
      const half = trialCreditsCost(baseCredits);
      const result = deductCredits(db, req.user.id, class_id, half, {
        source: "trial",
        referenceId: bookingId,
        description: `迎新半價優惠（原價 ${baseCredits} credits）`,
        applyPeak: false,
      });
      if (!result.ok) {
        throw new BookingFlowError({
          status: 400,
          body: { success: false, error: result.error },
        });
      }
      usedCredits = result.creditsCost;
    }

    if (payment_type === "corporate") {
      const result = processCorporatePayment(db, req.user.id, class_id);
      if (!result.ok) {
        throw new BookingFlowError({
          status: 400,
          body: { error: result.error },
        });
      }
      corporateDeduction = result.deduction;
    }

    // 7.5 金額以伺服器計算為準（唔信 client amount）
    if (payment_type === "credits" && usedCredits != null) {
      amount = Math.round(usedCredits * 10 * 100) / 100;
    } else if (payment_type === "membership_trial" && usedCredits != null) {
      amount = Math.round(usedCredits * 10 * 100) / 100;
    } else if (payment_type === "single" && !promoApply) {
      amount = Number(clsPricing && clsPricing.price_hkd) || 0;
    }
    if (payment_type === "single" && groupSize === 3) {
      amount = Math.round(amount * 3 * 0.8 * 100) / 100;
    }
    if (groupSize === 3 && !groupInviteCode) {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "ZP";
      for (let i = 0; i < 5; i++) code += abc[Math.floor(Math.random() * abc.length)];
      groupInviteCode = code;
    }

    // 8. Partner commission
    partnerInfo = computePartnerCommission(db, class_id, amount || 0);

    // 9. Create booking record
    insertBookingRow(
      db,
      { bookingId, bookingRef, userId: req.user.id, scheduleId: schedule_id, classId: class_id, paymentType: payment_type, paymentStatus, bookingStatus, amount: amount || 0, groupSize, groupInviteCode, attendee },
      partnerInfo,
    );
    if (promoApply) redeemPromo(db, promoApply.id, req.user.id, bookingId, amount);
  });

  try {
    bookingFlow();
  } catch (e) {
    if (e instanceof BookingFlowError) return e.response;
    throw e;
  }

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

  // Include pricing formula version in booking blockchain record
  const creditConversion = {
    version: 2,
    rate: "1 Credit = HK$10",
    formula: "credits = floor(hkd / 10), actual = credits * 10",
    effective_from: "2026-07-05",
  };

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
      credit_conversion: creditConversion,
      calculation: classInfo?.credits_cost
        ? `${classInfo.credits_cost}cr × HK$10 = HK$${classInfo.credits_cost * 10}`
        : `HK$${amount || 0} ÷ 10 = ${Math.floor((amount || 0) / 10)}cr`,
    },
  });

  // 11b. Ledger double-entry（非 single 已即時 confirmed/paid 嘅 booking）
  if (bookingStatus === "confirmed" && (amount || 0) > 0) {
    try {
      postBookingLedger(
        bookingId,
        req.user.id,
        amount || 0,
        payment_type === "credits" ? "credits" : "cash",
        partnerInfo?.platform_commission_rate,
      );
    } catch (ledgerErr) {
      console.error("⚠️ Ledger entry failed (createBooking):", ledgerErr.message);
      try {
        audit({
          actionType: "ledger_write_failed",
          entityType: "booking",
          entityId: bookingId,
          userId: req.user.id,
          description: `Ledger 寫入失敗 (createBooking): ${ledgerErr.message}`,
        });
      } catch (_e) {}
    }
  }

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
      group_size: groupSize,
      group_invite_code: groupInviteCode,
    },
  };
}

// ==================== Complete Payment ====================

function completePayment(req) {
  // 🚫 安全（2026-10-19）：唔可以靠客戶自行提交參考編號就確認付款
  // FPS/PayMe 必須經管理員核對銀行紀錄；Stripe 必須經 webhook 驗證。
  return {
    status: 403,
    body: {
      success: false,
      code: "MANUAL_PAYMENT_REVIEW_REQUIRED",
      error: "付款需要管理員核實。請使用「我已付款，提交核實」功能（FPS／PayMe），或信用卡付款。",
    },
  };

  /* eslint-disable no-unreachable */
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

  // Ledger double-entry
  try {
    postBookingLedger(
      req.params.id,
      req.user.id,
      amount || booking.amount || 0,
      payment_method || "fps",
    );
  } catch (ledgerErr) {
    console.error("⚠️ Ledger entry failed (completePayment):", ledgerErr.message);
    try {
      audit({
        actionType: "ledger_write_failed",
        entityType: "booking",
        entityId: req.params.id,
        userId: req.user.id,
        description: `Ledger 寫入失敗 (completePayment): ${ledgerErr.message}`,
      });
    } catch (_e) {}
  }

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

  // 📒 v2.1 影子複式帳（ledger）：與現有流程並行，idempotent、永不影響結果
  if (process.env.LEDGER_SHADOW !== "0") {
    try {
      const { postBookingLedger } = require("./accounting");
      postBookingLedger(
        booking.id,
        req.user.id,
        amount || booking.amount || 0,
        payment_method || "fps",
      );
    } catch (ledErr) {
      console.error("⚠️ [LEDGER] shadow write failed:", ledErr.message);
    }
  }

  // 🕒 v2.1：付款成功 → commit hold
  try {
    require("./ledger-holds").commitHold(booking.id);
  } catch (holdErr) {
    console.error("⚠️ [HOLD] commit failed:", holdErr.message);
  }

  // 💳 v2.1：PaymentIntent 標記成功
  try {
    require("./payment-intents").upsertIntent({
      bookingId: booking.id,
      userId: booking.user_id,
      amount: amount || booking.amount || 0,
      method: payment_method || "fps",
      pspRef: payment_reference || null,
      state: "succeeded",
    });
  } catch (piErr) {
    console.error("⚠️ [PAYINTENT] update failed:", piErr.message);
  }

  // 🧾 v2.1：booking timeline
  try {
    require("./booking-events").logBookingEvent({
      bookingId: booking.id,
      event: "paid",
      fromStatus: "pending_payment",
      toStatus: "confirmed",
      actor: req.user.id,
      meta: { method: payment_method || "fps", amount: amount || booking.amount || 0 },
    });
  } catch (e) {}

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

/**
 * 取消費用比率（2026-10-17 David 定）：
 *   ≥72 小時（3 日）→ 0%
 *   24–72 小時（1–3 日）→ 50%
 *   <24 小時（當日）→ 100%
 */
function cancellationFeeRate(hoursUntil) {
  const h = Number(hoursUntil);
  if (!isFinite(h)) return 1;
  if (h >= 72) return 0;
  if (h >= 24) return 0.5;
  return 1;
}

/**
 * 會籍權益：免費取消
 * - unlimited_cancel（高階/VIP Pass）→ 任何時間免罰
 * - free_cancel（所有 Pass，符合「開課前 3 日免費取消」）→ ≥72 小時免罰（<72 小時仍可免罰，屬 Pass 權益）
 * 未持有有效會籍 → 按原本政策收費
 */
function resolveCancellationFeeRate(userId, hoursUntilClass, baseRate) {
  if (!baseRate || baseRate <= 0) return 0;
  try {
    const { hasEntitlement } = require("./membership-catalog");
    if (hasEntitlement(userId, "unlimited_cancel")) return 0;
    if (hoursUntilClass >= 24 && hasEntitlement(userId, "free_cancel")) return 0;
  } catch (e) {
    console.error("⚠️ Entitlement check failed (cancel):", e.message);
  }
  return baseRate;
}

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

  // 🚫 安全（2026-10-19）：只可以取消未上堂嘅預約。原本重複取消會再次退 credits／退款、
  // 再減 enrolled_count（booking 已 cancelled 都照做）。
  if (!["pending_payment", "confirmed"].includes(booking.status)) {
    return {
      status: 400,
      body: { success: false, error: "此預約已經取消或已完成，唔可以再取消" },
    };
  }

  const isPendingPayment = booking.status === "pending_payment";

  // 取消政策（2026-10-17 David 定）：
  //   開課前 ≥3 日：免費取消（全退）
  //   開課前 1–3 日：扣 50%
  //   開課前 <1 日（含當日）：扣 100%
  let feeRate = 0;
  if (!isPendingPayment) {
    const now = new Date();
    const classTime = new Date(booking.start_time);
    const hoursUntilClass = (classTime - now) / (1000 * 60 * 60);
    if (hoursUntilClass < 0) {
      return { status: 400, body: { success: false, error: "課程已開始，無法取消" } };
    }
    feeRate = resolveCancellationFeeRate(
      req.user.id,
      hoursUntilClass,
      cancellationFeeRate(hoursUntilClass),
    );
  }

  return _processNormalCancel(db, booking, reason, req, feeRate);
}

function _processLateCancel(db, booking, hoursUntilClass, reason, req) {
  db.prepare(
    "UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?",
  ).run(reason || null, booking.id);
  db.prepare(
    "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - ?) WHERE id = ?",
  ).run(Number(booking.group_size) || 1, booking.schedule_id);

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

  // 🕒 v2.1：遲取消 → void hold
  try {
    require("./ledger-holds").voidHold(booking.id, "late_cancelled");
  } catch (e) {}
  // 🧾 v2.1：booking timeline
  try {
    require("./booking-events").logBookingEvent({
      bookingId: booking.id, event: "cancelled", fromStatus: booking.status,
      toStatus: "cancelled", actor: req.user.id, meta: { late: true },
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

function _processNormalCancel(db, booking, reason, req, feeRate) {
  feeRate = feeRate === 0.5 || feeRate === 1 ? feeRate : 0;
  db.prepare(
    "UPDATE bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?",
  ).run(reason || null, booking.id);

  // 🕒 v2.1：取消 → void hold
  try {
    require("./ledger-holds").voidHold(booking.id, "cancelled");
  } catch (e) {}
  // 🧾 v2.1：booking timeline
  try {
    require("./booking-events").logBookingEvent({
      bookingId: booking.id, event: "cancelled", fromStatus: booking.status,
      toStatus: "cancelled", actor: req.user.id, meta: { reason: reason || null },
    });
  } catch (e) {}

  db.prepare(
    "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - ?) WHERE id = ?",
  ).run(Number(booking.group_size) || 1, booking.schedule_id);

  // Notify waitlist
  try {
    const { autoNotifyOnCancel } = require("../routes/waitlist");
    autoNotifyOnCancel(booking.schedule_id);
  } catch (e) {}

  // Refund credits（按實際扣除嘅 credits 退，優惠價如 $95 → 9.5cr）
  if (booking.payment_type === "credits") {
    const classData = db
      .prepare("SELECT credits_cost FROM classes WHERE id = ?")
      .get(booking.class_id);
    const refundCredits =
      (booking.amount > 0
        ? Math.round((booking.amount / 10) * 10) / 10
        : classData
          ? classData.credits_cost
          : 0) * (1 - feeRate);
    const _refundCredits = Math.round(refundCredits * 10) / 10;
    if (_refundCredits > 0) {
      require("./credit-ledger").applyCredits(db, {
        userId: req.user.id,
        credits: _refundCredits,
        type: "refund",
        source: "cancel",
        referenceId: booking.id,
        description: `取消預約退款${feeRate > 0 ? `（扣 ${feeRate * 100}% 手續費）` : ""}`,
      });
    }
    if (feeRate > 0) {
      try {
        const full = classData ? classData.credits_cost : 0;
        db.prepare(
          `INSERT INTO penalty_logs (id, booking_id, user_id, type, class_cost, penalty_credits, status, reason, created_at)
           VALUES (?, ?, ?, 'late_cancel', ?, ?, 'applied', ?, datetime('now'))`,
        ).run(uuidv4(), booking.id, req.user.id, full, Math.round(full * feeRate * 10) / 10, `取消費用 ${feeRate * 100}%（政策扣費）`);
      } catch (e) {
        console.error("[PENALTY] cancel fee log error:", e.message);
      }
    }
  }

  // Refund money if paid（按政策扣減）
  if (booking.payment_status === "paid" && booking.amount > 0) {
    const refundAmount = Math.round(booking.amount * (1 - feeRate) * 100) / 100;
    if (refundAmount > 0) try {
      const refundResult = processRefund({
        bookingId: req.params.id,
        amount: refundAmount,
        reason: feeRate > 0 ? `用戶取消預約（扣 ${feeRate * 100}%）` : "用戶取消預約",
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
              amount: refundAmount,
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
    body: {
      message:
        feeRate === 0
          ? "預約已取消（開課前 3 日（72 小時）以上，全數退回）"
          : feeRate === 0.5
            ? "預約已取消（開課前 1–3 日（24–72 小時），退回 50%）"
            : "預約已取消（開課當日或不足 24 小時，不設退款／扣 100%）",
      fee_rate: feeRate,
    },
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

/**
 * 兩點距離（米）— 用於簽到 geofence 伺服器端驗證
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 簽到距離上限（米）：UI 顯示 100 米，伺服器放寬 50 米容忍 GPS 誤差
const CHECKIN_MAX_DISTANCE_M = 150;


/**
 * 完成一堂 → 發積分（同一 booking 只發一次）
 * @returns {number} 實際發放分數（0 = 已發過／失敗）
 */
function awardBookingPoints(bookingId, userId, bookingReference) {
  try {
    const award = awardPointsOnce(userId, {
      points: EARN_RULES.booking,
      source: "booking",
      referenceId: bookingId,
      description: `✅ 完成課堂（${bookingReference || bookingId}）`,
    });
    return award && award.awarded ? award.awarded : 0;
  } catch (e) {
    console.error("⚠️ Points award failed (booking):", e.message);
    return 0;
  }
}

function attendBooking(req) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const user = db
    .prepare("SELECT is_coach, coach_verified, role FROM users WHERE id = ?")
    .get(req.user.id);
  const isCoachOrAdmin =
    user && (user.is_coach || user.role === "admin" || user.coach_verified);
  const isAdmin = user && (user.role === "admin" || user.role === "super_admin");

  // 非管理員嘅教練：只可以為「自己嘅班」簽到（防止亂簽其他人嘅學生）
  if (isCoachOrAdmin && !isAdmin) {
    const owned = db
      .prepare(
        `SELECT c.coach_id AS coach_id
         FROM bookings b JOIN classes c ON b.class_id = c.id
         WHERE b.id = ?`,
      )
      .get(req.params.id);
    if (!owned || owned.coach_id !== req.user.id) {
      return {
        status: 403,
        body: { success: false, error: "無權限為此課堂簽到" },
      };
    }
  }

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

    // 🔒 伺服器端 geofence：場地有座標就一定要喺範圍內（唔靠前端）
    const loc = db
      .prepare(
        `SELECT c.latitude, c.longitude
         FROM bookings b JOIN classes c ON b.class_id = c.id
         WHERE b.id = ?`,
      )
      .get(req.params.id);
    if (loc && loc.latitude != null && loc.longitude != null) {
      const lat = Number(req.body && req.body.latitude);
      const lng = Number(req.body && req.body.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) {
        return {
          status: 400,
          body: {
            success: false,
            error: "請開啟定位後再簽到（需喺場地 100 米範圍內）",
          },
        };
      }
      const d = distanceMeters(lat, lng, loc.latitude, loc.longitude);
      if (d > CHECKIN_MAX_DISTANCE_M) {
        return {
          status: 400,
          body: {
            success: false,
            error: `你距離場地約 ${Math.round(d)} 米，需喺 100 米範圍內先可簽到`,
            distance_m: Math.round(d),
          },
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

  // 完成一堂 → 賺積分
  let pointsAwarded = 0;
  if (bookingData) {
    const ref = db
      .prepare("SELECT booking_reference FROM bookings WHERE id = ?")
      .get(req.params.id);
    pointsAwarded = awardBookingPoints(
      req.params.id,
      bookingData.user_id,
      ref && ref.booking_reference,
    );
  }

  return {
    status: 200,
    body: {
      message: pointsAwarded
        ? `✅ 簽到成功！+${pointsAwarded} 積分 🎁`
        : "✅ 簽到成功！",
      points_awarded: pointsAwarded,
    },
  };
}

// ==================== QR Check-in ====================

function processQRCheckin(req) {
  let { qr_data, booking_reference, schedule_id, code } = req.body;

  // 2026-10-25：支援「只輸入 4 位核銷碼」→ 喺近期班次比對派生碼
  if (!qr_data && !booking_reference && !schedule_id && code) {
    const cleanCode = String(code).replace(/\D/g, "");
    if (cleanCode.length === 4) {
      const db2 = getDb();
      const rows = db2
        .prepare(
          `SELECT b.* FROM bookings b
           JOIN class_schedules cs ON cs.id = b.schedule_id
           WHERE b.status <> 'cancelled'
             AND cs.start_time BETWEEN datetime('now','-7 day') AND datetime('now','+14 day')
           LIMIT 500`,
        )
        .all();
      const hit = rows.find((r) => checkinCodeFor(r) === cleanCode);
      if (hit) {
        booking_reference = hit.booking_reference;
        req.body.booking_reference = hit.booking_reference;
      } else {
        return { status: 404, body: { success: false, error: "搵唔到對應核銷碼（請確認係近期班次嘅憑證）" } };
      }
    }
  }

  if (!req.body.qr_data && !req.body.booking_reference && !req.body.schedule_id) {
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

  // 🎫 教練手動輸入 4 位驗證碼（無 QR 掃描器時用）
  if (!qr_data && code != null && String(code).trim() !== "") {
    if (String(code).trim() !== checkinCodeFor(booking)) {
      return { status: 401, body: { success: false, error: "驗證碼不正確" } };
    }
  }

  if (booking.status === "attended") {
    // 2026-10-25：回傳完整資料俾教練端顯示「已於 xx:xx 簽到」
    let extra = {};
    try {
      const stu = db.prepare("SELECT name, phone FROM users WHERE id = ?").get(booking.user_id) || {};
      const info = db
        .prepare(
          `SELECT c.title, cs.start_time, cs.end_time FROM classes c LEFT JOIN class_schedules cs ON cs.id = ? WHERE c.id = ?`,
        )
        .get(booking.schedule_id, booking.class_id) || {};
      extra = {
        student_name: stu.name || "學員",
        phone_last4: stu.phone ? String(stu.phone).slice(-4) : null,
        guests: Number(booking.group_size) || 1,
        title: info.title || null,
        start_time: info.start_time || null,
        checked_in_at: booking.checked_in_at || null,
        booking_reference: booking.booking_reference,
      };
    } catch (e) {}
    return {
      status: 200,
      body: Object.assign(
        { message: "⚠️ 此憑證已經簽到過", already_checked_in: true, booking },
        extra,
      ),
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
      "UPDATE bookings SET status = 'attended', checked_in_at = datetime('now'), checkin_method = COALESCE(checkin_method, 'qr') WHERE id = ? AND status = 'confirmed'",
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

  // 完成一堂 → 賺積分（同一 booking 只發一次）
  const pointsAwarded = awardBookingPoints(
    booking.id,
    booking.user_id,
    booking.booking_reference,
  );

  let extra2 = {};
  try {
    const stu = db.prepare("SELECT name, phone FROM users WHERE id = ?").get(booking.user_id) || {};
    const info = db
      .prepare(
        `SELECT c.title, cs.start_time, cs.end_time FROM classes c LEFT JOIN class_schedules cs ON cs.id = ? WHERE c.id = ?`,
      )
      .get(booking.schedule_id, booking.class_id) || {};
    const counts = db
      .prepare(
        `SELECT COUNT(*) total, SUM(CASE WHEN status = 'attended' THEN 1 ELSE 0 END) attended
         FROM bookings WHERE schedule_id = ? AND status IN ('confirmed','attended')`,
      )
      .get(booking.schedule_id) || {};
    extra2 = {
      student_name: stu.name || "學員",
      phone_last4: stu.phone ? String(stu.phone).slice(-4) : null,
      guests: Number(booking.group_size) || 1,
      title: info.title || null,
      start_time: info.start_time || null,
      checked_in_at: new Date().toISOString(),
      attended_count: Number(counts.attended) || 0,
      total_count: Number(counts.total) || 0,
    };
  } catch (e) {}

  return {
    status: 200,
    body: Object.assign(
      {
        message: pointsAwarded
          ? `✅ 簽到成功！+${pointsAwarded} 積分 🎁`
          : "✅ 簽到成功！",
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        status: "attended",
        points_awarded: pointsAwarded,
      },
      extra2,
    ),
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
  cancellationFeeRate,
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
  checkinCodeFor,
  processQRCheckin,
  markNoShow,
  resolveCancellationFeeRate,
  cancellationFeeRate,
  isVipCustomer,
  checkVipPriorityWindow,
};
