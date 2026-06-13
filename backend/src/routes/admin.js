/**
 * ZenPass 禪流 - 管理員路由
 * 付款驗證、預約管理、用戶管理
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const {
  sendNotification,
  sendTelegramAlert,
} = require("../services/notification");
const { audit, trackAdminAction, queryAudit } = require("../services/audit");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/admin/pending-payments — 待確認付款列表 =====
router.get("/pending-payments", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const pending = db
      .prepare(
        `
      SELECT 
        b.id as booking_id,
        b.booking_reference,
        b.user_id,
        u.user_reference,
        c.class_reference,
        b.amount,
        b.fps_reference,
        b.payme_reference,
        b.receipt_image,
        COALESCE(b.payment_method, 
          CASE WHEN b.fps_reference IS NOT NULL THEN 'fps'
               WHEN b.payme_reference IS NOT NULL THEN 'payme'
               ELSE 'unknown' END
        ) as payment_method,
        b.class_id,
        b.created_at as booked_at,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        c.title as class_title,
        c.category,
        cs.start_time,
        cs.end_time
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.status = 'pending_payment'
      AND (b.fps_reference IS NOT NULL OR b.payme_reference IS NOT NULL)
      AND b.payment_status = 'pending'
      ORDER BY b.created_at ASC
    `,
      )
      .all();

    db.close();

    res.json({ pending_payments: pending });
  } catch (err) {
    console.error("取待確認付款錯誤:", err);
    res.status(500).json({ error: "無法取得待確認付款" });
  }
});

// ===== POST /api/admin/approve-payment — 確認付款 =====
router.post("/approve-payment", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { booking_id } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: "缺少預約 ID" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const booking = db
      .prepare("SELECT * FROM bookings WHERE id = ? AND status = ?")
      .get(booking_id, "pending_payment");
    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在或已處理" });
    }

    // Confirm booking + mark payment as paid
    db.prepare(
      `
      UPDATE bookings SET status = 'confirmed', payment_status = 'paid'
      WHERE id = ?
    `,
    ).run(booking_id);

    // Auto-calculate coach earnings
    try {
      const { syncCoachEarningsForSchedule } = require("./coach-earnings");
      syncCoachEarningsForSchedule(booking.schedule_id);
    } catch (e) {
      console.error("auto coach earnings:", e.message);
    }

    // Update transaction status
    db.prepare(
      `
      UPDATE transactions SET status = 'completed', description = '管理員已確認付款'
      WHERE (fps_reference = ? OR payme_reference = ?) AND status = 'pending'
    `,
    ).run(booking.fps_reference, booking.payme_reference);

    // 🔔 通知學生：付款已確認 (in-app)
    const classTitleNotif = db
      .prepare("SELECT title FROM classes WHERE id = ?")
      .get(booking.class_id);
    try {
      sendNotification("payment.approved", {
        recipient: booking.user_id,
        data: {
          amount: booking.amount,
          class_title: classTitleNotif?.title || "—",
        },
      });
    } catch (notifErr) {
      console.error("⚠️ 發送通知失敗:", notifErr.message);
    }

    // 🔔 ADMIN TELEGRAM：通知管理員確認結果
    const userName = db
      .prepare("SELECT name, email FROM users WHERE id = ?")
      .get(booking.user_id);
    setTimeout(() => {
      sendTelegramAlert(
        `✅ <b>管理員已確認付款</b>\n` +
          `👤 用戶：${userName?.name || userName?.email || booking.user_id}\n` +
          `💰 金額：HK$${booking.amount || 0}\n` +
          `💳 方式：${booking.fps_reference ? "FPS" : "PayMe"}\n` +
          `📚 課程：${classTitleNotif?.title || "—"}\n` +
          `🆔 Booking：${booking_id}\n` +
          `⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`,
      );
    }, 0);

    // 📊 ACCOUNTING：管理員確認付款記帳
    try {
      const {
        recordPayment,
        recordCommission,
      } = require("../services/accounting");
      recordPayment(
        booking_id,
        booking.user_id,
        booking.amount || 0,
        booking.fps_reference ? "fps" : "payme",
      );
      const commissionAmt =
        Math.round(
          (booking.amount || 0) *
            (booking.platform_commission_rate || 0.2) *
            100,
        ) / 100;
      if (commissionAmt > 0) {
        recordCommission(
          booking_id,
          booking.user_id,
          commissionAmt,
          booking.fps_reference ? "fps" : "payme",
        );
      }
    } catch (acctErr) {
      console.error("⚠️ Accounting entry failed:", acctErr.message);
    }

    // 🔔 AUDIT：管理員確認付款
    try {
      trackAdminAction(
        req.user.id,
        "approve_payment",
        {
          booking_id,
          amount: booking?.amount,
        },
        req,
      );
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    db.close();

    res.json({
      message: "✅ 付款已確認，預約已生效",
      booking_id,
    });
  } catch (err) {
    console.error("確認付款錯誤:", err);
    res.status(500).json({ error: "確認付款失敗" });
  }
});

// ===== POST /api/admin/reject-payment — 拒絕付款 =====
router.post("/reject-payment", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { booking_id, reason } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: "缺少預約 ID" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const booking = db
      .prepare("SELECT * FROM bookings WHERE id = ? AND status = ?")
      .get(booking_id, "pending_payment");
    if (!booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在或已處理" });
    }

    // Cancel booking, refund payment status
    db.prepare(
      `
      UPDATE bookings SET status = 'cancelled', payment_status = 'refunded'
      WHERE id = ?
    `,
    ).run(booking_id);

    // Release the slot
    db.prepare(
      "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?",
    ).run(booking.schedule_id);

    // Update transaction
    db.prepare(
      `
      UPDATE transactions SET status = 'refunded', description = ?
      WHERE (fps_reference = ? OR payme_reference = ?) AND status = 'pending'
    `,
    ).run(
      reason || "管理員拒絕付款",
      booking.fps_reference,
      booking.payme_reference,
    );

    // 🔔 通知學生：付款被拒絕 (in-app)
    const classTitleNotifRej = db
      .prepare("SELECT title FROM classes WHERE id = ?")
      .get(booking.class_id);
    try {
      sendNotification("payment.rejected", {
        recipient: booking.user_id,
        data: {
          amount: booking.amount,
          class_title: classTitleNotifRej?.title || "—",
          reason: reason || "請聯絡管理員查詢",
        },
      });
    } catch (notifErr) {
      console.error("⚠️ 發送通知失敗:", notifErr.message);
    }

    // 🔔 ADMIN TELEGRAM：通知管理員拒絕結果
    const userNameRej = db
      .prepare("SELECT name, email FROM users WHERE id = ?")
      .get(booking.user_id);
    setTimeout(() => {
      sendTelegramAlert(
        `❌ <b>管理員已拒絕付款</b>\n` +
          `👤 用戶：${userNameRej?.name || userNameRej?.email || booking.user_id}\n` +
          `💰 金額：HK$${booking.amount || 0}\n` +
          `💳 方式：${booking.fps_reference ? "FPS" : "PayMe"}\n` +
          `📚 課程：${classTitleNotifRej?.title || "—"}\n` +
          `📝 原因：${reason || "無提供原因"}\n` +
          `🆔 Booking：${booking_id}\n` +
          `⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`,
      );
    }, 0);

    // 🔔 AUDIT：管理員拒絕付款
    try {
      trackAdminAction(
        req.user.id,
        "reject_payment",
        {
          booking_id,
          reason: reason || "無原因",
        },
        req,
      );
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    db.close();

    res.json({
      message: "❌ 付款已拒絕，預約已取消",
      booking_id,
    });
  } catch (err) {
    console.error("拒絕付款錯誤:", err);
    res.status(500).json({ error: "拒絕付款失敗" });
  }
});

// ===== GET /api/admin/stats — Dashboard 統計 =====
router.get("/stats", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const stats = {
      total_users: db.prepare("SELECT COUNT(*) as count FROM users").get()
        .count,
      total_bookings: db.prepare("SELECT COUNT(*) as count FROM bookings").get()
        .count,
      confirmed_bookings: db
        .prepare(
          "SELECT COUNT(*) as count FROM bookings WHERE status = 'confirmed'",
        )
        .get().count,
      pending_payments: db
        .prepare(
          "SELECT COUNT(*) as count FROM bookings WHERE status = 'pending_payment' AND (fps_reference IS NOT NULL OR payme_reference IS NOT NULL)",
        )
        .get().count,
      total_classes: db
        .prepare(
          "SELECT COUNT(*) as count FROM classes WHERE status = 'active'",
        )
        .get().count,
      total_revenue: db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) as total FROM bookings WHERE payment_status = 'paid'",
        )
        .get().total,
      recent_bookings: (function () {
        var data = [];
        for (var i = 6; i >= 0; i--) {
          var day = new Date();
          day.setDate(day.getDate() - i);
          var ds = day.toISOString().split("T")[0];
          var count = db
            .prepare(
              "SELECT COUNT(*) as c FROM bookings WHERE date(created_at) = ?",
            )
            .get(ds).c;
          data.push(count);
        }
        return data;
      })(),
    };

    db.close();
    res.json({ stats });
  } catch (err) {
    console.error("取統計錯誤:", err);
    res.status(500).json({ error: "無法取得統計資料" });
  }
});

// ===== GET /api/admin/bookings — 所有預約記錄 =====
router.get("/bookings", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const { status, page = 1, limit = 50 } = req.query;
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
        `
      SELECT 
        b.id, b.user_id, b.amount, b.payment_type, b.payment_status, b.status,
        b.booking_reference, b.fps_reference, b.payme_reference, b.stripe_payment_intent_id,
        b.created_at,
        u.name as user_name, u.email as user_email, u.user_reference,
        c.title as class_title, c.category, c.class_reference,
        cs.start_time, cs.end_time
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, parseInt(limit), offset);

    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM bookings b WHERE ${whereClause}
    `,
      )
      .get(...params).count;

    db.close();
    res.json({ bookings, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("取預約記錄錯誤:", err);
    res.status(500).json({ error: "無法取得預約記錄" });
  }
});

// ===== GET /api/admin/users — 用戶列表 =====
router.get("/users", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const users = db
      .prepare(
        `
      SELECT id, user_reference, email, name, phone, credits, membership_type, 
             is_coach, coach_verified, created_at
      FROM users
      ORDER BY created_at DESC
    `,
      )
      .all();

    db.close();
    res.json({ users });
  } catch (err) {
    console.error("取用戶列表錯誤:", err);
    res.status(500).json({ error: "無法取得用戶列表" });
  }
});

// ===== GET /api/admin/classes — 課程列表 =====
router.get("/classes", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const classes = db
      .prepare(
        `
      SELECT c.*, c.class_reference, u.name as coach_name, u.user_reference as coach_reference,
        (SELECT COUNT(*) FROM class_schedules WHERE class_id = c.id) as total_schedules,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as total_bookings
      FROM classes c
      JOIN users u ON c.coach_id = u.id
      ORDER BY c.created_at DESC
    `,
      )
      .all();

    db.close();
    res.json({ classes });
  } catch (err) {
    console.error("取課程列表錯誤:", err);
    res.status(500).json({ error: "無法取得課程列表" });
  }
});

// ===== GET /api/admin/db/:table — 瀏覽任何資料表 =====
router.get("/db/:table", async (req, res) => {
  try {
    const { getSupabase } = require("../services/supabase");
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "DB not connected" });

    const { table } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    // Get data
    const { data, error } = await supabase.from(table).select("*").limit(limit);
    if (error) throw error;

    // Get count
    const { count, error: countErr } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    res.json({
      data: data || [],
      count: count || 0,
      error: countErr?.message || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/admin/db — 列出所有表 + 記錄數 =====
router.get("/db", async (req, res) => {
  try {
    const { getSupabase } = require("../services/supabase");
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "DB not connected" });

    const tables = [
      "system_config",
      "system_backups",
      "courses",
      "course_sessions",
      "course_categories",
      "bookings",
      "transactions",
      "settlements",
      "users",
      "profiles",
      "coaches",
      "students",
      "membership_plans",
      "user_memberships",
      "payments",
      "commissions",
      "payouts",
      "venues",
      "partners",
      "attendance",
      "reviews",
      "notifications",
      "waitlist",
      "promotions",
    ];

    const result = [];
    for (const t of tables) {
      try {
        const { count } = await supabase
          .from(t)
          .select("*", { count: "exact", head: true });
        result.push({ table: t, count: count || 0 });
      } catch (e) {
        result.push({ table: t, count: -1, error: e.message });
      }
    }

    res.json({ tables: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/admin/process-payouts — 管理員批量處理教練出糧 =====
router.post("/process-payouts", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 計算所有 coach 嘅 pending earnings
    const coaches = db
      .prepare(
        `
      SELECT ce.coach_id, u.name as coach_name, u.email as coach_email,
             SUM(ce.net_amount) as total_pending
      FROM coach_earnings ce
      JOIN users u ON ce.coach_id = u.id
      WHERE ce.status = 'pending'
      GROUP BY ce.coach_id
      HAVING total_pending > 0
    `,
      )
      .all();

    let processed = 0;
    const results = [];

    for (const coach of coaches) {
      // Create payout record
      const payoutId = require("uuid").v4();
      const poRef =
        "PO-" +
        new Date().toISOString().slice(0, 10).replace(/-/g, "") +
        "-" +
        Math.random().toString(36).substring(2, 6).toUpperCase();
      const fee = Math.max(0, coach.total_pending * 0.01); // 1% processing fee
      const netAmount = coach.total_pending - fee;

      db.prepare(
        `
        INSERT INTO coach_payouts (id, payout_reference, coach_id, amount, fee, net_amount, payment_method, status)
        VALUES (?, ?, ?, ?, ?, ?, 'bank', 'processing')
      `,
      ).run(
        payoutId,
        poRef,
        coach.coach_id,
        coach.total_pending,
        fee,
        netAmount,
      );

      // Mark all pending earnings for this coach as paid
      db.prepare(
        `
        UPDATE coach_earnings SET status = 'paid', payout_id = ?
        WHERE coach_id = ? AND status = 'pending'
      `,
      ).run(payoutId, coach.coach_id);

      // Update user totals
      db.prepare(
        `
        UPDATE users SET pending_payout = 0, total_earnings = COALESCE(total_earnings, 0) + ?
        WHERE id = ?
      `,
      ).run(netAmount, coach.coach_id);

      // Notification
      try {
        const { sendNotification } = require("../services/notification");
        sendNotification("coach.payout_processed", {
          recipient: coach.coach_id,
          data: {
            amount: coach.total_pending,
            status: "processing",
            reason: "管理員批量出糧",
            eta: "3-5 個工作日",
          },
        });
      } catch (notifErr) {
        console.error("⚠️ 發送出糧通知失敗:", notifErr.message);
      }

      processed++;
      results.push({
        coach_name: coach.coach_name,
        amount: coach.total_pending,
        fee: fee,
        net_amount: netAmount,
        payout_reference: poRef,
      });
    }

    // 🔔 AUDIT：管理員批量出糧
    try {
      audit({
        actionType: "payout.create",
        entityType: "payout_batch",
        entityId: "batch-" + Date.now(),
        userId: req.user.id,
        newValues: { total: results.length, processed, results },
        description: `管理員批量出糧：${processed} 位教練，共 HK$${results.reduce((s, r) => s + (r.amount || 0), 0)}`,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    db.close();

    res.json({
      message:
        processed > 0 ? `已爲 ${processed} 位教練處理出糧` : "沒有待出糧的教練",
      processed: processed,
      results: results,
    });
  } catch (err) {
    console.error("批量出糧錯誤:", err);
    res.status(500).json({ error: "出糧處理失敗" });
  }
});

// ===== GET /api/admin/payouts — 管理員查看所有出糧記錄 =====
router.get("/payouts", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);

    const { status, page = 1, limit = 50 } = req.query;
    let where = "WHERE 1=1";
    const params = [];

    if (status) {
      where += " AND cp.status = ?";
      params.push(status);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const payouts = db
      .prepare(
        `
      SELECT cp.*, u.name as coach_name, u.email as coach_email
      FROM coach_payouts cp
      JOIN users u ON cp.coach_id = u.id
      ${where}
      ORDER BY cp.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, parseInt(limit), offset);

    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM coach_payouts cp ${where}
    `,
      )
      .get(...params).count;

    const summary = db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(CASE WHEN cp.status IN ('pending','processing') THEN cp.net_amount ELSE 0 END), 0) as pending_total,
        COALESCE(SUM(CASE WHEN cp.status = 'paid' THEN cp.net_amount ELSE 0 END), 0) as paid_total,
        COUNT(DISTINCT cp.coach_id) as total_coaches
      FROM coach_payouts cp
    `,
      )
      .get();

    db.close();

    res.json({
      payouts,
      total,
      summary,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error("取 payout 記錄錯誤:", err);
    res.status(500).json({ error: "無法獲取出糧記錄" });
  }
});

// ===== 教練申請審批 =====
router.get(
  "/coach-applications",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");
      const { status = "pending" } = req.query;

      const applications = db
        .prepare(
          `SELECT ca.*, u.email as user_email, u.name as user_name
         FROM coach_applications ca
         JOIN users u ON u.id = ca.user_id
         WHERE ca.status = ?
         ORDER BY ca.created_at DESC`,
        )
        .all(status);

      db.close();
      res.json({ applications, total: applications.length });
    } catch (err) {
      console.error("取教練申請錯誤:", err);
      res.status(500).json({ error: "無法獲取教練申請" });
    }
  },
);

router.post("/coach-approve", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { application_id } = req.body;
    if (!application_id) {
      return res.status(400).json({ error: "缺少申請編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const app = db
      .prepare("SELECT * FROM coach_applications WHERE id = ?")
      .get(application_id);
    if (!app) {
      db.close();
      return res.status(404).json({ error: "申請不存在" });
    }
    if (app.status !== "pending") {
      db.close();
      return res.status(400).json({ error: "申請已處理" });
    }

    // Update application status
    db.prepare(
      "UPDATE coach_applications SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
    ).run(req.user.id, application_id);

    // Update user as coach
    db.prepare(
      "UPDATE users SET is_coach = 1, coach_verified = 1 WHERE id = ?",
    ).run(app.user_id);

    // Send notification
    sendNotification("coach.approved", {
      recipient: app.user_id,
      data: { message: "✅ 教練申請已獲批！現在可以開班授課啦！" },
    });

    db.close();

    res.json({
      message: "✅ 教練申請已通過",
      coach_name: app.name,
    });
  } catch (err) {
    console.error("審批教練錯誤:", err);
    res.status(500).json({ error: "審批失敗" });
  }
});

router.post("/coach-reject", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { application_id, reason } = req.body;
    if (!application_id) {
      return res.status(400).json({ error: "缺少申請編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const app = db
      .prepare("SELECT * FROM coach_applications WHERE id = ?")
      .get(application_id);
    if (!app) {
      db.close();
      return res.status(404).json({ error: "申請不存在" });
    }
    if (app.status !== "pending") {
      db.close();
      return res.status(400).json({ error: "申請已處理" });
    }

    db.prepare(
      "UPDATE coach_applications SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
    ).run(req.user.id, application_id);

    sendNotification("coach.rejected", {
      recipient: app.user_id,
      data: { message: reason || "❌ 教練申請未獲批，如有疑問請聯絡我們。" },
    });

    db.close();

    res.json({
      message: "✅ 已拒絕申請",
      coach_name: app.name,
    });
  } catch (err) {
    console.error("拒絕教練錯誤:", err);
    res.status(500).json({ error: "操作失敗" });
  }
});

// ===== GET /api/admin/course-detail/:id — 課程詳細資料（含報名學生） =====
router.get(
  "/course-detail/:id",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      const course = db
        .prepare("SELECT * FROM classes WHERE id = ?")
        .get(req.params.id);
      if (!course) {
        db.close();
        return res.status(404).json({ error: "課程不存在" });
      }

      const schedules = db
        .prepare(
          "SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status IN ('confirmed','attended')) as enrolled FROM class_schedules s WHERE s.class_id = ? AND s.start_time >= datetime('now') ORDER BY s.start_time",
        )
        .all(req.params.id);

      // For each schedule, get enrolled students
      const scheduleStudents = {};
      for (const s of schedules) {
        const students = db
          .prepare(
            "SELECT u.id, u.name, u.email, u.phone, b.booking_reference, b.status, b.payment_status, b.created_at, b.amount FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.schedule_id = ? AND b.status IN ('confirmed','attended','pending_payment') ORDER BY b.created_at",
          )
          .all(s.id);
        scheduleStudents[s.id] = students;
      }

      db.close();
      res.json({
        course,
        schedules,
        scheduleStudents,
        total_schedules: schedules.length,
      });
    } catch (err) {
      console.error("取課程詳情錯誤:", err);
      res.status(500).json({ error: "無法獲取課程詳情" });
    }
  },
);

// ===== GET /api/admin/user-detail/:id — 用戶詳細資料（含預約紀錄） =====
router.get("/user-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.params.id);
    if (!user) {
      db.close();
      return res.status(404).json({ error: "用戶不存在" });
    }

    const bookings = db
      .prepare(
        "SELECT b.*, c.title as class_title, cs.start_time, cs.end_time FROM bookings b JOIN classes c ON c.id = b.class_id LEFT JOIN class_schedules cs ON cs.id = b.schedule_id WHERE b.user_id = ? ORDER BY b.created_at DESC",
      )
      .all(req.params.id);

    const transactions = db
      .prepare(
        "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(req.params.id);

    const membership = db
      .prepare(
        "SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(req.params.id);

    db.close();
    res.json({ user, bookings, transactions, membership });
  } catch (err) {
    console.error("取用戶詳情錯誤:", err);
    res.status(500).json({ error: "無法獲取用戶詳情" });
  }
});

// ===== GET /api/admin/coach-detail/:id — 教練詳細資料（含課程、收入） =====
router.get("/coach-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const coach = db
      .prepare("SELECT * FROM users WHERE id = ? AND is_coach = 1")
      .get(req.params.id);
    if (!coach) {
      db.close();
      return res.status(404).json({ error: "教練不存在" });
    }

    const classes = db
      .prepare(
        "SELECT c.*, (SELECT COUNT(*) FROM class_schedules WHERE class_id = c.id AND start_time >= datetime('now')) as future_schedules, (SELECT COUNT(*) FROM bookings b JOIN class_schedules s ON b.schedule_id = s.id WHERE s.class_id = c.id AND b.status = 'confirmed') as total_bookings FROM classes c WHERE c.coach_id = ? ORDER BY c.created_at DESC",
      )
      .all(req.params.id);

    const earnings = db
      .prepare(
        "SELECT * FROM coach_earnings WHERE coach_id = ? ORDER BY created_at DESC",
      )
      .all(req.params.id);

    const payouts = db
      .prepare(
        "SELECT * FROM coach_payouts WHERE coach_id = ? ORDER BY created_at DESC",
      )
      .all(req.params.id);

    db.close();
    res.json({ coach, classes, earnings, payouts });
  } catch (err) {
    console.error("取教練詳情錯誤:", err);
    res.status(500).json({ error: "無法獲取教練詳情" });
  }
});

// ===== POST /api/admin/assign-coach — 管理員指派教練負責課程 =====
router.post("/assign-coach", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { class_id, coach_id } = req.body;
    if (!class_id || !coach_id) {
      return res.status(400).json({ error: "缺少課程編號或教練編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 檢查課程是否存在
    const classData = db
      .prepare("SELECT * FROM classes WHERE id = ?")
      .get(class_id);
    if (!classData) {
      db.close();
      return res.status(404).json({ error: "課程不存在" });
    }

    // 檢查教練是否存在
    const coach = db
      .prepare("SELECT id, name FROM users WHERE id = ? AND is_coach = 1")
      .get(coach_id);
    if (!coach) {
      db.close();
      return res.status(404).json({ error: "教練不存在或未通過認證" });
    }

    // 更新課程教練
    db.prepare(
      "UPDATE classes SET coach_id = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(coach_id, class_id);
    db.close();

    res.json({
      success: true,
      message: `✅ 已將「${classData.title}」指派給 ${coach.name}`,
    });
  } catch (err) {
    console.error("指派教練錯誤:", err);
    res.status(500).json({ error: "指派教練失敗" });
  }
});

// ===== POST /api/admin/notify-course-spots — 通知有興趣學員課程空位 =====
router.post(
  "/notify-course-spots",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      var { class_id, message } = req.body;

      if (!class_id) {
        return res.status(400).json({ error: "缺少課程編號" });
      }

      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      // 獲取課程資料
      var course = db
        .prepare("SELECT * FROM classes WHERE id = ?")
        .get(class_id);
      if (!course) {
        db.close();
        return res.status(404).json({ error: "課程不存在" });
      }

      var category = course.category;
      var title = course.title;

      // 搵出有興趣嘅用戶：
      // 1. 曾經預約相同類別課程（包括已出席）
      // 2. 曾經瀏覽/收藏相同類別課程
      var interestedUsers = db
        .prepare(
          `
      SELECT DISTINCT b.user_id
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE c.category = ?
        AND b.status IN ('confirmed', 'attended')
        AND b.user_id IS NOT NULL
      UNION
      SELECT DISTINCT ua.user_id
      FROM user_actions ua
      WHERE ua.category = ?
        AND ua.action IN ('view_class', 'book_class', 'favorite')
        AND ua.user_id IS NOT NULL
    `,
        )
        .all(category, category);

      if (interestedUsers.length === 0) {
        db.close();
        return res.json({ notified: 0, message: "暫無有興趣嘅學員" });
      }

      var notifiedCount = 0;
      var finalMessage = message || `📢 「${title}」有大量空位，快啲預約啦！`;

      for (var ui = 0; ui < interestedUsers.length; ui++) {
        try {
          sendNotification("booking.confirmed", {
            recipient: interestedUsers[ui].user_id,
            data: { message: finalMessage },
          });
          notifiedCount++;
        } catch (notifErr) {
          console.error("通知發送失敗:", notifErr.message);
        }
      }

      db.close();

      res.json({
        notified: notifiedCount,
        message: `已通知 ${notifiedCount} 位有興趣學員`,
      });
    } catch (err) {
      console.error("通知課程空位錯誤:", err);
      res.status(500).json({ error: "通知失敗" });
    }
  },
);

// ===== PUT /api/admin/update-course/:id — 管理員更新課程資料 =====
router.put(
  "/update-course/:id",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      const classData = db
        .prepare("SELECT * FROM classes WHERE id = ?")
        .get(req.params.id);
      if (!classData) {
        db.close();
        return res.status(404).json({ error: "課程不存在" });
      }

      const allowedFields = [
        "title",
        "title_en",
        "description",
        "description_en",
        "category",
        "difficulty",
        "duration",
        "max_participants",
        "price_hkd",
        "credits_cost",
        "venue_name",
        "venue_address",
        "venue_district",
        "latitude",
        "longitude",
        "image_url",
        "status",
      ];

      const updates = [];
      const params = [];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }

      if (updates.length === 0) {
        db.close();
        return res.status(400).json({ error: "沒有要更新的欄位" });
      }

      updates.push("updated_at = datetime('now')");
      params.push(req.params.id);

      db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(
        ...params,
      );
      db.close();

      res.json({ success: true, message: "✅ 課程資料已更新" });
    } catch (err) {
      console.error("更新課程錯誤:", err);
      res.status(500).json({ error: "更新課程失敗" });
    }
  },
);

// ===== POST /api/admin/generate-description — AI 自動生成課程描述 =====
// 多範本 AI 描述系統 — 按課程名稱關鍵詞匹配最合適嘅描述
// 每個分類有多個範本，由關鍵詞匹配決定用邊個
const DESCRIPTION_TEMPLATES = {
  瑜伽: {
    keywords: {
      空中: [
        "%s 利用空中瑜伽吊床（Hammock）進行懸吊練習，透過反重力動作幫助脊柱減壓、改善血液循環。由導師從基本掛布動作教起，適合想挑戰新事物嘅學員。",
        "%s 喺空中吊床上進行各種瑜伽動作，利用地心引力進行深度伸展同核心鍛鍊。課程由經驗導師指導，確保安全同正確姿勢。",
      ],
      熱: [
        "%s 喺溫暖嘅課室中進行瑜伽練習，幫助肌肉更容易放鬆伸展。課堂包含流暢嘅體位法串聯，適合想排毒出汗、提升柔軟度嘅學員。",
      ],
      "哈達|Hatha": [
        "%s 以傳統哈達瑜伽為基礎，每個動作停留幾個呼吸，專注於正確對位同身體覺察。課堂節奏較慢，適合想深入了解瑜伽基礎嘅學員。",
      ],
      "Flow|流": [
        "%s 以流暢嘅動作串聯（Vinyasa）為主，將呼吸與動作同步，喺動態練習中提升肌力、柔韌度同心肺功能。",
      ],
      "陰|Yin|深|深層": [
        "%s 以長時間停留的被動伸展為主，針對深層結締組織進行放鬆。課堂節奏緩慢，配合靜態保持，幫助釋放身體深層嘅緊張。",
      ],
      "冥想|Meditation": [
        "%s 結合格位法練習與冥想引導，喺動與靜之間尋找平衡。課堂包含呼吸練習、體位法同靜坐環節，幫助身心整合。",
      ],
      "初學|基礎|入門|Beginner": [
        "%s 專為瑜伽初學者設計，由基本體位法（Asana）開始教起，逐步建立正確姿勢同呼吸習慣。小班教學，確保每位學員得到足夠指導。",
      ],
      "孕|產前|Prenatal": [
        "%s 專為孕期婦女設計，透過安全嘅瑜伽動作幫助舒緩懷孕期間嘅身體不適，強化骨盆底肌，為生產做好準備。",
      ],
    },
    default: [
      "%s 透過瑜伽體位法、呼吸練習與放鬆技巧，幫助學員提升身體柔軟度、增強核心力量，同時舒緩壓力，讓身心達到平衡。",
      "%s 由經驗導師帶領，透過流暢嘅動作串聯與靜態伸展，改善身體靈活性同姿勢，帶給你身心舒暢嘅體驗。",
      "%s 融合傳統瑜伽練習與現代運動概念，幫助你喺安全嘅環境中探索身體嘅潛能，提升柔韌度與肌力。",
      "%s 課堂包含呼吸協調、體位法練習同深層放鬆，適合任何程度嘅學員參加。由導師循序漸進引導，讓身體慢慢打開。",
      "%s 透過有系統嘅瑜伽練習，逐步提升身體覺察力同控制能力。每堂課都會因應學員狀況調整內容，確保安全有效。",
      "%s 提供一個寧靜嘅空間讓你暫時遠離日常煩囂，專注於身體同呼吸。適合任何想透過瑜伽放鬆身心嘅人士。",
    ],
  },
  健身: {
    keywords: {
      "HIIT|高強度|間歇|燃脂": [
        "%s 以高強度間歇訓練（HIIT）為核心，短時間內進行高強度動作配合短暫休息，有效提升代謝率同燃脂效果。",
        "%s 透過短時間高強度訓練，讓身體喺運動後持續燃燒卡路里。適合想用最短時間達到最佳效果嘅學員。",
      ],
      "TRX|懸吊": [
        "%s 利用 TRX 懸吊系統，以自身體重進行多平面訓練，重點鍛鍊核心穩定性同全身肌力。",
      ],
      "跑步|Run|Running": [
        "%s 由專業跑步教練帶領，學習正確跑姿、呼吸節奏同訓練方法，適合想提升跑步表現或開始跑步嘅學員。",
      ],
      "CrossFit|Crossfit|綜合體能": [
        "%s 結合多種功能性動作，喺高效嘅訓練中全面提升肌力、爆發力、耐力同心肺功能。課堂氣氛積極，適合喜歡挑戰嘅學員。",
      ],
      "街頭|Street|Calisthenics|徒手": [
        "%s 以自身體重進行街頭健身訓練，包括掌上壓、引體上升等經典動作，由教練從基本動作教起，逐步提升難度。",
      ],
      "拳擊|Boxing|搏擊": [
        "%s 透過基本拳擊動作同組合訓練，有效提升心肺功能、手眼協調同全身協調性。由專業教練從基本拳法教起。",
      ],
      "初學|入門|基礎|Beginner|新手": [
        "%s 專為健身初學者設計，從基本動作模式（深蹲、推拉、核心穩定）開始教起，建立安全有效嘅訓練基礎。",
      ],
    },
    default: [
      "%s 透過不同訓練模式，幫助學員提升肌力、耐力同心肺功能。課堂由專業教練帶領，適合想改善體能同建立運動習慣嘅人士。",
      "%s 結合多種訓練方式，包括肌力訓練、心肺訓練同核心鍛鍊，全面提升體能水平。每堂課都會因應學員程度調整強度。",
      "%s 專為想提升體能嘅學員設計，透過系統化訓練提升肌力、爆發力同耐力。無論你係初學者定有經驗，都能搵到適合嘅挑戰。",
      "%s 由教練根據學員能力設計訓練內容，確保每位學員都喺安全嘅環境中逐步進步。適合想持續鍛鍊嘅人士。",
      "%s 課堂包含動態熱身、主訓練同靜態伸展，完整嘅訓練流程幫助學員有效提升體能同時預防受傷。",
      "%s 透過團體訓練嘅互動氣氛，讓運動變得更有趣。教練會從旁指導動作，確保正確姿勢，適合任何程度學員。",
    ],
  },
  新興運動: {
    keywords: {
      "芬蘭木柱|Mölkky|Molkk": [
        "%s 係源自芬蘭嘅掟木柱遊戲，玩法簡單但充滿策略性。適合戶外聯誼、親子活動或公司團隊建設，大人細路都玩得。",
        "%s 只需要掟木棍擊倒木柱就可以得分，但需要精準度同策略思考。適合任何年齡，係草地或沙灘嘅最佳活動。",
      ],
      "地板冰壺|Floor Curling": [
        "%s 係地板版本嘅冰壺運動，唔使冰面都可以玩。適合室內進行，結合策略與技巧，係團隊活動嘅好選擇。",
        "%s 喺地板上進行嘅冰壺運動，不受天氣限制，適合任何場地。玩法容易上手，但講究策略同心機。",
      ],
      "布袋球|Cornhole|投擲": [
        "%s 係一種投擲布袋到目標板上嘅遊戲，簡單有趣，適合派對、聚會或 outdoor 活動。可以單打或雙打，考驗準確度。",
      ],
      "穿雲箭|AIR STORM|AirStorm|飛鏢|Dart": [
        "%s 使用安全嘅軟箭進行投擲目標訓練，結合運動同心流體驗。適合室內進行，提升專注力同手眼協調。",
      ],
      "圓網球|Roundnet|Spikeball": [
        "%s 係一種類似排球但喺圓形彈網上進行嘅運動，兩個人組隊，快速節奏考驗反應時間同團隊默契。",
      ],
      "匹克球|Pickleball": [
        "%s 結合網球、羽毛球同乒乓球元素嘅球拍運動，場地細、節奏適中，容易上手但極具樂趣。適合任何年齡人士。",
      ],
    },
    default: [
      "%s 係一項適合任何年齡嘅運動，結合趣味與運動元素，由專業教練指導基本技巧與規則，讓學員喺輕鬆愉快嘅氛圍中體驗運動嘅樂趣。",
      "%s 玩法簡單易上手，由教練逐步帶領學員掌握基本技巧，可以鍛鍊身體協調性同反應能力。",
      "%s 係近年流行嘅運動之一，無論係初學者定有經驗人士都可以享受當中樂趣。教練會按學員程度調整教學內容。",
      "%s 提供一個有趣嘅方式讓身體動起來，唔使傳統訓練咁沉悶，又可以達到運動效果。適合想試新嘢嘅你。",
    ],
  },
  舞蹈: {
    keywords: {
      "Zumba|舞動燃脂|Fitness Dance": [
        "%s 結合拉丁音樂同舞蹈動作，喺歡樂嘅氣氛中燃燒卡路里。由導師帶領簡單易跟嘅舞步，唔需要舞蹈底子都跳到。",
      ],
      "拉丁|Salsa|Bachata": [
        "%s 教授基本拉丁舞步同組合，透過音樂節奏學習身體協調同舞步技巧。適合想學習社交舞或活動身體嘅人士。",
      ],
      "芭蕾|Ballet|芭蕾塑形|Barre": [
        "%s 融合芭蕾舞基本動作與健身元素，透過把杆練習同地面動作，重點鍛鍊核心、大腿同臀部線條。",
      ],
      "K-Pop|Kpop|韓流|流行舞": [
        "%s 跟隨熱門 K-Pop 音樂學習舞蹈動作，由導師拆解舞步逐步教學。適合喜歡流行音樂同跳舞嘅學員。",
      ],
      "空中|Aerial|鋼管|Pole": [
        "%s 利用空中設備進行舞蹈訓練，由導師從基本動作教起，逐步掌握空中技巧。課程注重安全同正確姿勢。",
      ],
    },
    default: [
      "%s 跟隨音樂節奏學習基本舞步，由導師細心教學，無論有冇舞蹈底子都適合參加。課堂著重動作協調同節奏感。",
      "%s 由專業舞蹈導師指導，從基本步法到完整舞碼，逐步教學。適合想活動身體、提升協調能力嘅人士。",
      "%s 透過音樂同舞步釋放壓力，喺輕鬆嘅氣氛中活動身體。導師會逐步教授，確保每位學員都跟得上進度。",
    ],
  },
  伸展: {
    keywords: {
      "瑜伽|Yoga": [
        "%s 透過靜態瑜伽伸展動作，幫助放鬆繃緊肌肉、提升身體柔軟度。每堂課都包含呼吸練習同放鬆環節。",
      ],
      "筋膜|Foam|滾筒|按摩": [
        "%s 利用滾筒同按摩球進行筋膜放鬆，針對常見嘅肌肉緊張點進行深層按壓。適合運動後恢復或日常肌肉保養。",
      ],
      "陰|Yin|長Hold": [
        "%s 以長時間保持嘅被動伸展為主，針對深層結締組織放鬆，幫助釋放長期積累嘅身體緊張。",
      ],
    },
    default: [
      "%s 透過系統性伸展動作，幫助放鬆繃緊肌肉、提升身體柔軟度同關節活動範圍。特別適合長時間坐辦公室嘅人士。",
      "%s 由導師帶領進行全身伸展練習，針對常見嘅肌肉緊張部位進行放鬆，改善身體靈活性同舒適度。",
      "%s 透過有系統嘅伸展練習，幫助身體恢復彈性，減少肌肉酸痛同繃緊感。適合運動後或日常保養。",
    ],
  },
  冥想: {
    keywords: {
      "正念|Mindfulness|MBSR": [
        "%s 以正念減壓（MBSR）為基礎，透過身體掃描、呼吸覺察等練習，幫助學員培養專注力同覺察力。",
      ],
      "聲音|頌缽|Singing Bowl|音頻": [
        "%s 利用頌缽聲音震頻引導進入深層放鬆狀態，幫助釋放壓力、平衡能量。適合想體驗聲音療癒嘅學員。",
      ],
      "呼吸|Pranayama": [
        "%s 專注於不同呼吸技巧（Pranayama）嘅學習與練習，透過調息平衡身心狀態，提升專注力同能量水平。",
      ],
    },
    default: [
      "%s 透過呼吸練習與冥想引導，幫助學員學習專注當下、放鬆身心。課程適合想減輕壓力、提升睡眠質素嘅人士。",
      "%s 由導師帶領進行靜坐冥想同呼吸練習，喺寧靜嘅空間中學習觀察念頭，培養內在平靜。",
      "%s 提供一個空間讓你暫時放下外界干擾，透過簡單嘅冥想練習，學習同自己相處。適合冥想初學者。",
    ],
  },
  TRX: {
    keywords: {
      "核心|Core": [
        "%s 利用 TRX 懸吊系統進行核心肌群專項訓練，透過不穩定平面激活深層腹部同背部肌肉。",
      ],
      "全身|Full Body|總": [
        "%s 利用 TRX 懸吊系統進行全身訓練，涵蓋上肢、下肢同心臟訓練。透過自身體重調節難度，適合各級別學員。",
      ],
    },
    default: [
      "%s 利用 TRX 懸吊系統，以自身體力進行全身訓練，重點鍛鍊核心肌群同身體穩定性。由教練指導正確動作。",
      "%s 透過懸吊訓練方式，喺不穩定嘅環境中激活更多肌肉纖維，提升身體控制能力同肌力。",
    ],
  },
  拳擊: {
    keywords: {
      "有氧|Aerobic|Fitness": [
        "%s 以拳擊動作組合進行有氧訓練，每小時消耗大量卡路里。課程包含熱身、空擊、手靶同核心訓練，唔需要對打。",
      ],
      "泰拳|Muay Thai": [
        "%s 教授泰拳基本功，包括拳、肘、膝、腿等技術。由專業教練指導，適合想學習站立技術同提升體能嘅學員。",
      ],
    },
    default: [
      "%s 透過基本拳擊動作同組合訓練，有效提升心肺功能、手眼協調同全身肌力。由專業教練指導，無需經驗即可參加。",
      "%s 學習基本拳法同組合，喺訓練中提升反應速度同體能。課程唔涉及對打，適合任何程度嘅學員。",
    ],
  },
  太極: {
    keywords: {
      "養生|Health|氣功": [
        "%s 融合太極拳與養生功法，透過緩慢動作配合呼吸，幫助調理氣血、放鬆身心。",
      ],
      "楊式|24式|套路": [
        "%s 教授楊式太極拳二十四式基本套路，由基礎動作教起，逐步串聯成完整套路。適合對傳統武術有興趣嘅學員。",
      ],
    },
    default: [
      "%s 教授太極拳基本動作與套路，透過緩慢流暢嘅動作，幫助提升身體平衡力、協調性同放鬆身心。",
      "%s 從基本功開始教學，逐步掌握太極拳嘅基本架式同移動方式。適合任何年齡人士參加。",
    ],
  },
  "長者體適能|長者|Senior": {
    keywords: {
      "椅上|Chair|坐式": [
        "%s 以坐姿進行體適能練習，包含上肢伸展、核心穩定同呼吸練習。適合行動不便或站立不穩嘅長者參加。",
      ],
      "健腦|認知|Brain|記憶": [
        "%s 結合簡單動作與認知訓練（如記憶遊戲、節奏拍打），幫助長者同時鍛鍊身體同心腦。",
      ],
    },
    default: [
      "%s 專為長者設計嘅體適能課程，包含椅上伸展、平衡練習同輕度肌力訓練，幫助維持身體機能同活動能力。",
      "%s 由具經驗嘅導師帶領，以小班教學確保每位長者得到適當照顧。課程按學員能力調整，安全輕鬆。",
    ],
  },
  default: {
    keywords: {},
    default: [
      "%s 由專業教練帶領，透過系統化教學幫助學員掌握基本技巧與知識。課程適合任何程度嘅參加者。",
      "%s 專為對運動有興趣嘅人士設計，由教練循序漸進指導，讓學員喺安全嘅環境中學習同進步。",
      "%s 透過實際練習與專業指導，幫助學員了解基本技巧與要領。課堂注重正確姿勢同安全。",
      "%s 由經驗導師設計課程內容，按學員程度調整教學進度。適合想建立運動習慣嘅你。",
      "%s 喺輕鬆嘅課堂氣氛中學習，由教練從旁指導矯正。無論你嘅目標係乜，我哋都會幫你一步步達成。",
    ],
  },
};

router.post(
  "/generate-description",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const { title, category, difficulty, venue_name } = req.body;
      if (!title) {
        return res.status(400).json({ error: "請提供課程名稱" });
      }

      // 1. 先根據分類搵對應嘅範本組
      let catData = DESCRIPTION_TEMPLATES.default;
      if (category) {
        for (const [key, val] of Object.entries(DESCRIPTION_TEMPLATES)) {
          const keys = key.split("|");
          if (keys.some((k) => category.includes(k.trim()))) {
            catData = val;
            break;
          }
        }
      }

      // 2. 再根據課程名稱嘅關鍵詞匹配最適合嘅範本
      let matchedTemplates = null;
      for (const [keyword, templates] of Object.entries(catData.keywords)) {
        const words = keyword.split("|");
        if (
          words.some((w) =>
            title.toLowerCase().includes(w.toLowerCase().trim()),
          )
        ) {
          matchedTemplates = templates;
          break;
        }
      }

      // 3. 如果有關鍵詞匹配就用 keyword 範本，否則用 default 範本
      var primaryPool = matchedTemplates || catData.default;
      var pool = primaryPool;
      // 如果 keyword 範本少過 3 個，combine keyword + default 補夠
      if (primaryPool.length < 3 && catData.default) {
        pool = primaryPool.concat(catData.default);
      }
      // 用課程名稱長度 + 字符編碼決定範本，確保同一課程每次都一樣但不同課程有不同描述
      var seed = 0;
      for (var chi = 0; chi < title.length; chi++) {
        seed += title.charCodeAt(chi);
      }
      // 生成 3 個唔同嘅範本俾管理員選擇
      var descriptions = [];
      var usedIndices = [];
      for (var gi = 0; gi < 3 && gi < pool.length; gi++) {
        // 用 seed + gi * 7 確保 3 個都唔同
        var idx = (seed + gi * 7 + gi * gi) % pool.length;
        // 避免重複
        var attempts = 0;
        while (usedIndices.indexOf(idx) !== -1 && attempts < pool.length) {
          idx = (idx + 1) % pool.length;
          attempts++;
        }
        usedIndices.push(idx);

        var desc = pool[idx].replace("%s", title);

        // Add venue info
        if (venue_name) {
          desc += " 📍 " + venue_name;
        }

        // Add difficulty hint
        if (difficulty === "beginner") {
          desc = "【初學者友善】" + desc;
        } else if (difficulty === "intermediate") {
          desc = "【中級強度】" + desc;
        } else if (difficulty === "advanced") {
          desc = "【高階挑戰】" + desc;
        }

        descriptions.push(desc);
      }

      res.json({ descriptions, generated: true });
    } catch (err) {
      console.error("生成描述錯誤:", err);
      res.status(500).json({ error: "生成描述失敗" });
    }
  },
);


// ===== GET /api/admin/audit-log - audit trail =====
router.get("/audit-log", authenticateToken, requireAdmin, (req, res) => {
  try {
    const entries = queryAudit({
      limit: parseInt(req.query.limit) || 200,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ entries });
  } catch (err) {
    console.error("[ADMIN] audit-log error:", err.message);
    res.status(500).json({ error: "load audit log failed" });
  }
});

module.exports = router;
