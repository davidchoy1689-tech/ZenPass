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

module.exports = router;
