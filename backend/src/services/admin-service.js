/**
 * ZenPass 禪流 — 管理員服務層
 * 從 routes/admin.js 抽出嘅所有 Business Logic
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const { sendNotification, sendTelegramAlert } = require("./notification");
const { audit, trackAdminAction, queryAudit } = require("./audit");
const { writeBlock } = require("./blockchain-audit");

// ==================== Payment Management ====================

function listPendingPayments() {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const pending = db
    .prepare(
      `SELECT b.id as booking_id, b.booking_reference, b.user_id,
              u.user_reference, c.class_reference, b.amount,
              b.fps_reference, b.payme_reference, b.receipt_image,
              COALESCE(b.payment_method,
                CASE WHEN b.fps_reference IS NOT NULL THEN 'fps'
                     WHEN b.payme_reference IS NOT NULL THEN 'payme'
                     ELSE 'unknown' END
              ) as payment_method,
              b.class_id, b.created_at as booked_at,
              u.name as user_name, u.email as user_email, u.phone as user_phone,
              c.title as class_title, c.category, cs.start_time, cs.end_time
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       JOIN classes c ON b.class_id = c.id
       LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
       WHERE b.status = 'pending_payment'
         AND (b.fps_reference IS NOT NULL OR b.payme_reference IS NOT NULL)
         AND b.payment_status = 'pending'
       ORDER BY b.created_at ASC`
    )
    .all();

  return { pending_payments: pending };
}

function approvePayment(bookingId, adminId, req) {
  if (!bookingId) {
    return { status: 400, body: { success: false, error: "缺少預約 ID" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const booking = db
    .prepare("SELECT * FROM bookings WHERE id = ? AND status = ?")
    .get(bookingId, "pending_payment");
  if (!booking) {
    return { status: 404, body: { success: false, error: "預約不存在或已處理" } };
  }

  db.prepare("UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?")
    .run(bookingId);

  // Auto coach earnings
  try {
    const { syncCoachEarningsForSchedule } = require("../routes/coach-earnings");
    syncCoachEarningsForSchedule(booking.schedule_id);
  } catch (e) {
    console.error("auto coach earnings:", e.message);
  }

  db.prepare(
    `UPDATE transactions SET status = 'completed', description = '管理員已確認付款'
     WHERE (fps_reference = ? OR payme_reference = ?) AND status = 'pending'`
  ).run(booking.fps_reference, booking.payme_reference);

  // Notification
  const classTitleNotif = db.prepare("SELECT title FROM classes WHERE id = ?").get(booking.class_id);
  try {
    sendNotification("payment.approved", {
      recipient: booking.user_id,
      data: { amount: booking.amount, class_title: classTitleNotif?.title || "—" },
    });
  } catch (notifErr) { console.error("⚠️ 發送通知失敗:", notifErr.message); }

  const userName = db.prepare("SELECT name, email FROM users WHERE id = ?").get(booking.user_id);
  setTimeout(() => {
    sendTelegramAlert(
      `✅ <b>管理員已確認付款</b>\n👤 用戶：${userName?.name || userName?.email || booking.user_id}\n💰 金額：HK$${booking.amount || 0}\n💳 方式：${booking.fps_reference ? "FPS" : "PayMe"}\n📚 課程：${classTitleNotif?.title || "—"}\n🆔 Booking：${bookingId}\n⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`
    );
  }, 0);

  // Accounting
  try {
    const { recordPayment, recordCommission } = require("./accounting");
    recordPayment(bookingId, booking.user_id, booking.amount || 0, booking.fps_reference ? "fps" : "payme");
    const commissionAmt = Math.round((booking.amount || 0) * (booking.platform_commission_rate || 0.2) * 100) / 100;
    if (commissionAmt > 0) {
      recordCommission(bookingId, booking.user_id, commissionAmt, booking.fps_reference ? "fps" : "payme");
    }
  } catch (acctErr) { console.error("⚠️ Accounting entry failed:", acctErr.message); }

  // Audit
  try { trackAdminAction(adminId, "approve_payment", { booking_id: bookingId, amount: booking?.amount }, req); }
  catch (auditErr) { console.error("⚠️ Audit record failed:", auditErr.message); }

  // Blockchain
  try {
    writeBlock({
      entityType: "admin_action", entityId: bookingId,
      data: { admin_user: adminId, action: "approve_payment", target_type: "booking", target_id: bookingId, details: { amount: booking?.amount, payment_method: booking?.fps_reference ? "fps" : "payme" } },
    });
  } catch (bcErr) { console.error("⚠️ Blockchain write failed (admin approve):", bcErr.message); }

  return { status: 200, body: { message: "✅ 付款已確認，預約已生效", booking_id: bookingId } };
}

function rejectPayment(bookingId, reason, adminId, req) {
  if (!bookingId) {
    return { status: 400, body: { success: false, error: "缺少預約 ID" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ? AND status = ?")
    .get(bookingId, "pending_payment");
  if (!booking) {
    return { status: 404, body: { success: false, error: "預約不存在或已處理" } };
  }

  db.prepare("UPDATE bookings SET status = 'cancelled', payment_status = 'refunded' WHERE id = ?")
    .run(bookingId);
  db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?")
    .run(booking.schedule_id);
  db.prepare("UPDATE transactions SET status = 'refunded', description = ? WHERE (fps_reference = ? OR payme_reference = ?) AND status = 'pending'")
    .run(reason || "管理員拒絕付款", booking.fps_reference, booking.payme_reference);

  const classTitleNotifRej = db.prepare("SELECT title FROM classes WHERE id = ?").get(booking.class_id);
  try {
    sendNotification("payment.rejected", {
      recipient: booking.user_id,
      data: { amount: booking.amount, class_title: classTitleNotifRej?.title || "—", reason: reason || "請聯絡管理員查詢" },
    });
  } catch (notifErr) { console.error("⚠️ 發送通知失敗:", notifErr.message); }

  const userNameRej = db.prepare("SELECT name, email FROM users WHERE id = ?").get(booking.user_id);
  setTimeout(() => {
    sendTelegramAlert(
      `❌ <b>管理員已拒絕付款</b>\n👤 用戶：${userNameRej?.name || userNameRej?.email || booking.user_id}\n💰 金額：HK$${booking.amount || 0}\n💳 方式：${booking.fps_reference ? "FPS" : "PayMe"}\n📚 課程：${classTitleNotifRej?.title || "—"}\n📝 原因：${reason || "無提供原因"}\n🆔 Booking：${bookingId}\n⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`
    );
  }, 0);

  try { trackAdminAction(adminId, "reject_payment", { booking_id: bookingId, reason: reason || "無原因" }, req); }
  catch (auditErr) { console.error("⚠️ Audit record failed:", auditErr.message); }

  try {
    writeBlock({
      entityType: "admin_action", entityId: bookingId,
      data: { admin_user: adminId, action: "reject_payment", target_type: "booking", target_id: bookingId, details: { reason: reason || "無原因" } },
    });
  } catch (bcErr) { console.error("⚠️ Blockchain write failed (admin reject):", bcErr.message); }

  return { status: 200, body: { message: "❌ 付款已拒絕，預約已取消", booking_id: bookingId } };
}

// ==================== Stats / Dashboard ====================

function getDashboardStats() {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const stats = {
    total_users: db.prepare("SELECT COUNT(*) as count FROM users").get().count,
    total_bookings: db.prepare("SELECT COUNT(*) as count FROM bookings").get().count,
    confirmed_bookings: db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'confirmed'").get().count,
    pending_payments: db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending_payment' AND (fps_reference IS NOT NULL OR payme_reference IS NOT NULL)").get().count,
    total_classes: db.prepare("SELECT COUNT(*) as count FROM classes WHERE status = 'active'").get().count,
    total_revenue: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM bookings WHERE payment_status = 'paid'").get().total,
    recent_bookings: (function () {
      var data = [];
      for (var i = 6; i >= 0; i--) {
        var day = new Date();
        day.setDate(day.getDate() - i);
        var ds = day.toISOString().split("T")[0];
        var count = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE date(created_at) = ?").get(ds).c;
        data.push(count);
      }
      return data;
    })(),
  };

  return { stats };
}

function getRevenueDashboard() {
  const db = getDb();

  const activeSubscribers = db.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM memberships WHERE status = 'active'"
  ).get().count;

  const totalBookingRevenue = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM booking_payments WHERE status = 'completed'"
  ).get().total;

  const membershipRevenue = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'membership' AND status = 'completed'"
  ).get().total;

  const topupRevenue = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'credits_topup' AND status = 'completed'"
  ).get().total;

  const corporateRevenue = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'single_booking' AND status = 'completed' AND description LIKE '%corporate%'"
  ).get().total;

  const totalRevenue = membershipRevenue + topupRevenue + corporateRevenue + totalBookingRevenue;
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  const avgRevenuePerUser = totalUsers > 0 ? Math.round((totalRevenue / totalUsers) * 100) / 100 : 0;

  const monthlyRevenue = db.prepare(
    `SELECT strftime('%Y-%m', created_at) as month,
            SUM(CASE WHEN type = 'membership' THEN amount ELSE 0 END) as subscription,
            SUM(CASE WHEN type = 'credits_topup' THEN amount ELSE 0 END) as topup,
            SUM(CASE WHEN type = 'single_booking' AND description LIKE '%corporate%' THEN amount ELSE 0 END) as corporate,
            SUM(amount) as total
     FROM transactions WHERE status = 'completed' AND created_at >= datetime('now', '-12 months')
     GROUP BY strftime('%Y-%m', created_at) ORDER BY month`
  ).all();

  const totalForPct = totalRevenue || 1;
  const revenueBreakdown = [
    { source: "membership", label: "會籍", amount: membershipRevenue, percentage: Math.round((membershipRevenue / totalForPct) * 100 * 100) / 100 },
    { source: "topup", label: "增值", amount: topupRevenue, percentage: Math.round((topupRevenue / totalForPct) * 100 * 100) / 100 },
    { source: "corporate", label: "企業", amount: corporateRevenue, percentage: Math.round((corporateRevenue / totalForPct) * 100 * 100) / 100 },
    { source: "booking", label: "單次預約", amount: totalBookingRevenue, percentage: Math.round((totalBookingRevenue / totalForPct) * 100 * 100) / 100 },
  ];

  const recentTransactions = db.prepare(
    `SELECT t.id, t.user_id, u.name as user_name, u.email as user_email,
            t.type, t.amount, t.payment_method, t.status, t.description, t.created_at
     FROM transactions t JOIN users u ON t.user_id = u.id
     WHERE t.status = 'completed' ORDER BY t.created_at DESC LIMIT 20`
  ).all();

  const mrr = db.prepare(
    "SELECT COALESCE(SUM(price_hkd), 0) as total FROM memberships WHERE status = 'active' AND start_date <= datetime('now') AND end_date >= datetime('now')"
  ).get().total;

  return { mrr, totalRevenue, activeSubscribers, avgRevenuePerUser, monthlyRevenue, revenueBreakdown, recentTransactions };
}

// ==================== Booking Management ====================

function listAllBookings(query) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const { status, page = 1, limit = 50 } = query;
  let whereConditions = ["1=1"];
  let params = [];

  if (status) {
    whereConditions.push("b.status = ?");
    params.push(status);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const whereClause = whereConditions.join(" AND ");

  const bookings = db
    .prepare(
      `SELECT b.id, b.user_id, b.amount, b.payment_type, b.payment_status, b.status,
              b.booking_reference, b.fps_reference, b.payme_reference, b.stripe_payment_intent_id,
              b.created_at, u.name as user_name, u.email as user_email, u.user_reference,
              c.title as class_title, c.category, cs.start_time, cs.end_time
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       JOIN classes c ON b.class_id = c.id
       LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE ${whereClause}`).get(...params).count;

  return { bookings, total, page: parseInt(page), limit: parseInt(limit) };
}

// ==================== User Management ====================

function listAllUsers() {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const users = db
    .prepare(
      `SELECT id, user_reference, email, name, phone, credits, membership_type,
              is_coach, coach_verified, created_at
       FROM users ORDER BY created_at DESC`
    )
    .all();

  return { users };
}

function getUserDetail(userId) {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { status: 404, body: { success: false, error: "用戶不存在" } };

  const bookings = db
    .prepare(
      `SELECT b.*, c.title as class_title, cs.start_time, cs.end_time
       FROM bookings b JOIN classes c ON c.id = b.class_id
       LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC`
    )
    .all(userId);

  const transactions = db
    .prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId);

  const membership = db
    .prepare("SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId);

  return { status: 200, body: { user, bookings, transactions, membership } };
}

// ==================== Course Management ====================

function listAllClasses() {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const classes = db
    .prepare(
      `SELECT c.*, c.class_reference, u.name as coach_name, u.user_reference as coach_reference,
              (SELECT COUNT(*) FROM class_schedules WHERE class_id = c.id) as total_schedules,
              (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as total_bookings
       FROM classes c JOIN users u ON c.coach_id = u.id
       ORDER BY c.created_at DESC`
    )
    .all();

  return { classes };
}

function getCourseDetail(courseId) {
  const db = getDb();
  const course = db.prepare("SELECT * FROM classes WHERE id = ?").get(courseId);
  if (!course) return { status: 404, body: { success: false, error: "課程不存在" } };

  const schedules = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status IN ('confirmed','attended')) as enrolled
       FROM class_schedules s WHERE s.class_id = ? AND s.start_time >= datetime('now') ORDER BY s.start_time`
    )
    .all(courseId);

  const scheduleStudents = {};
  for (const s of schedules) {
    const students = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, b.booking_reference, b.status, b.payment_status, b.created_at, b.amount
         FROM bookings b JOIN users u ON u.id = b.user_id
         WHERE b.schedule_id = ? AND b.status IN ('confirmed','attended','pending_payment')
         ORDER BY b.created_at`
      )
      .all(s.id);
    scheduleStudents[s.id] = students;
  }

  return { status: 200, body: { course, schedules, scheduleStudents, total_schedules: schedules.length } };
}

function updateCourse(courseId, body) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const classData = db.prepare("SELECT * FROM classes WHERE id = ?").get(courseId);
  if (!classData) return { status: 404, body: { success: false, error: "課程不存在" } };

  const allowedFields = [
    "title", "title_en", "description", "description_en", "category", "difficulty",
    "duration", "max_participants", "price_hkd", "credits_cost", "venue_name",
    "venue_address", "venue_district", "latitude", "longitude", "image_url", "status",
  ];

  const updates = [];
  const params = [];
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
    }
  }

  if (updates.length === 0) {
    return { status: 400, body: { success: false, error: "沒有要更新的欄位" } };
  }

  updates.push("updated_at = datetime('now')");
  params.push(courseId);
  db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  return { status: 200, body: { success: true, message: "✅ 課程資料已更新" } };
}

function assignCoach(classId, coachId) {
  if (!classId || !coachId) {
    return { status: 400, body: { success: false, error: "缺少課程編號或教練編號" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const classData = db.prepare("SELECT * FROM classes WHERE id = ?").get(classId);
  if (!classData) return { status: 404, body: { success: false, error: "課程不存在" } };

  const coach = db.prepare("SELECT id, name FROM users WHERE id = ? AND is_coach = 1").get(coachId);
  if (!coach) return { status: 404, body: { success: false, error: "教練不存在或未通過認證" } };

  db.prepare("UPDATE classes SET coach_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(coachId, classId);

  return { status: 200, body: { success: true, message: `✅ 已將「${classData.title}」指派給 ${coach.name}` } };
}

// ==================== Coach Management ====================

function listCoachApplications(status) {
  const db = getDb();
  db.pragma("foreign_keys = ON");
  const filterStatus = status || "pending";

  const applications = db
    .prepare(
      `SELECT ca.*, u.email as user_email, u.name as user_name
       FROM coach_applications ca JOIN users u ON u.id = ca.user_id
       WHERE ca.status = ? ORDER BY ca.created_at DESC`
    )
    .all(filterStatus);

  return { applications, total: applications.length };
}

function approveCoach(applicationId, adminId) {
  if (!applicationId) return { status: 400, body: { success: false, error: "缺少申請編號" } };

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const app = db.prepare("SELECT * FROM coach_applications WHERE id = ?").get(applicationId);
  if (!app) return { status: 404, body: { success: false, error: "申請不存在" } };
  if (app.status !== "pending") return { status: 400, body: { success: false, error: "申請已處理" } };

  db.prepare("UPDATE coach_applications SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
    .run(adminId, applicationId);
  db.prepare("UPDATE users SET is_coach = 1, coach_verified = 1 WHERE id = ?").run(app.user_id);

  sendNotification("coach.approved", { recipient: app.user_id, data: { message: "✅ 教練申請已獲批！現在可以開班授課啦！" } });

  try {
    writeBlock({
      entityType: "admin_action", entityId: applicationId,
      data: { admin_user: adminId, action: "coach_approve", target_type: "coach_application", target_id: applicationId, details: { coach_user_id: app.user_id, coach_name: app.name } },
    });
  } catch (bcErr) { console.error("⚠️ Blockchain write failed (coach approve):", bcErr.message); }

  return { status: 200, body: { message: "✅ 教練申請已通過", coach_name: app.name } };
}

function rejectCoach(applicationId, reason, adminId) {
  if (!applicationId) return { status: 400, body: { success: false, error: "缺少申請編號" } };

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const app = db.prepare("SELECT * FROM coach_applications WHERE id = ?").get(applicationId);
  if (!app) return { status: 404, body: { success: false, error: "申請不存在" } };
  if (app.status !== "pending") return { status: 400, body: { success: false, error: "申請已處理" } };

  db.prepare("UPDATE coach_applications SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
    .run(adminId, applicationId);

  sendNotification("coach.rejected", { recipient: app.user_id, data: { message: reason || "❌ 教練申請未獲批，如有疑問請聯絡我們。" } });

  try {
    writeBlock({
      entityType: "admin_action", entityId: applicationId,
      data: { admin_user: adminId, action: "coach_reject", target_type: "coach_application", target_id: applicationId, details: { reason: reason || "無原因" } },
    });
  } catch (bcErr) { console.error("⚠️ Blockchain write failed (coach reject):", bcErr.message); }

  return { status: 200, body: { message: "✅ 已拒絕申請", coach_name: app.name } };
}

function getCoachDetail(coachId) {
  const db = getDb();
  const coach = db.prepare("SELECT * FROM users WHERE id = ? AND is_coach = 1").get(coachId);
  if (!coach) return { status: 404, body: { success: false, error: "教練不存在" } };

  const classes = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM class_schedules WHERE class_id = c.id AND start_time >= datetime('now')) as future_schedules,
              (SELECT COUNT(*) FROM bookings b JOIN class_schedules s ON b.schedule_id = s.id WHERE s.class_id = c.id AND b.status = 'confirmed') as total_bookings
       FROM classes c WHERE c.coach_id = ? ORDER BY c.created_at DESC`
    )
    .all(coachId);

  const earnings = db.prepare("SELECT * FROM coach_earnings WHERE coach_id = ? ORDER BY created_at DESC").all(coachId);
  const payouts = db.prepare("SELECT * FROM coach_payouts WHERE coach_id = ? ORDER BY created_at DESC").all(coachId);

  return { status: 200, body: { coach, classes, earnings, payouts } };
}

// ==================== Payout Processing ====================

function processCoachPayouts(adminId, req) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const coaches = db
    .prepare(
      `SELECT ce.coach_id, u.name as coach_name, u.email as coach_email,
              SUM(ce.net_amount) as total_pending
       FROM coach_earnings ce JOIN users u ON ce.coach_id = u.id
       WHERE ce.status = 'pending'
       GROUP BY ce.coach_id HAVING total_pending > 0`
    )
    .all();

  let processed = 0;
  const results = [];

  for (const coach of coaches) {
    const payoutId = uuidv4();
    const poRef = "PO-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    const fee = Math.max(0, coach.total_pending * 0.01);
    const netAmount = coach.total_pending - fee;

    db.prepare("INSERT INTO coach_payouts (id, payout_reference, coach_id, amount, fee, net_amount, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, 'bank', 'processing')")
      .run(payoutId, poRef, coach.coach_id, coach.total_pending, fee, netAmount);
    db.prepare("UPDATE coach_earnings SET status = 'paid', payout_id = ? WHERE coach_id = ? AND status = 'pending'")
      .run(payoutId, coach.coach_id);
    db.prepare("UPDATE users SET pending_payout = 0, total_earnings = COALESCE(total_earnings, 0) + ? WHERE id = ?")
      .run(netAmount, coach.coach_id);

    try {
      sendNotification("coach.payout_processed", {
        recipient: coach.coach_id,
        data: { amount: coach.total_pending, status: "processing", reason: "管理員批量出糧", eta: "3-5 個工作日" },
      });
    } catch (notifErr) { console.error("⚠️ 發送出糧通知失敗:", notifErr.message); }

    processed++;
    results.push({ coach_name: coach.coach_name, amount: coach.total_pending, fee, net_amount: netAmount, payout_reference: poRef });
  }

  // Audit
  try {
    audit({
      actionType: "payout.create", entityType: "payout_batch",
      entityId: "batch-" + Date.now(), userId: adminId,
      newValues: { total: results.length, processed, results },
      description: `管理員批量出糧：${processed} 位教練，共 HK$${results.reduce((s, r) => s + (r.amount || 0), 0)}`,
      ipAddress: req.ip, userAgent: req.headers["user-agent"],
    });
  } catch (auditErr) { console.error("⚠️ Audit record failed:", auditErr.message); }

  // Blockchain
  try {
    writeBlock({
      entityType: "admin_action", entityId: `payout-batch-${Date.now()}`,
      data: { admin_user: adminId, action: "process_payouts", target_type: "coach_payout", target_id: `batch-${Date.now()}`, details: { coaches_processed: processed, total_amount: results.reduce((s, r) => s + (r.amount || 0), 0) } },
    });
  } catch (bcErr) { console.error("⚠️ Blockchain write failed (process payouts):", bcErr.message); }

  return {
    status: 200,
    body: { message: processed > 0 ? `已爲 ${processed} 位教練處理出糧` : "沒有待出糧的教練", processed, results },
  };
}

function listPayouts(query) {
  const db = getDb();
  const { status, page = 1, limit = 50 } = query;
  let where = "WHERE 1=1";
  const params = [];

  if (status) { where += " AND cp.status = ?"; params.push(status); }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const payouts = db
    .prepare(
      `SELECT cp.*, u.name as coach_name, u.email as coach_email
       FROM coach_payouts cp JOIN users u ON cp.coach_id = u.id ${where}
       ORDER BY cp.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM coach_payouts cp ${where}`).get(...params).count;

  const summary = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN cp.status IN ('pending','processing') THEN cp.net_amount ELSE 0 END), 0) as pending_total,
              COALESCE(SUM(CASE WHEN cp.status = 'paid' THEN cp.net_amount ELSE 0 END), 0) as paid_total,
              COUNT(DISTINCT cp.coach_id) as total_coaches
       FROM coach_payouts cp`
    )
    .get();

  return { payouts, total, summary, page: parseInt(page), limit: parseInt(limit) };
}

// ==================== Notify Course Spots ====================

function notifyCourseSpots(classId, message) {
  if (!classId) return { status: 400, body: { success: false, error: "缺少課程編號" } };

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const course = db.prepare("SELECT * FROM classes WHERE id = ?").get(classId);
  if (!course) return { status: 404, body: { success: false, error: "課程不存在" } };

  const category = course.category;
  const title = course.title;

  const interestedUsers = db
    .prepare(
      `SELECT DISTINCT b.user_id FROM bookings b JOIN classes c ON b.class_id = c.id
       WHERE c.category = ? AND b.status IN ('confirmed', 'attended') AND b.user_id IS NOT NULL
       UNION
       SELECT DISTINCT ua.user_id FROM user_actions ua
       WHERE ua.category = ? AND ua.action IN ('view_class', 'book_class', 'favorite') AND ua.user_id IS NOT NULL`
    )
    .all(category, category);

  if (interestedUsers.length === 0) {
    return { status: 200, body: { notified: 0, message: "暫無有興趣嘅學員" } };
  }

  let notifiedCount = 0;
  const finalMessage = message || `📢 「${title}」有大量空位，快啲預約啦！`;

  for (const ui of interestedUsers) {
    try {
      sendNotification("booking.confirmed", { recipient: ui.user_id, data: { message: finalMessage } });
      notifiedCount++;
    } catch (notifErr) { console.error("通知發送失敗:", notifErr.message); }
  }

  return { status: 200, body: { notified: notifiedCount, message: `已通知 ${notifiedCount} 位有興趣學員` } };
}

// ==================== Exports ====================

module.exports = {
  // Payment
  listPendingPayments,
  approvePayment,
  rejectPayment,

  // Dashboard / Stats
  getDashboardStats,
  getRevenueDashboard,

  // Booking management
  listAllBookings,

  // User management
  listAllUsers,
  getUserDetail,

  // Course management
  listAllClasses,
  getCourseDetail,
  updateCourse,
  assignCoach,

  // Coach management
  listCoachApplications,
  approveCoach,
  rejectCoach,
  getCoachDetail,

  // Payout management
  processCoachPayouts,
  listPayouts,

  // Notifications
  notifyCourseSpots,
};
