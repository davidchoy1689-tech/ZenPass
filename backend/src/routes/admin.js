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
      "【專業教練指導】%s 專為都市人設計，融合傳統哈達瑜伽與現代流動瑜伽精髓。每堂課從調息（Pranayama）開始，透過戰士式、下犬式等經典體位法串聯（Vinyasa），配合冥想放鬆（Savasana）作結。有效改善圓肩駝背、提升脊柱柔韌度、強化核心肌群。研究表明，每週三次瑜伽練習可降低 40% 壓力荷爾蒙皮質醇水平。立即報名，為自己預留一個寧靜時光。",
      "🌟 全城熱賣｜%s — 由認證瑜伽導師（RYT-200）親授，以小班教學確保每位學員獲得個別指導。課程涵蓋呼吸法（Pranayama）、體位法（Asana）與正念冥想（Mindfulness），特別適合長期辦公室工作、姿勢不良、睡眠質素欠佳嘅人士。一堂課 60 分鐘，燃燒 200-400 卡路里，同時讓身心深度放鬆。名額有限，立即預約體驗！",
      "【身心蛻變之旅】%s 唔單止係運動，更係一種生活態度。專業導師帶領你探索瑜伽八大分支，從體位法到冥想，逐步提升身體覺察力。特別引入筋膜放鬆環節，針對香港人常見嘅腰痠背痛問題。學員見證：'上了三个月，不但瘦了 5kg，連長期頭痛都改善咗！' 新學員專享首次體驗優惠，立即報名！",
    ]
  },
  "健身": {
    templates: [
      "【科學健身方程式】%s 由 NASM-CPT 認證教練設計，結合功能性訓練（Functional Training）與高強度間歇訓練（HIIT）原理。每堂課包含動態熱身、主訓練（力量/爆發/核心）及靜態伸展，科學化編排確保肌纖維充分激活。研究證實 HIIT 可在 20 分鐘內達到傳統有氧 45 分鐘嘅燃脂效果。適合想提升代謝率、增肌減脂嘅你。",
      "🔥 熱門課程｜%s — 唔使你舉鐵舉到頸梗膀痛！我哋採用最新嘅週期化訓練模型（Periodization），每 4 週轉換訓練焦點，防止 plateau 平台期。專業體能測試（FMS功能性動作篩查）幫你找出身體弱點，針對性改善。每月更新訓練菜單，每次上堂都有新鮮感。首堂體驗價只需 HK$99，仲送運動毛巾一條！",
      "【突破體能極限】%s 專為現代香港人設計，針對常見嘅久坐圓肩、核心無力等問題。每堂課利用 TRX、壺鈴、戰繩等專業器材進行多平面訓練，全面提升肌力、爆發力、耐力、敏捷度四大體能要素。InBody 身體成分分析每月跟進進度，用數據說話。超過 200 位學員成功減脂 5-15%，立即加入蛻變行列！",
    ]
  },
  "新興運動": {
    templates: [
      "【全城新熱潮】%s 係近年席捲香港嘅新興運動！結合策略、技巧與團隊合作，無論係親子活動、朋友聚會定 team building 都適合。零經驗入門，5 分鐘學會基本玩法，但需要一輩子掌握策略深度。專業教練以漸進式教學法，由淺入深帶領你掌握技術要領。運動科學研究表明，新興運動能有效提升反應速度、手眼協調及社交幸福感。",
      "🎯 好玩到上癮｜%s — 唔需要任何運動底子，唔使跑到氣喘吁吁，都可以玩得盡興！呢項風靡歐美嘅新興運動，而家喺香港都可以體驗到。每堂限額 12 人，確保每位學員有充足練習時間。教練團隊擁有香港新興運動協會認證，教學經驗豐富。公司 team building、朋友聚會、親子活動首選！包場查詢歡迎聯絡。",
      "【釋放壓力·重拾玩樂】%s 為你嘅生活注入新樂趣！有別於傳統健身訓練，新興運動強調「玩住瘦、笑住練」，喺歡樂嘅氛圍中不知不覺燃燒卡路里（每小時 300-500 kcal）。研究顯示，趣味性運動嘅持續率高達 85%，遠超傳統健身嘅 50%。唔使自己一個人孤獨運動，約埋 friend 一齊報名仲有二人同行優惠！",
    ]
  },
  "舞蹈": {
    templates: [
      "【燃脂跳舞派對】%s 融合拉丁舞、街舞及流行舞蹈元素，由專業舞蹈導師編排。每堂課 60 分鐘相等於跑步 8 公里嘅卡路里消耗（約 400-600 kcal），但過程充滿樂趣，完全唔覺得辛苦！研究顯示跳舞可以提升 BDNF（腦源性神經營養因子）水平，有助預防認知衰退。無論你有冇舞蹈底子，我哋嘅分級教學都能讓你輕鬆跟上。",
      "💃 自信由內而外｜%s — 唔需要舞伴，唔需要經驗，只需要一顆想動起來嘅心！我們採用「拆解式教學法」：先將舞步拆解成基本元素，逐個教授，最後串聯成完整舞碼。每期課程完成後仲有成果展演機會，讓你在舞台上閃耀。學員分享：'學咗半年，唔單止瘦咗，仲識咗好多朋友，自信咗好多！' 立即預約免費體驗堂！",
    ]
  },
  "伸展": {
    templates: [
      "【都市人必備】%s 專為長期久坐、肌肉緊繃嘅香港人設計。課程結合靜態伸展（Static Stretching）、PNF 本體感覺神經肌肉促進法及筋膜放鬆技術，針對香港人常見嘅前斜角肌緊張、腰方肌緊繃、膕繩肌過緊等問題提供解決方案。定期伸展可以改善血液循環、提升關節活動度（ROM）、降低運動受傷風險達 60%。",
      "🧘 身體療癒時刻｜%s — 唔好等到痛先嚟後悔！香港物理治療學會指出，90% 嘅都市痛症與肌肉不平衡有關。我哋嘅課程由運動康復教練設計，針對常見痛症（下背痛、肩頸痛、膝痛）提供針對性伸展方案。每堂課都會評估你當日身體狀況，調整伸展重點。俾身體一個機會，重新學習放鬆。首次體驗只需 HK$80！",
    ]
  },
  "冥想": {
    templates: [
      "【科學減壓法】%s 結合正念減壓（MBSR）框架與傳統冥想技巧，由認證冥想導師帶領。每堂課包含身體掃描（Body Scan）、呼吸覺察（Anapanasati）及慈悲冥想（Metta Bhavana）。哈佛大學研究證實，八週正念練習可改變大腦結構，減少杏仁核活躍度達 50%，有效降低焦慮與抑鬱症狀。適合高壓工作、失眠、情緒困擾嘅人士。",
    ]
  },
  "TRX": {
    templates: [
      "【懸吊訓練革命】%s 利用 TRX 懸吊系統，透過自身體重進行多平面訓練。源自美國海豹突擊隊嘅訓練方式，已被全球頂尖運動員廣泛採用。每堂課訓練全身主要肌群，特別針對核心穩定性（Core Stability）及肩胛穩定性（Scapular Stability）。研究表明，TRX 訓練可在 30 分鐘內激活比傳統訓練多 30% 嘅肌纖維。適合想提升運動表現、改善身體控制能力嘅你。",
    ]
  },
  "拳擊": {
    templates: [
      "【釋放壓力·燃燒卡路里】%s 唔係要你同人對打，而係透過專業拳擊訓練提升體能！每堂課包含熱身、空擊（Shadow Boxing）、沙包訓練及核心訓練，每小時燃燒高達 600-800 卡路里。打拳擊可以提升心肺功能、增強上肢力量、改善手眼協調。而且，打沙包係最有效嘅減壓方式之一！專業教練從基本拳法（Jab, Cross, Hook）開始教起，零基礎都歡迎！",
    ]
  },
  "太極": {
    templates: [
      "【傳統養生智慧】%s 融合楊式太極拳二十四式與養生功法，由經驗豐富嘅太極導師教授。太極拳被世界衛生組織（WHO）推薦為最適合中老年人嘅運動之一，但其實年輕人都好需要！研究表明，太極拳可以改善平衡力達 45%、降低血壓、提升免疫力。慢動作中蘊含深厚力學原理，每招每式都在鍛鍊核心與下肢力量。",
    ]
  },
  "長者體適能": {
    templates: [
      "【活到老·運動到老】%s 專為長者設計，由具備老年運動證書嘅教練帶領。課程包含椅上伸展、平衡訓練、肌力維持及認知活動，全面照顧長者健康需要。研究指出，規律運動可以延緩認知衰退達 30%，降低跌倒風險達 40%。小班教學，每堂最多 10 人，確保每位長者都能獲得適當照顧。歡迎 65 歲以上人士參加！",
    ]
  },
  "default": {
    templates: [
      "【專業教練團隊】%s 由經驗豐富嘅專業教練親授，以小班教學確保教學質素。課程設計結合運動科學原理與實踐經驗，適合所有程度嘅參加者。我哋嘅教學理念係「安全第一、循序漸進、享受過程」，讓每位學員喺愉快嘅氛圍中達成個人目標。首堂體驗價優惠進行中，立即報名感受不一樣嘅運動體驗！",
      "🔥 人氣課程｜%s — 超過 500 位學員好評推薦！我哋嘅專業教練團隊持有國際認可教練證照，定期進修最新訓練方法。每堂課都會因應學員能力調整強度，確保冇人跟唔上、冇人覺得太簡單。靈活預約制度，邊個話忙碌就唔可以做運動？而家報名仲送專屬運動禮品包，名額有限，先到先得！",
      "【你嘅蛻變之旅由呢度開始】%s 採用「評估-訓練-跟進」三步曲教學模式。上堂前先進行體能評估（FMS功能性篩查/InBody分析），根據結果制定個人化訓練目標。每 4 星期重新評估進度，用真實數據見證改變。超過 90% 學員在 8 星期內達到明顯效果。我哋唔賣幻想，我哋賣結果。立即預約免費諮詢，了解課程如何幫到你！",
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
