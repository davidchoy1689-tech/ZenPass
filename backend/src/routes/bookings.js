/**
 * ZenPass 禪流 - 預約路由
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const { validate, schemas } = require("../middleware/validate");

const { sendNotification } = require("../services/notification");
const {
  audit,
  trackBookingChange,
  trackPaymentChange,
} = require("../services/audit");
const { requireIdempotency } = require("../middleware/idempotency");
const { processRefund } = require("../services/refund");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function generateBookingRef() {
  const dbb = new Database(DB_PATH);
  const maxS =
    dbb
      .prepare(
        "SELECT MAX(CAST(SUBSTR(booking_reference, 4) AS INTEGER)) as m FROM bookings WHERE booking_reference GLOB 'ZP-[0-9]*'",
      )
      .get().m || 0;
  dbb.close();
  return "ZP-" + String(maxS + 1).padStart(4, "0");
}

// ===== POST /api/bookings — 建立預約 =====
router.post(
  "/",
  authenticateToken,
  requireIdempotency,
  validate(schemas.booking),
  (req, res) => {
    try {
      const { schedule_id, class_id, payment_type, amount, penalty_consent } = req.body;

      if (!schedule_id || !class_id || !payment_type) {
        return res.status(400).json({ error: "缺少預約資料" });
      }

      // ⚠️ 檢查罰款同意書（ClassPass 模式）— user 一次過同意就得
      const userConsent = new Database(DB_PATH).prepare("SELECT penalty_consent FROM users WHERE id = ?").get(req.user.id);
      if (!userConsent || !userConsent.penalty_consent) {
        // 如果今次 submit 有 penalty_consent，就 save 一次 (one-time agreement)
        if (penalty_consent) {
          new Database(DB_PATH).prepare("UPDATE users SET penalty_consent = 1 WHERE id = ?").run(req.user.id);
        } else {
          return res.status(400).json({
            error: "請先同意缺席/遲取消罰款規則",
            code: "PENALTY_CONSENT_REQUIRED",
          });
        }
      }

      // 試玩都要有足夠 Credits 先 book 得（ClassPass 模式）
      if (payment_type === "membership_trial") {
        const dbCred = new Database(DB_PATH);
        const classData = dbCred.prepare("SELECT credits_cost FROM classes WHERE id = ?").get(class_id);
        const neededCredits = classData?.credits_cost || 12;
        const userCredits = dbCred.prepare("SELECT credits FROM users WHERE id = ?").get(req.user.id);
        dbCred.close();
        if (!userCredits || userCredits.credits < neededCredits) {
          return res.status(400).json({
            error: `試玩預約需要至少 ${neededCredits} Credits 作為按金，你目前有 ${userCredits?.credits || 0} Credits。請先購買 Credits。`,
            required_credits: neededCredits,
            current_credits: userCredits?.credits || 0,
          });
        }
      }

      // 試玩：7天內 + 30次上限 + 學生角色
      if (payment_type === "membership_trial") {
        const db3 = new Database(DB_PATH);
        const trialUser = db3
          .prepare(`SELECT role, created_at FROM users WHERE id = ?`)
          .get(req.user.id);

        // 只限學生角色
        if (!trialUser || trialUser.role !== "user") {
          db3.close();
          return res.status(403).json({ error: "試玩只限學生帳號" });
        }

        // 7天內
        var regDate = new Date(trialUser.created_at);
        var now = new Date();
        var daysSinceReg = Math.floor((now - regDate) / (1000 * 60 * 60 * 24));
        if (daysSinceReg >= 7) {
          db3.close();
          return res.status(400).json({ error: "試玩期已過（7天限）" });
        }

        // 30次上限
        var trialCount = db3
          .prepare(
            `SELECT COUNT(*) as cnt FROM bookings WHERE user_id = ? AND payment_type = 'membership_trial' AND status != 'cancelled'`,
          )
          .get(req.user.id);
        if (trialCount.cnt >= 30) {
          db3.close();
          return res
            .status(400)
            .json({ error: "試玩次數已滿，請聯絡 info@hklfcl.com" });
        }
        db3.close();
      }

      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      // 檢查課程時間表是否存在
      const schedule = db
        .prepare(
          `
      SELECT * FROM class_schedules WHERE id = ? AND status = 'available'
    `,
        )
        .get(schedule_id);

      if (!schedule) {
        db.close();
        return res.status(404).json({ error: "該時段不存在或已滿" });
      }

      // 先釋放呢個時段嘅過期 hold 位（15分鐘未付款 = 自動取消）
      // 規則：進入付款程序即 hold 位，15分鐘內未完成付款則釋放
      const expiredHolds = db
        .prepare(
          `UPDATE bookings SET status = 'cancelled', payment_status = 'refunded'
       WHERE schedule_id = ? AND status = 'pending_payment'
       AND fps_reference IS NULL AND payme_reference IS NULL
       AND created_at < datetime('now', '-15 minutes')`,
        )
        .run(schedule_id);
      if (expiredHolds.changes > 0) {
        // 釋放被 hold 嘅 enrolled_count
        // 一次過減返對應數量
        db.prepare(
          "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - ?) WHERE id = ?",
        ).run(expiredHolds.changes, schedule_id);
      }

      // 原子操作：用 UPDATE ... WHERE enrolled_count < max_participants 防止 race condition
      const capResult = db
        .prepare(
          "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ? AND enrolled_count < max_participants",
        )
        .run(schedule_id);
      if (capResult.changes === 0) {
        db.close();
        return res.status(400).json({ error: "該時段已滿額" });
      }

      // 檢查是否重複預約（包括未付款的 pending_payment）
      const existing = db
        .prepare(
          `
      SELECT id, status, payment_status FROM bookings 
      WHERE user_id = ? AND schedule_id = ? AND (status = 'confirmed' OR status = 'pending_payment')
    `,
        )
        .get(req.user.id, schedule_id);

      if (existing) {
        // 如果係未完成付款，俾佢繼續付款
        if (existing.status === "pending_payment") {
          db.close();
          return res.status(200).json({
            message: "你有一個未完成付款的預約，請繼續付款",
            booking_id: existing.id,
            status: "pending_payment",
            requires_payment: true,
          });
        }
        db.close();
        return res.status(409).json({ error: "你已經預約了此課程時段" });
      }

      // 根據付款類型處理
      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(req.user.id);

      if (payment_type === "credits") {
        // 用點數付款
        const classData = db
          .prepare("SELECT credits_cost FROM classes WHERE id = ?")
          .get(class_id);
        if (!classData) {
          db.close();
          return res.status(404).json({ error: "課程不存在" });
        }
        if (user.credits < classData.credits_cost) {
          db.close();
          return res.status(400).json({ error: "點數不足，請先購買點數" });
        }
        // 扣點數
        db.prepare("UPDATE users SET credits = credits - ? WHERE id = ?").run(
          classData.credits_cost,
          req.user.id,
        );
      }

      // 建立預約 — 未付款用 pending_payment，唔會 block 住重試
      const bookingId = uuidv4();
      const bookingRef = generateBookingRef();
      const bookingStatus =
        payment_type === "single" ? "pending_payment" : "confirmed";
      const paymentStatus = payment_type === "single" ? "pending" : "paid";

      // Check if this class belongs to a partner venue (via FK link)
      let partnerVenue = null;
      let partnerCommission = null;
      let partnerVenueEarned = null;
      let partnerPlatformEarned = null;
      try {
        partnerVenue = db
          .prepare(
            `
        SELECT pv.id, pv.commission_rate, pv.commission_plan, pv.name as venue_name
        FROM classes c
        JOIN partner_venues pv ON c.partner_venue_id = pv.id
        WHERE c.id = ? AND pv.status = 'active'
      `,
          )
          .get(class_id);
        if (partnerVenue) {
          const bookingAmount = amount || 0;
          // Use plan-based commission rate
          const planKey = partnerVenue.commission_plan || "basic";
          const planRates = { basic: 0.25, standard: 0.18, premium: 0.12 };
          const planRate =
            planRates[planKey] || partnerVenue.commission_rate || 0.25;
          partnerCommission = planRate;
          partnerPlatformEarned =
            Math.round(bookingAmount * partnerCommission * 100) / 100;
          partnerVenueEarned =
            Math.round(bookingAmount * (1 - partnerCommission) * 100) / 100;
        }
      } catch (e) {
        // Partner detection failure is non-critical
      }

      // credits 付款係即時扣點數，唔需要用 pending
      const insertCols = partnerVenue
        ? `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount, venue_partner_id, platform_commission_rate, venue_earned_amount, platform_earned_amount)`
        : `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount)`;
      const insertVals = partnerVenue
        ? `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        : `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      db.prepare(insertCols + " " + insertVals).run(
        bookingId,
        bookingRef,
        req.user.id,
        schedule_id,
        class_id,
        payment_type,
        paymentStatus,
        bookingStatus,
        amount || 0,
        ...(partnerVenue
          ? [
              partnerVenue.id,
              partnerCommission,
              partnerVenueEarned,
              partnerPlatformEarned,
            ]
          : []),
      );

      // 讀取課程/教練/時間資料（用於通知同 response）
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
          .prepare(
            "SELECT start_time, end_time FROM class_schedules WHERE id = ?",
          )
          .get(schedule_id);
      } catch (e) {
        // 讀取失敗唔影響 booking creation
      }

      // 🔔 通知：預約成功（async fire-and-forget）
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

          // 🔔 通知：教練有新預約
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

      // 🔔 追蹤：預約行為（async fire-and-forget）
      try {
        var { trackUserAction } = require("../services/recommendation");
        trackUserAction(req.user.id, "book_class", {
          class_id: class_id,
          category: classInfo ? classInfo.category : null,
        });
      } catch (trackErr) {
        // 追蹤失敗唔影響 booking
      }

      // 🔔 AUDIT：記錄預約建立
      try {
        trackBookingChange(bookingId, req.user.id, null, bookingStatus, req);
      } catch (auditErr) {
        console.error("⚠️ Audit record failed:", auditErr.message);
      }

      // ⛓️ 寫入 blockchain block（即時 hash + 永久儲存）
      try {
        const { writeBookingBlock } = require("../services/blockchain-audit");
        const block = writeBookingBlock(bookingId);
        if (block && block.hash) {
          console.log(
            `[BLOCKCHAIN] 📝 Block written: ${bookingRef} hash=${block.hash.slice(0, 12)}...`,
          );
        }
      } catch (bcErr) {
        console.error("⚠️ Blockchain write failed:", bcErr.message);
      }

      db.close();

      res.status(201).json({
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
      });
    } catch (err) {
      console.error("預約錯誤:", err);
      res.status(500).json({ error: "預約失敗，請稍後再試" });
    }
  },
);

// ===== GET /api/bookings/:id — 單一預約詳情（for 評價）=====
// ===== GET /api/bookings/trial-status — 試玩資格 =====
// 規則：首次登記學生帳號，首7天，上限30堂
const TRIAL_WINDOW_DAYS = 7;
const TRIAL_MAX_COUNT = 30;

router.get("/trial-status", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare(`SELECT id, role, created_at FROM users WHERE id = ?`)
      .get(req.user.id);

    // 1. Only student role
    if (!user || user.role !== "user") {
      db.close();
      return res.json({ eligible: false, reason: "只限學生帳號試玩" });
    }

    // 2. First 7 days from registration
    var regDate = new Date(user.created_at);
    var now = new Date();
    var daysSinceReg = Math.floor((now - regDate) / (1000 * 60 * 60 * 24));
    var withinWindow = daysSinceReg < TRIAL_WINDOW_DAYS;

    // 3. Count existing trial bookings
    var trialCount = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM bookings WHERE user_id = ? AND payment_type = 'membership_trial' AND status != 'cancelled'`,
      )
      .get(req.user.id);
    var usedCount = trialCount.cnt;
    var remainingCount = Math.max(0, TRIAL_MAX_COUNT - usedCount);
    var hasRemaining = remainingCount > 0;

    // Calculate trial expiry date
    var expiryDate = new Date(regDate);
    expiryDate.setDate(expiryDate.getDate() + TRIAL_WINDOW_DAYS);

    db.close();
    res.json({
      eligible: withinWindow && hasRemaining,
      trial_used: usedCount > 0,
      days_remaining: Math.max(0, TRIAL_WINDOW_DAYS - daysSinceReg),
      trial_window_days: TRIAL_WINDOW_DAYS,
      expires_at: expiryDate.toISOString(),
      reason: !withinWindow ? "試玩期已過" : !hasRemaining ? "" : "",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/bookings/my — 我的預約 =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const { status, page = 1, limit = 20 } = req.query;

    let whereConditions = ["b.user_id = ?"];
    let params = [req.user.id];

    if (status) {
      whereConditions.push("b.status = ?");
      params.push(status);
    }

    const whereClause = whereConditions.join(" AND ");
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const bookings = db
      .prepare(
        `
      SELECT 
        b.*, c.title, c.category, c.duration, c.price_hkd, c.venue_name, c.coach_id,
        cs.start_time, cs.end_time,
        u.name as coach_name
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN users u ON c.coach_id = u.id
      WHERE ${whereClause}
      ORDER BY cs.start_time DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, parseInt(limit), offset);

    db.close();

    res.json({ bookings });
  } catch (err) {
    console.error("獲取預約錯誤:", err);
    res.status(500).json({ error: "無法獲取預約記錄" });
  }
});

// ===== POST /api/bookings/:id/complete-payment — 完成付款（pending_payment → confirmed）=====
router.post(
  "/:id/complete-payment",
  authenticateToken,
  requireIdempotency,
  validate(schemas.payment_confirm),
  (req, res) => {
    try {
      const { payment_method, payment_reference, amount } = req.body;

      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      const booking = db
        .prepare(
          `
      SELECT * FROM bookings WHERE id = ? AND user_id = ? AND status = 'pending_payment'
    `,
        )
        .get(req.params.id, req.user.id);

      if (!booking) {
        db.close();
        return res.status(404).json({ error: "未找到待付款的預約" });
      }

      // 更新 booking 為已付款
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

      // pending_payment → confirmed，enrolled_count 已在建立 booking 時計入，不需再加

      // 記錄交易
      db.prepare(
        `
      INSERT INTO transactions (id, user_id, type, amount, payment_method, ${payment_method === "stripe" ? "stripe_payment_intent_id" : payment_method === "fps" ? "fps_reference" : "payme_reference"}, status)
      VALUES (?, ?, 'single_booking', ?, ?, ?, 'completed')
    `,
      ).run(
        uuidv4(),
        req.user.id,
        amount || booking.amount || 0,
        payment_method || "fps",
        payment_reference || null,
      );

      // 🔔 通知：預約確認（付款完成）
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
          recipient: null, // will be filled by class owner
          data: {
            student_name: req.user.name || "學生",
            class_title: classDataNotif?.title || "—",
          },
        });
      } catch (notifErr) {
        console.error("⚠️ 發送通知失敗:", notifErr.message);
      }

      // 🔔 AUDIT：付款完成
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

      db.close();

      res.json({
        message: "付款成功，預約已確認！",
        booking_id: booking.id,
        status: "confirmed",
        payment_status: "paid",
      });
    } catch (err) {
      console.error("完成付款錯誤:", err);
      res.status(500).json({ error: "完成付款失敗" });
    }
  },
);

// ===== POST /api/bookings/:id/cancel — 取消預約 =====
router.post("/:id/cancel", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const booking = db
      .prepare(
        `
      SELECT b.*, cs.start_time FROM bookings b
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.id = ? AND b.user_id = ?
    `,
      )
      .get(req.params.id, req.user.id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在" });
    }

    // pending_payment (未付款) 可隨時取消
    const isPendingPayment = booking.status === "pending_payment";

    if (!isPendingPayment) {
      const now = new Date();
      const classTime = new Date(booking.start_time);
      const hoursUntilClass = (classTime - now) / (1000 * 60 * 60);

      // < 2 小時 → 完全阻住
      if (hoursUntilClass < 2) {
        db.close();
        return res.status(400).json({
          error: "開課前 2 小時內無法取消預約（太遲）",
        });
      }

      // 2-12 小時 → 遲取消，唔退 Credits
      if (hoursUntilClass < 12) {
        db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
        db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?")
          .run(booking.schedule_id);

        try {
          const { autoNotifyOnCancel } = require("./waitlist");
          autoNotifyOnCancel(booking.schedule_id);
        } catch (e) {}

        // 記錄 penalty_log
        try {
          const classCost = db.prepare("SELECT credits_cost FROM classes WHERE id = ?").get(booking.class_id);
          db.prepare(
            "INSERT INTO penalty_logs (id, booking_id, user_id, type, class_cost, penalty_credits, status, reason, created_at) VALUES (?, ?, ?, 'late_cancel', ?, 0, 'applied', ?, datetime('now'))"
          ).run(uuidv4(), booking.id, req.user.id, classCost?.credits_cost || 0,
            `遲取消（${hoursUntilClass.toFixed(1)}小時前）：已使用的 ${classCost?.credits_cost || 0} Credits 唔退還`);
        } catch(e) { console.error('[PENALTY] late-cancel log error:', e.message); }

        try {
          trackBookingChange(booking.id, req.user.id, booking.status, "cancelled", req);
        } catch (e) {}

        db.close();
        return res.json({
          message: "預約已取消（遲取消）。由於距離開課不足 12 小時，已使用的 Credits 唔會退還。",
          late_cancel: true,
          credits_forfeited: true,
        });
      }
    }

    // > 12 小時 → 正常取消，全退 Credits
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);

    // 釋放名額
    db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?")
      .run(booking.schedule_id);

    // 檢查候補名單
    try {
      const { autoNotifyOnCancel } = require("./waitlist");
      autoNotifyOnCancel(booking.schedule_id);
    } catch (e) {}

    // 退還點數（> 12 小時正常取消先退）
    if (booking.payment_type === "credits") {
      const classData = db.prepare("SELECT credits_cost FROM classes WHERE id = ?").get(booking.class_id);
      if (classData) {
        db.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").run(classData.credits_cost, req.user.id);
      }
    }

    // 💰 REFUND：如果已付款，自動退款
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
      } catch (refundErr) {
        console.error("⚠️ Auto-refund failed:", refundErr.message);
      }
    }

    // 🔔 AUDIT：取消預約
    try {
      trackBookingChange(
        req.params.id,
        req.user.id,
        booking.status,
        "cancelled",
        req,
      );
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    db.close();

    res.json({ message: "預約已取消" });
  } catch (err) {
    console.error("取消預約錯誤:", err);
    res.status(500).json({ error: "取消預約失敗" });
  }
});

// ===== POST /api/bookings/:id/attend — 標記為已出席 =====
router.post("/:id/attend", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Coach or admin can mark attendance
    const user = db
      .prepare("SELECT is_coach, coach_verified, role FROM users WHERE id = ?")
      .get(req.user.id);
    const isAuthorized =
      user && (user.is_coach || user.role === "admin" || user.coach_verified);

    if (!isAuthorized) {
      // Allow student to check themselves in if the booking belongs to them
      const booking = db
        .prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?")
        .get(req.params.id, req.user.id);
      if (!booking) {
        db.close();
        return res.status(403).json({ error: "無權限執行此操作" });
      }
    }

    const result = db
      .prepare(
        "UPDATE bookings SET status = 'attended' WHERE id = ? AND status = 'confirmed'",
      )
      .run(req.params.id);

    if (result.changes === 0) {
      db.close();
      return res
        .status(400)
        .json({ error: "無法簽到，預約可能已取消或已完成" });
    }

    // Update student last_visit and total_visits
    const booking = db
      .prepare("SELECT user_id, schedule_id, amount FROM bookings WHERE id = ?")
      .get(req.params.id);
    if (booking) {
      db.prepare(
        "UPDATE users SET last_visit = datetime('now'), total_visits = COALESCE(total_visits, 0) + 1, total_spent = COALESCE(total_spent, 0) + COALESCE(?, 0) WHERE id = ?",
      ).run(booking.amount || 0, booking.user_id);

      // Sync coach earnings
      try {
        const { syncCoachEarningsForSchedule } = require("./coach-earnings");
        syncCoachEarningsForSchedule(booking.schedule_id);
      } catch (e) {}
    }

    // 🔔 AUDIT：簽到
    try {
      trackBookingChange(
        req.params.id,
        req.user.id,
        "confirmed",
        "attended",
        req,
      );
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    db.close();
    res.json({ message: "✅ 簽到成功！" });
  } catch (err) {
    console.error("簽到錯誤:", err);
    res.status(500).json({ error: "簽到失敗" });
  }
});

// ===== GET /api/bookings/today — 今日課堂（教練用）=====
router.get("/today", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const today = new Date().toISOString().split("T")[0];
    const schedules = db
      .prepare(
        `
      SELECT cs.id as schedule_id, cs.start_time, cs.end_time,
        c.id as class_id, c.title, c.venue_name,
        (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'attended') as attended_count,
        (SELECT COUNT(*) FROM bookings WHERE schedule_id = cs.id AND status = 'confirmed') as confirmed_count
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      WHERE date(cs.start_time) = date(?)
        AND cs.start_time > datetime('now', '-3 hours')
      ORDER BY cs.start_time
    `,
      )
      .all(today);

    // For each schedule, get the students
    const result = schedules.map(function (s) {
      const students = db
        .prepare(
          `
        SELECT b.id as booking_id, u.id, u.name, b.status, b.created_at as booked_at
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        WHERE b.schedule_id = ? AND b.status IN ('confirmed', 'attended')
        ORDER BY b.created_at
      `,
        )
        .all(s.schedule_id);
      return { ...s, students: students };
    });

    db.close();
    res.json({ schedules: result, date: today });
  } catch (err) {
    console.error("獲取今日課堂錯誤:", err);
    res.status(500).json({ error: "無法取得今日課堂" });
  }
});

// ===== GET /api/bookings/:id — 單一預約詳情 =====
router.get("/:id", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const booking = db
      .prepare(
        `
      SELECT b.*, c.title, c.coach_id, c.price_hkd, u.name as coach_name, u2.name as student_name,
             cs.start_time, cs.end_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN users u ON c.coach_id = u.id
      JOIN users u2 ON b.user_id = u2.id
      LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.id = ?
    `,
      )
      .get(req.params.id);
    db.close();
    if (!booking) return res.status(404).json({ error: "預約不存在" });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/bookings/:id/qr — 生成 QR Code（返回 QR 資料文字）=====
router.get("/:id/qr", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const booking = db
      .prepare(
        `SELECT b.*, cs.id as schedule_id
         FROM bookings b
         JOIN class_schedules cs ON b.schedule_id = cs.id
         WHERE b.id = ?`,
      )
      .get(req.params.id);
    db.close();

    if (!booking) {
      return res.status(404).json({ error: "預約不存在" });
    }

    // Only the booking owner, coach, or admin can get the QR
    if (booking.user_id !== req.user.id && req.user.role !== "admin") {
      // Allow coach access if they teach this class
      const coachDb = new Database(DB_PATH);
      const cls = coachDb
        .prepare("SELECT coach_id FROM classes WHERE id = ?")
        .get(booking.class_id);
      coachDb.close();
      if (!cls || cls.coach_id !== req.user.id) {
        return res.status(403).json({ error: "無權限存取此 QR Code" });
      }
    }

    const qrData = `zenpass-checkin:${booking.booking_reference || booking.id}:${booking.schedule_id}`;

    // Try to generate a QR image using the qrcode package
    let qrDataUrl = null;
    try {
      const QRCode = require("qrcode");
      // Generate as base64 data URL synchronously
      QRCode.toDataURL(qrData, { width: 300, margin: 2 }, (err, url) => {
        if (err) {
          return res.json({ qr_text: qrData, booking_reference: booking.booking_reference, booking_id: booking.id, schedule_id: booking.schedule_id });
        }
        res.json({ qr_data_url: url, qr_text: qrData, booking_reference: booking.booking_reference, booking_id: booking.id, schedule_id: booking.schedule_id });
      });
    } catch (e) {
      // qrcode package not available, return text only
      res.json({ qr_text: qrData, booking_reference: booking.booking_reference, booking_id: booking.id, schedule_id: booking.schedule_id });
    }
  } catch (err) {
    console.error("QR 生成錯誤:", err);
    res.status(500).json({ error: "QR Code 生成失敗" });
  }
});

// ===== POST /api/bookings/checkin — 掃描 QR 簽到 =====
router.post("/checkin", authenticateToken, (req, res) => {
  try {
    const { qr_data, booking_reference, schedule_id } = req.body;

    if (!qr_data && !booking_reference && !schedule_id) {
      return res.status(400).json({ error: "請提供 QR Code 資料或預約參考編號" });
    }

    // Parse QR data if provided
    let parsedBookingRef = null;
    let parsedScheduleId = null;

    if (qr_data) {
      // Format: zenpass-checkin:{booking_reference}:{schedule_id}
      const parts = qr_data.split(":");
      if (parts.length >= 3 && parts[0] === "zenpass-checkin") {
        parsedBookingRef = parts[1];
        parsedScheduleId = parts[2];
      } else {
        return res.status(400).json({ error: "無效的 QR Code 格式" });
      }
    }

    // Use direct params as fallback
    const ref = parsedBookingRef || booking_reference;
    const schedId = parsedScheduleId || schedule_id;

    if (!ref) {
      return res.status(400).json({ error: "無法識別預約" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Find booking by reference or id
    let booking;
    if (ref.startsWith("ZP-")) {
      booking = db.prepare("SELECT * FROM bookings WHERE booking_reference = ?").get(ref);
    } else {
      booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(ref);
    }

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在" });
    }

    // Check if already attended
    if (booking.status === "attended") {
      db.close();
      return res.json({ message: "✅ 你已經簽到過了！", already_checked_in: true, booking });
    }

    // Only confirmed bookings can check in
    if (booking.status !== "confirmed") {
      db.close();
      return res.status(400).json({
        error: `無法簽到，預約狀態為「${booking.status}」`,
        current_status: booking.status,
      });
    }

    // Update booking status to attended
    const result = db
      .prepare(
        "UPDATE bookings SET status = 'attended' WHERE id = ? AND status = 'confirmed'",
      )
      .run(booking.id);

    if (result.changes === 0) {
      db.close();
      return res.status(400).json({ error: "簽到失敗" });
    }

    // Update enrolled_count on the schedule
    // Note: enrolled_count already includes confirmed bookings, no need to increment

    // Update student stats
    db.prepare(
      "UPDATE users SET last_visit = datetime('now'), total_visits = COALESCE(total_visits, 0) + 1, total_spent = COALESCE(total_spent, 0) + COALESCE(?, 0) WHERE id = ?",
    ).run(booking.amount || 0, booking.user_id);

    // 🔔 AUDIT：創建 audit log
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

    // Sync coach earnings
    try {
      const { syncCoachEarningsForSchedule } = require("./coach-earnings");
      syncCoachEarningsForSchedule(booking.schedule_id);
    } catch (e) {
      console.error("⚠️ Coach earnings sync failed:", e.message);
    }

    db.close();

    res.json({
      message: "✅ 簽到成功！",
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
      status: "attended",
    });
  } catch (err) {
    console.error("QR 簽到錯誤:", err);
    res.status(500).json({ error: "簽到失敗，請稍後再試" });
  }
});

module.exports = router;
