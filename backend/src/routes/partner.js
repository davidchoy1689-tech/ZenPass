/**
 * ZenPass 禪流 — 商戶加盟系統路由
 *
 * 提供場地合作夥伴嘅申請、管理、儀表板、課程管理、結算
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const {
  authenticateToken,
  requireAdmin,
} = require("../middleware/auth");
const {
  ok, created, fail, notFound, unauthorized, serverError,
} = require("../services/response");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== 1. POST /api/partner/apply — 商戶提交申請（公開，唔需登入）=====
router.post("/apply", (req, res) => {
  try {
    const {
      name, description, address, phone, email,
      contact_person, category, district, website,
    } = req.body;

    if (!name || !email || !phone) {
      return fail(res, "請填寫場地名稱、電郵同電話", 400);
    }

    if (!category) {
      return fail(res, "請選擇場地類別", 400);
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 檢查係咪已經申請過（同一電郵）
    const existing = db
      .prepare("SELECT id FROM partner_venues WHERE email = ?")
      .get(email);
    if (existing) {
      db.close();
      return fail(res, "此電郵已申請過，如有疑問請聯絡我們", 409);
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO partner_venues (id, name, description, address, phone, email,
        contact_person, category, district, logo_url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `).run(
      id, name, description || "", address || "",
      phone, email, contact_person || "",
      category, district || "", null,
    );

    db.close();

    return created(res, {
      id,
      message: "已收到申請，我哋會喺 3 個工作天內聯絡你",
    });
  } catch (err) {
    console.error("❌ partner/apply error:", err.message);
    return serverError(res, "申請提交失敗，請稍後再試");
  }
});

// ===== 2. GET /api/partner/status — 商戶睇自己申請狀態 =====
router.get("/status", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);

    // 商戶可能用同一個 email 申請同註冊
    const user = db.prepare("SELECT email, name FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    const venue = db
      .prepare("SELECT * FROM partner_venues WHERE email = ? OR user_id = ?")
      .get(user.email, req.user.id);

    db.close();

    if (!venue) {
      return ok(res, { has_application: false });
    }

    return ok(res, {
      has_application: true,
      venue: {
        id: venue.id,
        name: venue.name,
        status: venue.status,
        category: venue.category,
        district: venue.district,
        commission_rate: venue.commission_rate,
        created_at: venue.created_at,
        updated_at: venue.updated_at,
      },
    });
  } catch (err) {
    console.error("❌ partner/status error:", err.message);
    return serverError(res, "查詢申請狀態失敗");
  }
});

// ===== 3. GET /api/admin/partner-applications — 管理員睇 pending 申請 =====
router.get(
  "/admin/partner-applications",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      const { status } = req.query;

      let rows;
      if (status) {
        rows = db
          .prepare(
            "SELECT * FROM partner_venues WHERE status = ? ORDER BY created_at DESC",
          )
          .all(status);
      } else {
        rows = db
          .prepare(
            "SELECT * FROM partner_venues WHERE status = 'pending' ORDER BY created_at DESC",
          )
          .all();
      }

      db.close();
      return ok(res, rows);
    } catch (err) {
      console.error("❌ admin/partner-applications error:", err.message);
      return serverError(res, "查詢申請列表失敗");
    }
  },
);

// ===== 4. POST /api/admin/partner-approve — 管理員審批申請 =====
router.post(
  "/admin/partner-approve",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const { venue_id, action, commission_rate } = req.body;

      if (!venue_id || !action) {
        return fail(res, "請提供 venue_id 同 action", 400);
      }

      if (!["accept", "reject"].includes(action)) {
        return fail(res, "action 必須係 accept 或 reject", 400);
      }

      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      const venue = db
        .prepare("SELECT * FROM partner_venues WHERE id = ?")
        .get(venue_id);
      if (!venue) {
        db.close();
        return notFound(res, "場地不存在");
      }

      const now = new Date().toISOString();

      if (action === "accept") {
        const rate =
          commission_rate !== undefined
            ? commission_rate
            : venue.commission_rate || 0.3;

        db.prepare(
          `UPDATE partner_venues SET status = 'active', commission_rate = ?, updated_at = ? WHERE id = ?`,
        ).run(rate, now, venue_id);

        db.close();
        return ok(res, {
          message: "已通過申請，商戶可以開始使用平台",
          venue_id,
          status: "active",
          commission_rate: rate,
        });
      } else {
        // reject
        db.prepare(
          `UPDATE partner_venues SET status = 'rejected', updated_at = ? WHERE id = ?`,
        ).run(now, venue_id);

        db.close();
        return ok(res, {
          message: "已拒絕申請",
          venue_id,
          status: "rejected",
        });
      }
    } catch (err) {
      console.error("❌ admin/partner-approve error:", err.message);
      return serverError(res, "審批操作失敗");
    }
  },
);

// ===== 5. GET /api/admin/partner-list — 管理員睇所有商戶 =====
router.get(
  "/admin/partner-list",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      const { status } = req.query;

      let rows;
      if (status) {
        rows = db
          .prepare(
            "SELECT * FROM partner_venues WHERE status = ? ORDER BY created_at DESC",
          )
          .all(status);
      } else {
        rows = db
          .prepare(
            "SELECT * FROM partner_venues ORDER BY created_at DESC",
          )
          .all();
      }

      // 加埋每個場地嘅 booking count（透過 class → schedule → booking 關聯）
      for (const v of rows) {
        const stats = db
          .prepare(
            `SELECT COUNT(*) as total_bookings,
                    COALESCE(SUM(b.amount), 0) as total_revenue
             FROM bookings b
             JOIN class_schedules cs ON b.schedule_id = cs.id
             JOIN classes c ON cs.class_id = c.id
             WHERE c.partner_venue_id = ? AND b.status IN ('confirmed','attended')`,
          )
          .get(v.id);
        v.stats = stats;
      }

      db.close();
      return ok(res, rows);
    } catch (err) {
      console.error("❌ admin/partner-list error:", err.message);
      return serverError(res, "查詢商戶列表失敗");
    }
  },
);

// ===== 6. GET /api/partner/dashboard — 商戶儀表板 =====
router.get("/dashboard", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);

    const user = db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    // 搵返呢個用戶嘅 partner venue
    const venue = db
      .prepare("SELECT * FROM partner_venues WHERE email = ? OR user_id = ?")
      .get(user.email, req.user.id);

    if (!venue || venue.status !== "active") {
      db.close();
      return fail(res, "你未有已開通嘅商戶戶口", 403);
    }

    // 統計數據
    const bookingStats = db
      .prepare(
        `SELECT
          COUNT(*) as total_bookings,
          COALESCE(SUM(amount), 0) as total_revenue,
          COALESCE(SUM(venue_earned_amount), 0) as total_earned,
          COALESCE(SUM(platform_earned_amount), 0) as total_platform_fee,
          COUNT(DISTINCT user_id) as total_students
         FROM bookings
         WHERE venue_partner_id = ? AND status IN ('confirmed','attended')`,
      )
      .get(venue.id);

    // 今個月收入
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split("T")[0];

    const monthStats = db
      .prepare(
        `SELECT
          COALESCE(SUM(venue_earned_amount), 0) as this_month_earnings,
          COUNT(*) as this_month_bookings
         FROM bookings
         WHERE venue_partner_id = ?
           AND status IN ('confirmed','attended')
           AND created_at >= ?`,
      )
      .get(venue.id, monthStartStr);

    // 今個月 payout
    const monthPayouts = db
      .prepare(
        `SELECT COALESCE(SUM(venue_earned), 0) as total_paid
         FROM partner_payouts
         WHERE venue_id = ? AND status = 'paid'`,
      )
      .get(venue.id);

    // 教練列表（有開過班嘅）
    const coaches = db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email
         FROM classes c
         JOIN users u ON c.coach_id = u.id
         WHERE c.id IN (
           SELECT DISTINCT class_id FROM bookings WHERE venue_partner_id = ?
         )`,
      )
      .all(venue.id);

    db.close();

    return ok(res, {
      venue: {
        id: venue.id,
        name: venue.name,
        status: venue.status,
        category: venue.category,
        district: venue.district,
        commission_rate: venue.commission_rate,
      },
      stats: {
        total_bookings: bookingStats.total_bookings || 0,
        total_revenue: bookingStats.total_revenue || 0,
        total_earned: bookingStats.total_earned || 0,
        total_platform_fee: bookingStats.total_platform_fee || 0,
        total_students: bookingStats.total_students || 0,
        this_month_earnings: monthStats.this_month_earnings || 0,
        this_month_bookings: monthStats.this_month_bookings || 0,
        total_paid_out: monthPayouts.total_paid || 0,
      },
      coaches,
    });
  } catch (err) {
    console.error("❌ partner/dashboard error:", err.message);
    return serverError(res, "載入儀表板失敗");
  }
});

// ===== 7. GET /api/partner/bookings — 商戶睇自己場地預約 =====
router.get("/bookings", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);

    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    const venue = db
      .prepare("SELECT id FROM partner_venues WHERE (email = ? OR user_id = ?) AND status = 'active'")
      .get(user.email, req.user.id);

    if (!venue) {
      db.close();
      return fail(res, "你未有已開通嘅商戶戶口", 403);
    }

    const { date_from, date_to, status, limit: lim = 50, offset: off = 0 } = req.query;

    let query = `
      SELECT b.id, b.user_id, b.schedule_id, b.class_id, b.status,
             b.amount, b.payment_status, b.platform_commission_rate,
             b.venue_earned_amount, b.platform_earned_amount, b.created_at,
             u.name as student_name, u.email as student_email, u.phone as student_phone,
             c.title as class_title, c.category,
             cs.start_time, cs.end_time
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.venue_partner_id = ?
    `;
    const params = [venue.id];

    if (date_from) {
      query += " AND cs.start_time >= ?";
      params.push(date_from);
    }
    if (date_to) {
      query += " AND cs.start_time <= ?";
      params.push(date_to);
    }
    if (status) {
      query += " AND b.status = ?";
      params.push(status);
    }

    query += " ORDER BY cs.start_time DESC LIMIT ? OFFSET ?";
    params.push(Number(lim), Number(off));

    const bookings = db.prepare(query).all(...params);

    // Total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM bookings b
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.venue_partner_id = ?
    `;
    const { total } = db.prepare(countQuery).get(venue.id);

    db.close();

    return ok(res, { bookings, total, limit: Number(lim), offset: Number(off) });
  } catch (err) {
    console.error("❌ partner/bookings error:", err.message);
    return serverError(res, "查詢預約記錄失敗");
  }
});

// ===== 8. POST /api/partner/courses — 商戶開新班 =====
router.post("/courses", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    const venue = db
      .prepare("SELECT * FROM partner_venues WHERE (email = ? OR user_id = ?) AND status = 'active'")
      .get(user.email, req.user.id);

    if (!venue) {
      db.close();
      return fail(res, "你未有已開通嘅商戶戶口", 403);
    }

    const {
      title, category, price_hkd, duration, max_participants,
      description, difficulty, schedules,
    } = req.body;

    if (!title || !category || !price_hkd || !duration) {
      db.close();
      return fail(res, "請填寫課程標題、類別、價格同時長", 400);
    }

    if (!schedules || !Array.isArray(schedules) || schedules.length === 0) {
      db.close();
      return fail(res, "請至少新增一個上堂時段", 400);
    }

    const classId = uuidv4();

    // Insert class — 教練暫時用 venue owner 或者搵一個 admin/coach
    // 因為係商戶開班，coach 可以係場地負責人或者平台教練
    const coachId = req.body.coach_id || user.id;

    db.prepare(`
      INSERT INTO classes (id, coach_id, title, description, category, difficulty,
        duration, max_participants, price_hkd, venue_name, venue_address,
        status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).run(
      classId, coachId, title, description || "", category,
      difficulty || "beginner", duration,
      max_participants || 15, price_hkd,
      venue.name, venue.address || "",
    );

    // Insert schedules
    const scheduleIds = [];
    for (const s of schedules) {
      const scheduleId = uuidv4();
      db.prepare(`
        INSERT INTO class_schedules (id, class_id, start_time, end_time,
          max_participants, enrolled_count, status, created_at)
        VALUES (?, ?, ?, ?, ?, 0, 'available', datetime('now'))
      `).run(
        scheduleId, classId, s.start_time, s.end_time,
        s.max_participants || max_participants || 15,
      );
      scheduleIds.push(scheduleId);
    }

    db.close();

    return created(res, {
      class_id: classId,
      title,
      schedules_count: scheduleIds.length,
      schedules: scheduleIds,
      message: "課程已成功建立",
    });
  } catch (err) {
    console.error("❌ partner/courses POST error:", err.message);
    return serverError(res, "建立課程失敗");
  }
});

// ===== 9. GET /api/partner/courses — 商戶睇自己嘅課程 =====
router.get("/courses", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);

    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    const venue = db
      .prepare("SELECT id, name FROM partner_venues WHERE (email = ? OR user_id = ?) AND status = 'active'")
      .get(user.email, req.user.id);

    if (!venue) {
      db.close();
      return fail(res, "你未有已開通嘅商戶戶口", 403);
    }

    // 用 venue name 搵返相關課程
    const courses = db
      .prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM bookings b WHERE b.class_id = c.id AND b.status IN ('confirmed','attended')) as booking_count
        FROM classes c
        WHERE c.venue_name = ? AND c.status = 'active'
        ORDER BY c.created_at DESC
      `)
      .all(venue.name);

    // 每個課程加返 schedules
    for (const course of courses) {
      course.schedules = db
        .prepare(
          "SELECT * FROM class_schedules WHERE class_id = ? ORDER BY start_time ASC",
        )
        .all(course.id);
    }

    db.close();

    return ok(res, courses);
  } catch (err) {
    console.error("❌ partner/courses GET error:", err.message);
    return serverError(res, "查詢課程失敗");
  }
});

// ===== 10. GET /api/partner/payouts — 商戶睇 payout 記錄 =====
router.get("/payouts", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);

    const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    const venue = db
      .prepare("SELECT id FROM partner_venues WHERE (email = ? OR user_id = ?) AND status = 'active'")
      .get(user.email, req.user.id);

    if (!venue) {
      db.close();
      return fail(res, "你未有已開通嘅商戶戶口", 403);
    }

    const payouts = db
      .prepare(
        `SELECT * FROM partner_payouts WHERE venue_id = ? ORDER BY created_at DESC`,
      )
      .all(venue.id);

    db.close();

    return ok(res, payouts);
  } catch (err) {
    console.error("❌ partner/payouts error:", err.message);
    return serverError(res, "查詢結算記錄失敗");
  }
});

// ===== 11. POST /api/admin/process-partner-payouts — 管理員處理商戶結算 =====
router.post(
  "/admin/process-partner-payouts",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      const { period_start, period_end, venue_id } = req.body;

      // 如果冇指定場地，處理所有 active venues
      const venues = venue_id
        ? [db.prepare("SELECT * FROM partner_venues WHERE id = ? AND status = 'active'").get(venue_id)].filter(Boolean)
        : db.prepare("SELECT * FROM partner_venues WHERE status = 'active'").all();

      if (venues.length === 0) {
        db.close();
        return notFound(res, "沒有已開通嘅商戶需要結算");
      }

      const payouts = [];

      for (const venue of venues) {
        // 計算呢段期間嘅 booking revenue
        let revenueQuery = `
          SELECT
            COUNT(*) as booking_count,
            COALESCE(SUM(amount), 0) as total_revenue,
            COALESCE(SUM(venue_earned_amount), 0) as venue_earned,
            COALESCE(SUM(platform_earned_amount), 0) as platform_commission
          FROM bookings
          WHERE venue_partner_id = ?
            AND status IN ('confirmed','attended')
            AND payment_status = 'paid'
        `;
        const params = [venue.id];

        if (period_start) {
          revenueQuery += " AND created_at >= ?";
          params.push(period_start);
        }
        if (period_end) {
          revenueQuery += " AND created_at <= ?";
          params.push(period_end);
        }

        const stats = db.prepare(revenueQuery).get(...params);

        if (stats.booking_count === 0) {
          continue; // Skip venues with no bookings
        }

        // 檢查係咪已經結算過（避免重複）
        const existingPayout = db
          .prepare(
            `SELECT id FROM partner_payouts
             WHERE venue_id = ?
               AND period_start = ?
               AND period_end = ?
               AND status = 'paid'`,
          )
          .get(venue.id, period_start || "all", period_end || "all");

        if (existingPayout) {
          continue;
        }

        const payoutId = uuidv4();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO partner_payouts (id, venue_id, period_start, period_end,
            total_revenue, platform_commission, venue_earned, status, paid_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, datetime('now'))
        `).run(
          payoutId, venue.id,
          period_start || "all", period_end || "all",
          stats.total_revenue, stats.platform_commission, stats.venue_earned,
          now,
        );

        payouts.push({
          id: payoutId,
          venue_id: venue.id,
          venue_name: venue.name,
          period_start: period_start || "all",
          period_end: period_end || "all",
          total_revenue: stats.total_revenue,
          platform_commission: stats.platform_commission,
          venue_earned: stats.venue_earned,
        });
      }

      db.close();

      return ok(res, {
        message: `已處理 ${payouts.length} 間商戶嘅結算`,
        payouts,
      });
    } catch (err) {
      console.error("❌ admin/process-partner-payouts error:", err.message);
      return serverError(res, "處理結算失敗");
    }
  },
);

// ===== 12. POST /api/partner/book — 商戶場地預約（partner aware booking）=====
// This is called when a user books a class at a partner venue
// The main /api/bookings route will also handle partner-awareness via middleware
router.post("/book", authenticateToken, (req, res) => {
  try {
    const { schedule_id, class_id, payment_type, amount } = req.body;

    if (!schedule_id || !class_id || !payment_type) {
      return fail(res, "缺少預約資料", 400);
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Check if this class belongs to a partner venue
    const classInfo = db.prepare("SELECT * FROM classes WHERE id = ?").get(class_id);
    if (!classInfo) {
      db.close();
      return notFound(res, "課程不存在");
    }

    // Find matching partner venue by venue_name
    const venue = db
      .prepare("SELECT * FROM partner_venues WHERE name = ? AND status = 'active'")
      .get(classInfo.venue_name);

    if (!venue) {
      db.close();
      return fail(res, "此課程不屬於合作場地", 400);
    }

    // Check schedule
    const schedule = db
      .prepare("SELECT * FROM class_schedules WHERE id = ? AND status = 'available'")
      .get(schedule_id);

    if (!schedule) {
      db.close();
      return notFound(res, "該時段不存在或已滿");
    }

    // Atomic capacity check
    const capResult = db.prepare(
      "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ? AND enrolled_count < max_participants"
    ).run(schedule_id);
    if (capResult.changes === 0) {
      db.close();
      return fail(res, "該時段已滿額", 400);
    }

    // Calculate partner commissions
    const commissionRate = venue.commission_rate || 0.3;
    const platformEarned = amount * commissionRate;
    const venueEarned = amount * (1 - commissionRate);

    const bookingId = uuidv4();
    db.prepare(`
      INSERT INTO bookings (id, user_id, schedule_id, class_id, payment_type,
        payment_status, amount, status, venue_partner_id,
        platform_commission_rate, venue_earned_amount, platform_earned_amount,
        created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, 'pending_payment', ?, ?, ?, ?, datetime('now'))
    `).run(
      bookingId, req.user.id, schedule_id, class_id, payment_type,
      amount, venue.id, commissionRate, venueEarned, platformEarned,
    );

    db.close();

    return created(res, {
      booking_id: bookingId,
      venue: venue.name,
      commission_rate: commissionRate,
      venue_earned: Math.round(venueEarned * 100) / 100,
      platform_earned: Math.round(platformEarned * 100) / 100,
    });
  } catch (err) {
    console.error("❌ partner/book error:", err.message);
    return serverError(res, "建立預約失敗");
  }
});

// ===== GET /api/partner/list — 公開：合作場地列表 =====
router.get("/list", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const partners = db.prepare(`
      SELECT id, name, description, category, district, logo_url
      FROM partner_venues WHERE status = 'active'
      ORDER BY created_at DESC
    `).all();
    db.close();
    res.json({ partners });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
