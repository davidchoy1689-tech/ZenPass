/**
 * ZenPass 禪流 - 管理員路由
 * 付款驗證、預約管理、用戶管理
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const { sendNotification } = require("../services/notification");

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

    // 🔔 通知學生：付款已確認
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

    // 🔔 通知學生：付款被拒絕
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
      .from(table).select("*", { count: "exact", head: true });
    
    res.json({ data: data || [], count: count || 0, error: countErr?.message || null });
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
      'system_config','system_backups','courses','course_sessions','course_categories',
      'bookings','transactions','settlements','users','profiles','coaches','students',
      'membership_plans','user_memberships','payments','commissions','payouts',
      'venues','partners','attendance','reviews','notifications','waitlist','promotions'
    ];
    
    const result = [];
    for (const t of tables) {
      try {
        const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
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
    const coaches = db.prepare(`
      SELECT ce.coach_id, u.name as coach_name, u.email as coach_email,
             SUM(ce.net_amount) as total_pending
      FROM coach_earnings ce
      JOIN users u ON ce.coach_id = u.id
      WHERE ce.status = 'pending'
      GROUP BY ce.coach_id
      HAVING total_pending > 0
    `).all();

    let processed = 0;
    const results = [];
    
    for (const coach of coaches) {
      // Create payout record
      const payoutId = require("uuid").v4();
      const poRef = "PO-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") +
                    "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
      const fee = Math.max(0, coach.total_pending * 0.01); // 1% processing fee
      const netAmount = coach.total_pending - fee;
      
      db.prepare(`
        INSERT INTO coach_payouts (id, payout_reference, coach_id, amount, fee, net_amount, payment_method, status)
        VALUES (?, ?, ?, ?, ?, ?, 'bank', 'processing')
      `).run(payoutId, poRef, coach.coach_id, coach.total_pending, fee, netAmount);
      
      // Mark all pending earnings for this coach as paid
      db.prepare(`
        UPDATE coach_earnings SET status = 'paid', payout_id = ?
        WHERE coach_id = ? AND status = 'pending'
      `).run(payoutId, coach.coach_id);
      
      // Update user totals
      db.prepare(`
        UPDATE users SET pending_payout = 0, total_earnings = COALESCE(total_earnings, 0) + ?
        WHERE id = ?
      `).run(netAmount, coach.coach_id);
      
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
    
    db.close();
    
    res.json({
      message: processed > 0 ? `已爲 ${processed} 位教練處理出糧` : "沒有待出糧的教練",
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
    
    const payouts = db.prepare(`
      SELECT cp.*, u.name as coach_name, u.email as coach_email
      FROM coach_payouts cp
      JOIN users u ON cp.coach_id = u.id
      ${where}
      ORDER BY cp.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);
    
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM coach_payouts cp ${where}
    `).get(...params).count;
    
    const summary = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN cp.status IN ('pending','processing') THEN cp.net_amount ELSE 0 END), 0) as pending_total,
        COALESCE(SUM(CASE WHEN cp.status = 'paid' THEN cp.net_amount ELSE 0 END), 0) as paid_total,
        COUNT(DISTINCT cp.coach_id) as total_coaches
      FROM coach_payouts cp
    `).get();
    
    db.close();
    
    res.json({ payouts, total, summary, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("取 payout 記錄錯誤:", err);
    res.status(500).json({ error: "無法獲取出糧記錄" });
  }
});

// ===== 教練申請審批 =====
router.get("/coach-applications", authenticateToken, requireAdmin, (req, res) => {
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
         ORDER BY ca.created_at DESC`
      )
      .all(status);

    db.close();
    res.json({ applications, total: applications.length });
  } catch (err) {
    console.error("取教練申請錯誤:", err);
    res.status(500).json({ error: "無法獲取教練申請" });
  }
});

router.post("/coach-approve", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { application_id } = req.body;
    if (!application_id) {
      return res.status(400).json({ error: "缺少申請編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const app = db.prepare("SELECT * FROM coach_applications WHERE id = ?").get(application_id);
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
      "UPDATE coach_applications SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
    ).run(req.user.id, application_id);

    // Update user as coach
    db.prepare(
      "UPDATE users SET is_coach = 1, coach_verified = 1 WHERE id = ?"
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

    const app = db.prepare("SELECT * FROM coach_applications WHERE id = ?").get(application_id);
    if (!app) {
      db.close();
      return res.status(404).json({ error: "申請不存在" });
    }
    if (app.status !== "pending") {
      db.close();
      return res.status(400).json({ error: "申請已處理" });
    }

    db.prepare(
      "UPDATE coach_applications SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
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
router.get("/course-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const course = db.prepare("SELECT * FROM classes WHERE id = ?").get(req.params.id);
    if (!course) { db.close(); return res.status(404).json({ error: "課程不存在" }); }

    const schedules = db.prepare(
      "SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status IN ('confirmed','attended')) as enrolled FROM class_schedules s WHERE s.class_id = ? AND s.start_time >= datetime('now') ORDER BY s.start_time"
    ).all(req.params.id);

    // For each schedule, get enrolled students
    const scheduleStudents = {};
    for (const s of schedules) {
      const students = db.prepare(
        "SELECT u.id, u.name, u.email, u.phone, b.booking_reference, b.status, b.payment_status, b.created_at, b.amount FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.schedule_id = ? AND b.status IN ('confirmed','attended','pending_payment') ORDER BY b.created_at"
      ).all(s.id);
      scheduleStudents[s.id] = students;
    }

    db.close();
    res.json({ course, schedules, scheduleStudents, total_schedules: schedules.length });
  } catch (err) {
    console.error("取課程詳情錯誤:", err);
    res.status(500).json({ error: "無法獲取課程詳情" });
  }
});

// ===== GET /api/admin/user-detail/:id — 用戶詳細資料（含預約紀錄） =====
router.get("/user-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!user) { db.close(); return res.status(404).json({ error: "用戶不存在" }); }

    const bookings = db.prepare(
      "SELECT b.*, c.title as class_title, cs.start_time, cs.end_time FROM bookings b JOIN classes c ON c.id = b.class_id LEFT JOIN class_schedules cs ON cs.id = b.schedule_id WHERE b.user_id = ? ORDER BY b.created_at DESC"
    ).all(req.params.id);

    const transactions = db.prepare(
      "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);

    const membership = db.prepare(
      "SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);

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
    const coach = db.prepare("SELECT * FROM users WHERE id = ? AND is_coach = 1").get(req.params.id);
    if (!coach) { db.close(); return res.status(404).json({ error: "教練不存在" }); }

    const classes = db.prepare(
      "SELECT c.*, (SELECT COUNT(*) FROM class_schedules WHERE class_id = c.id AND start_time >= datetime('now')) as future_schedules, (SELECT COUNT(*) FROM bookings b JOIN class_schedules s ON b.schedule_id = s.id WHERE s.class_id = c.id AND b.status = 'confirmed') as total_bookings FROM classes c WHERE c.coach_id = ? ORDER BY c.created_at DESC"
    ).all(req.params.id);

    const earnings = db.prepare(
      "SELECT * FROM coach_earnings WHERE coach_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);

    const payouts = db.prepare(
      "SELECT * FROM coach_payouts WHERE coach_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);

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
    const classData = db.prepare("SELECT * FROM classes WHERE id = ?").get(class_id);
    if (!classData) {
      db.close();
      return res.status(404).json({ error: "課程不存在" });
    }

    // 檢查教練是否存在
    const coach = db.prepare("SELECT id, name FROM users WHERE id = ? AND is_coach = 1").get(coach_id);
    if (!coach) {
      db.close();
      return res.status(404).json({ error: "教練不存在或未通過認證" });
    }

    // 更新課程教練
    db.prepare("UPDATE classes SET coach_id = ?, updated_at = datetime('now') WHERE id = ?").run(coach_id, class_id);
    db.close();

    res.json({ success: true, message: `✅ 已將「${classData.title}」指派給 ${coach.name}` });
  } catch (err) {
    console.error("指派教練錯誤:", err);
    res.status(500).json({ error: "指派教練失敗" });
  }
});

// ===== POST /api/admin/notify-course-spots — 通知有興趣學員課程空位 =====
router.post("/notify-course-spots", authenticateToken, requireAdmin, (req, res) => {
  try {
    var { class_id, message } = req.body;

    if (!class_id) {
      return res.status(400).json({ error: "缺少課程編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 獲取課程資料
    var course = db.prepare("SELECT * FROM classes WHERE id = ?").get(class_id);
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
    `
      )
      .all(category, category);

    if (interestedUsers.length === 0) {
      db.close();
      return res.json({ notified: 0, message: "暫無有興趣嘅學員" });
    }

    var notifiedCount = 0;
    var finalMessage =
      message || `📢 「${title}」有大量空位，快啲預約啦！`;

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
});

// ===== PUT /api/admin/update-course/:id — 管理員更新課程資料 =====
router.put("/update-course/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const classData = db.prepare("SELECT * FROM classes WHERE id = ?").get(req.params.id);
    if (!classData) {
      db.close();
      return res.status(404).json({ error: "課程不存在" });
    }

    const allowedFields = [
      "title", "title_en", "description", "description_en",
      "category", "difficulty", "duration", "max_participants",
      "price_hkd", "credits_cost", "venue_name", "venue_address",
      "venue_district", "latitude", "longitude", "image_url", "status"
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

    db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    db.close();

    res.json({ success: true, message: "✅ 課程資料已更新" });
  } catch (err) {
    console.error("更新課程錯誤:", err);
    res.status(500).json({ error: "更新課程失敗" });
  }
});

// ===== POST /api/admin/generate-description — AI 自動生成課程描述 =====
const DESCRIPTION_TEMPLATES = {
  "瑜伽": {
    templates: [
      "%s 透過瑜伽體位法、呼吸練習與冥想放鬆，幫助學員提升身體柔軟度、增強核心力量，同時舒緩壓力，讓身心達到平衡。課程適合任何程度嘅學員參加。",
      "%s 由經驗導師帶領，透過流暢嘅動作串聯與靜態伸展，改善身體靈活性同姿勢。每堂課都包含呼吸協調同放鬆環節，帶給你身心舒暢嘅體驗。",
      "%s 融合傳統瑜伽練習與現代運動概念，由導師循序漸進指導，幫助你喺安全嘅環境中探索身體嘅潛能，提升柔韌度與肌力。",
    ]
  },
  "健身": {
    templates: [
      "%s 透過不同訓練模式，幫助學員提升肌力、耐力同心肺功能。課堂由專業教練帶領，適合想改善體能同建立運動習慣嘅人士。",
      "%s 結合多種訓練方式，包括肌力訓練、心肺訓練同核心鍛鍊，全面提升體能水平。每堂課都會因應學員程度調整強度。",
      "%s 專為想提升體能嘅學員設計，透過系統化訓練提升肌力、爆發力同耐力。無論你係初學者定有經驗，都能喺課堂中找到適合自己嘅挑戰。",
    ]
  },
  "新興運動": {
    templates: [
      "%s 係一項適合任何年齡嘅新興運動，結合趣味與運動元素，由專業教練指導基本技巧與規則，讓學員喺輕鬆愉快嘅氛圍中體驗運動嘅樂趣。",
      "%s 玩法簡單易上手，由教練逐步帶領學員掌握基本技巧。呢項運動可以鍛鍊身體協調性同反應能力，適合一個人或約埋朋友一齊參加。",
      "%s 係近年流行嘅新興運動之一，結合策略同體能訓練，無論係初學者定有經驗人士都可以享受當中樂趣。教練會按學員程度調整教學內容。",
    ]
  },
  "舞蹈": {
    templates: [
      "%s 跟隨音樂節奏學習基本舞步，由導師細心教學，無論有冇舞蹈底子都適合參加。課堂著重動作協調同節奏感，同時享受跳舞嘅樂趣。",
      "%s 由專業舞蹈導師指導，從基本步法到完整舞碼，逐步教學。課程適合想活動身體、提升協調能力同釋放壓力嘅人士。",
    ]
  },
  "伸展": {
    templates: [
      "%s 透過系統性伸展動作，幫助放鬆繃緊肌肉、提升身體柔軟度同關節活動範圍。特別適合長時間坐辦公室或姿勢固定嘅人士。",
      "%s 由導師帶領進行全身伸展練習，針對常見嘅肌肉緊張部位進行放鬆，改善身體靈活性同舒適度。",
    ]
  },
  "冥想": {
    templates: [
      "%s 透過呼吸練習與正念冥想，幫助學員學習專注當下、放鬆身心。課程適合想減輕壓力、提升睡眠質素或學習冥想技巧嘅人士。",
    ]
  },
  "TRX": {
    templates: [
      "%s 利用 TRX 懸吊系統，透過自身體力進行全身訓練，重點鍛鍊核心肌群同身體穩定性。由教練指導正確動作，適合想提升肌力嘅學員。",
    ]
  },
  "拳擊": {
    templates: [
      "%s 透過基本拳擊動作同組合訓練，有效提升心肺功能、手眼協調同全身肌力。課程由專業教練指導，無需經驗即可參加。",
    ]
  },
  "太極": {
    templates: [
      "%s 教授太極拳基本動作與套路，透過緩慢流暢嘅動作，幫助提升身體平衡力、協調性同放鬆身心。適合任何年齡人士參加。",
    ]
  },
  "長者體適能": {
    templates: [
      "%s 專為長者設計嘅體適能課程，包含椅上伸展、平衡練習同輕度肌力訓練，幫助維持身體機能同活動能力。由具經驗嘅導師帶領。",
    ]
  },
  "default": {
    templates: [
      "%s 由專業教練帶領，透過系統化教學幫助學員掌握基本技巧與知識。課程適合任何程度嘅參加者，在輕鬆嘅環境中享受運動嘅樂趣。",
      "%s 專為對運動有興趣嘅人士設計，由教練循序漸進指導，讓學員喺安全嘅環境中學習同進步。每堂課都會因應學員程度調整內容。",
      "%s 透過實際練習與專業指導，幫助學員了解基本技巧與要領。課堂注重正確姿勢同安全，適合初學者同有經驗嘅學員。",
    ]
  }
};

router.post("/generate-description", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, category, difficulty, venue_name } = req.body;
    if (!title) {
      return res.status(400).json({ error: "請提供課程名稱" });
    }

    // Find matching category templates — 先精準匹配，再 fallback 到關鍵詞
    let catTemplates = DESCRIPTION_TEMPLATES.default;
    // 先試精準匹配 category
    if (category && DESCRIPTION_TEMPLATES[category]) {
      catTemplates = DESCRIPTION_TEMPLATES[category];
    } else {
      // Fallback: 用關鍵詞匹配
      for (const [key, val] of Object.entries(DESCRIPTION_TEMPLATES)) {
        if ((category && category.includes(key)) || (title && title.includes(key))) {
          catTemplates = val;
          break;
        }
      }
    }

    // Pick a template based on title length (deterministic but varied)
    const templateIndex = title.length % catTemplates.templates.length;
    var description = catTemplates.templates[templateIndex].replace("%s", title);

    // Add venue info if available
    if (venue_name) {
      description += " 📍 " + venue_name;
    }

    // Add difficulty hint
    if (difficulty === "beginner") {
      description = "【初學者友善】" + description;
    } else if (difficulty === "intermediate") {
      description = "【中級強度】" + description;
    } else if (difficulty === "advanced") {
      description = "【高階挑戰】" + description;
    }

    res.json({ description, generated: true });
  } catch (err) {
    console.error("生成描述錯誤:", err);
    res.status(500).json({ error: "生成描述失敗" });
  }
});

module.exports = router;
