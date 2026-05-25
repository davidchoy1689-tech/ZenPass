/**
 * ZenPass 禪流 — 商戶加盟系統路由 (RBAC v2)
 *
 * 支援 10 級角色權限管理
 * 商戶負責人 (partner_owner) 只能管理自己機構
 * 平台管理員 (platform_manager+) 可以管理所有機構
 */

const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const {
  authenticateToken,
  requireAdmin,
  requireRole,
  requireOwnInstitution,
  getQueryPartnerId,
  ROLE_HIERARCHY,
  hasMinimumRole,
} = require("../middleware/auth");
const {
  ok, created, fail, notFound, unauthorized, serverError,
} = require("../services/response");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../../data/zenpass.db");

// ===== 佣金計劃定義 =====
const COMMISSION_PLANS = {
  basic:    { key: 'basic',    label: 'Basic',    labelZh: '基本計劃',  monthly_fee: 0,   commission_rate: 0.25, description: '適合小型工作室，無月費' },
  standard: { key: 'standard', label: 'Standard', labelZh: '標準計劃',  monthly_fee: 388, commission_rate: 0.18, description: '適合中型場地，月費 $388' },
  premium:  { key: 'premium',  label: 'Premium',  labelZh: '高級計劃',  monthly_fee: 888, commission_rate: 0.12, description: '適合大型連鎖，月費 $888' },
};

function getCommissionPlan(key) {
  return COMMISSION_PLANS[key] || COMMISSION_PLANS.basic;
}

// ===== Helper: 根據佣金計劃計算分佣 =====
function calcCommissionSplit(amount, planKey) {
  const plan = getCommissionPlan(planKey);
  const rate = plan.commission_rate;
  return {
    rate,
    platform_earned: Math.round(amount * rate * 100) / 100,
    venue_earned: Math.round(amount * (1 - rate) * 100) / 100,
  };
}

// ===== Helper: 取得用戶所屬嘅 partner venue =====
function _getUserVenue(userId) {
  const db = new Database(DB_PATH);
  try {
    const user = db.prepare("SELECT id, email, partner_id FROM users WHERE id = ?").get(userId);
    if (!user) return null;

    // If user has partner_id, use that
    if (user.partner_id) {
      return db.prepare("SELECT * FROM partner_venues WHERE id = ? AND status = 'active'").get(user.partner_id);
    }

    // Fallback: match by email
    return db.prepare("SELECT * FROM partner_venues WHERE (email = ? OR user_id = ?) AND status = 'active'").get(user.email, userId);
  } finally {
    db.close();
  }
}

// ===== 1. POST /api/partner/apply — 商戶提交申請（公開，唔需登入）=====
router.post("/apply", (req, res) => {
  try {
    const {
      name, description, address, phone, email,
      contact_person, category, district, website,
      commission_plan, logo_urls, facilities,
    } = req.body;

    if (!name || !phone) {
      return fail(res, "請填寫場地名稱同電話", 400);
    }

    if (!category) {
      return fail(res, "請選擇場地類別", 400);
    }

    if (!email) {
      return fail(res, "請填寫電郵地址", 400);
    }

    const planKey = commission_plan || 'basic';
    const plan = getCommissionPlan(planKey);

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const existing = db
      .prepare("SELECT id FROM partner_venues WHERE email = ?")
      .get(email);
    if (existing) {
      db.close();
      return fail(res, "此電郵已申請過，如有疑問請聯絡我們", 409);
    }

    const id = uuidv4();
    const refNumber = 'ZP-' + Date.now().toString(36).toUpperCase() + '-' + id.slice(0, 4).toUpperCase();

    db.prepare(`
      INSERT INTO partner_venues (id, partner_type, name, description, address, phone, email,
        contact_person, category, district, logo_url, website, facilities,
        commission_plan, commission_rate, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `).run(
      id, req.body.partner_type || 'full', name, description || "", address || "",
      phone, email, contact_person || "",
      category, district || "",
      Array.isArray(logo_urls) ? logo_urls[0] : (logo_urls || null),
      website || "",
      JSON.stringify(Array.isArray(facilities) ? facilities : []),
      planKey, plan.commission_rate,
    );

    db.close();

    return created(res, {
      id,
      reference: refNumber,
      commission_plan: planKey,
      commission_rate: plan.commission_rate,
      message: "已收到申請，我哋會喺 3 個工作天內聯絡你",
      estimated_review_time: "1-3 個工作天",
    });
  } catch (err) {
    console.error("❌ partner/apply error:", err.message);
    return serverError(res, "申請提交失敗，請稍後再試");
  }
});

// ===== 2. GET /api/partner/status — 商戶睇自己申請狀態 =====
router.get("/status", authenticateToken, requireRole('user'), (req, res) => {
  try {
    const db = new Database(DB_PATH);

    const user = db.prepare("SELECT email, name, partner_id FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      db.close();
      return notFound(res, "用戶不存在");
    }

    // Use partner_id if set, fallback to email-based lookup
    let venue;
    if (user.partner_id) {
      venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(user.partner_id);
    } else {
      venue = db.prepare("SELECT * FROM partner_venues WHERE email = ?").get(user.email);
    }

    db.close();

    if (!venue) {
      return ok(res, { has_application: false });
    }

    const plan = getCommissionPlan(venue.commission_plan || 'basic');

    return ok(res, {
      has_application: true,
      venue: {
        id: venue.id,
        name: venue.name,
        owner_id: venue.owner_id,
        status: venue.status,
        category: venue.category,
        district: venue.district,
        commission_rate: venue.commission_rate,
        commission_plan: venue.commission_plan || 'basic',
        commission_plan_label: plan.labelZh,
        commission_plan_fee: plan.monthly_fee,
        created_at: venue.created_at,
        updated_at: venue.updated_at,
      },
    });
  } catch (err) {
    console.error("❌ partner/status error:", err.message);
    return serverError(res, "查詢申請狀態失敗");
  }
});

// ===== 2b. GET /api/partner/commission-plans — 公開：佣金計劃列表 =====
router.get("/commission-plans", (req, res) => {
  try {
    const plans = Object.values(COMMISSION_PLANS).map(p => ({
      key: p.key,
      label: p.label,
      labelZh: p.labelZh,
      monthly_fee: p.monthly_fee,
      commission_rate: p.commission_rate,
      description: p.description,
    }));
    return ok(res, { plans });
  } catch (err) {
    return serverError(res, "載入佣金計劃失敗");
  }
});

// ===== 3. GET /api/admin/partner-applications — 管理員睇 pending 申請 =====
router.get(
  "/admin/partner-applications",
  authenticateToken,
  requireRole('admin'),
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

      for (const r of rows) {
        const plan = getCommissionPlan(r.commission_plan || 'basic');
        r._plan = plan;
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
  requireRole('admin'),
  (req, res) => {
    try {
      const { venue_id, action, commission_rate, commission_plan } = req.body;

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
        let finalPlan = commission_plan || venue.commission_plan || 'basic';
        let finalRate = commission_rate;
        if (finalRate === undefined || finalRate === null) {
          finalRate = getCommissionPlan(finalPlan).commission_rate;
        }

        db.prepare(
          `UPDATE partner_venues SET status = 'active',
            commission_plan = ?, commission_rate = ?,
            updated_at = ? WHERE id = ?`,
        ).run(finalPlan, finalRate, now, venue_id);

        db.close();

        const planInfo = getCommissionPlan(finalPlan);

        return ok(res, {
          message: "已通過申請，商戶可以開始使用平台",
          venue_id,
          status: "active",
          commission_plan: finalPlan,
          commission_rate: finalRate,
          plan_label: planInfo.labelZh,
          monthly_fee: planInfo.monthly_fee,
        });
      } else {
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

// ===== 4b. PUT /api/admin/partner/:id — 管理員更新商戶設定 =====
router.put(
  "/admin/partner/:id",
  authenticateToken,
  requireRole('admin'),
  (req, res) => {
    try {
      const { id } = req.params;
      const { commission_plan, commission_rate, status, notes } = req.body;

      const db = new Database(DB_PATH);
      const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
      if (!venue) {
        db.close();
        return notFound(res, "場地不存在");
      }

      const updates = [];
      const params = [];

      if (commission_plan) {
        const plan = getCommissionPlan(commission_plan);
        updates.push("commission_plan = ?");
        params.push(commission_plan);
        updates.push("commission_rate = ?");
        params.push(plan.commission_rate);
      }
      if (commission_rate !== undefined && !commission_plan) {
        updates.push("commission_rate = ?");
        params.push(commission_rate);
      }
      if (status) {
        updates.push("status = ?");
        params.push(status);
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        params.push(id);
        db.prepare(
          `UPDATE partner_venues SET ${updates.join(', ')} WHERE id = ?`
        ).run(...params);
      }

      const updated = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
      db.close();

      return ok(res, { message: "已更新商戶設定", venue: updated });
    } catch (err) {
      console.error("❌ admin/partner update error:", err.message);
      return serverError(res, "更新商戶設定失敗");
    }
  },
);

// ===== 5. GET /api/admin/partner-list — 管理員睇所有商戶 =====
router.get(
  "/admin/partner-list",
  authenticateToken,
  requireRole('admin'),
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

        const plan = getCommissionPlan(v.commission_plan || 'basic');
        v._plan = plan;

        // Include owner info if available
        if (v.owner_id) {
          const owner = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(v.owner_id);
          v.owner = owner || null;
        } else {
          v.owner = null;
        }

        // Course count
        const courseCount = db.prepare(
          "SELECT COUNT(*) as count FROM classes WHERE partner_venue_id = ? OR partner_id = ?"
        ).get(v.id, v.id);
        v.course_count = courseCount ? courseCount.count : 0;
      }

      db.close();
      return ok(res, rows);
    } catch (err) {
      console.error("❌ admin/partner-list error:", err.message);
      return serverError(res, "查詢商戶列表失敗");
    }
  },
);

// ===== 5b. GET /api/admin/partner/:id/revenue — 管理員睇特定場地收入報表 =====
router.get(
  "/admin/partner/:id/revenue",
  authenticateToken,
  requireRole('admin'),
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(req.params.id);
      if (!venue) {
        db.close();
        return notFound(res, "場地不存在");
      }

      const monthlyStats = db.prepare(`
        SELECT
          strftime('%Y-%m', cs.start_time) as month,
          COUNT(*) as booking_count,
          COALESCE(SUM(b.amount), 0) as total_revenue,
          COALESCE(SUM(b.venue_earned_amount), 0) as venue_earned,
          COALESCE(SUM(b.platform_earned_amount), 0) as platform_fee
        FROM bookings b
        JOIN class_schedules cs ON b.schedule_id = cs.id
        JOIN classes c ON cs.class_id = c.id
        WHERE c.partner_venue_id = ?
          AND b.status IN ('confirmed','attended')
          AND cs.start_time >= datetime('now', '-12 months')
        GROUP BY strftime('%Y-%m', cs.start_time)
        ORDER BY month DESC
      `).all(venue.id);

      const totals = db.prepare(`
        SELECT
          COUNT(*) as total_bookings,
          COALESCE(SUM(b.amount), 0) as total_revenue,
          COALESCE(SUM(b.venue_earned_amount), 0) as total_venue_earned,
          COALESCE(SUM(b.platform_earned_amount), 0) as total_platform_fee
        FROM bookings b
        JOIN classes c ON b.class_id = c.id
        WHERE c.partner_venue_id = ? AND b.status IN ('confirmed','attended')
      `).get(venue.id);

      const payouts = db.prepare(`
        SELECT * FROM partner_payouts WHERE venue_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(venue.id);

      db.close();

      return ok(res, {
        venue: { id: venue.id, name: venue.name, commission_plan: venue.commission_plan, commission_rate: venue.commission_rate },
        monthly_stats: monthlyStats,
        totals,
        payouts,
      });
    } catch (err) {
      console.error("❌ admin/partner revenue error:", err.message);
      return serverError(res, "查詢收入報表失敗");
    }
  },
);

// ===== 6. GET /api/partner/dashboard — 商戶儀表板 (RBAC: partner staff+) =====
router.get("/dashboard", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue || venue.status !== "active") {
      return fail(res, "你未有已開通嘅商戶戶口", 403);
    }

    const db = new Database(DB_PATH);

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

    const monthPayouts = db
      .prepare(
        `SELECT COALESCE(SUM(venue_earned), 0) as total_paid
         FROM partner_payouts
         WHERE venue_id = ? AND status = 'paid'`,
      )
      .get(venue.id);

    // Get coaches who taught at this venue (via partner_members or classes)
    const coaches = db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email, u.role
         FROM classes c
         JOIN users u ON c.coach_id = u.id
         WHERE c.partner_id = ?`,
      )
      .all(venue.id);

    const plan = getCommissionPlan(venue.commission_plan || 'basic');

    db.close();

    return ok(res, {
      venue: {
        id: venue.id,
        name: venue.name,
        status: venue.status,
        owner_id: venue.owner_id,
        category: venue.category,
        district: venue.district,
        commission_rate: venue.commission_rate,
        commission_plan: venue.commission_plan || 'basic',
        commission_plan_label: plan.labelZh,
        commission_plan_fee: plan.monthly_fee,
        description: plan.description,
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

// ===== 6b. GET /api/partner/revenue-report — 商戶收入報表 =====
router.get("/revenue-report", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);
    const { group_by = 'month', limit: lim = 12 } = req.query;
    const validGroups = { 'day': '%Y-%m-%d', 'week': '%Y-%W', 'month': '%Y-%m' };
    const fmt = validGroups[group_by] || '%Y-%m';

    const rows = db.prepare(`
      SELECT
        strftime('${fmt}', cs.start_time) as period,
        COUNT(*) as booking_count,
        COALESCE(SUM(b.amount), 0) as total_revenue,
        COALESCE(SUM(b.venue_earned_amount), 0) as venue_earned,
        COALESCE(SUM(b.platform_earned_amount), 0) as platform_fee
      FROM bookings b
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.venue_partner_id = ?
        AND b.status IN ('confirmed','attended')
      GROUP BY strftime('${fmt}', cs.start_time)
      ORDER BY period DESC
      LIMIT ?
    `).all(venue.id, Number(lim));

    db.close();
    return ok(res, { report: rows, group_by });
  } catch (err) {
    console.error("❌ partner/revenue-report error:", err.message);
    return serverError(res, "載入收入報表失敗");
  }
});

// ===== 7. GET /api/partner/bookings — 商戶睇自己場地預約 =====
router.get("/bookings", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);
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

    if (date_from) { query += " AND cs.start_time >= ?"; params.push(date_from); }
    if (date_to) { query += " AND cs.start_time <= ?"; params.push(date_to); }
    if (status) { query += " AND b.status = ?"; params.push(status); }

    query += " ORDER BY cs.start_time DESC LIMIT ? OFFSET ?";
    params.push(Number(lim), Number(off));

    const bookings = db.prepare(query).all(...params);
    const { total } = db.prepare(
      `SELECT COUNT(*) as total FROM bookings b
       JOIN class_schedules cs ON b.schedule_id = cs.id
       WHERE b.venue_partner_id = ?`
    ).get(venue.id);

    db.close();
    return ok(res, { bookings, total, limit: Number(lim), offset: Number(off) });
  } catch (err) {
    console.error("❌ partner/bookings error:", err.message);
    return serverError(res, "查詢預約記錄失敗");
  }
});

// ===== 8. POST /api/partner/courses — 商戶開新班 (RBAC: partner staff+) =====
router.post("/courses", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const {
      title, category, price_hkd, credits_cost, duration, max_participants,
      description, difficulty, schedules, image_url, coach_id,
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
    const cid = coach_id || req.user.id;
    const computedCredits = credits_cost || Math.max(5, Math.round(price_hkd / 38));

    db.prepare(`
      INSERT INTO classes (id, coach_id, title, description, category, difficulty,
        duration, max_participants, price_hkd, credits_cost, venue_name, venue_address,
        image_url, partner_venue_id, partner_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).run(
      classId, cid, title, description || "", category,
      difficulty || "beginner", duration,
      max_participants || 15, price_hkd, computedCredits,
      venue.name, venue.address || "",
      image_url || null, venue.id, venue.id,
    );

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

    // Ensure coach is linked in partner_members
    const existingMember = db.prepare("SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?").get(cid, venue.id);
    if (!existingMember) {
      db.prepare(`
        INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at)
        VALUES (?, ?, ?, 'coach', 'active', datetime('now'))
      `).run(uuidv4(), cid, venue.id);
    }

    db.close();

    return created(res, {
      class_id: classId,
      title,
      credits_cost: computedCredits,
      schedules_count: scheduleIds.length,
      schedules: scheduleIds,
      partner_id: venue.id,
      message: "課程已成功建立",
    });
  } catch (err) {
    console.error("❌ partner/courses POST error:", err.message);
    return serverError(res, "建立課程失敗");
  }
});

// ===== 9. GET /api/partner/courses — 商戶睇自己嘅課程 =====
router.get("/courses", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);

    const courses = db
      .prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM bookings b WHERE b.class_id = c.id AND b.status IN ('confirmed','attended')) as booking_count
        FROM classes c
        WHERE (c.partner_id = ? OR c.partner_venue_id = ? OR c.venue_name = ?)
          AND c.status = 'active'
        ORDER BY c.created_at DESC
      `)
      .all(venue.id, venue.id, venue.name);

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

// ===== 9b. PUT /api/partner/courses/:id — 商戶編輯課程 =====
router.put("/courses/:id", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const classInfo = db.prepare("SELECT * FROM classes WHERE id = ? AND (partner_id = ? OR partner_venue_id = ?)").get(req.params.id, venue.id, venue.id);
    if (!classInfo) { db.close(); return notFound(res, "課程不存在或唔屬於你"); }

    const { title, price_hkd, description, difficulty, max_participants, credits_cost, image_url } = req.body;
    const updates = [];
    const params = [];

    if (title) { updates.push("title = ?"); params.push(title); }
    if (price_hkd !== undefined) { updates.push("price_hkd = ?"); params.push(price_hkd); }
    if (description !== undefined) { updates.push("description = ?"); params.push(description); }
    if (difficulty) { updates.push("difficulty = ?"); params.push(difficulty); }
    if (max_participants) { updates.push("max_participants = ?"); params.push(max_participants); }
    if (credits_cost !== undefined) { updates.push("credits_cost = ?"); params.push(credits_cost); }
    if (image_url !== undefined) { updates.push("image_url = ?"); params.push(image_url); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      params.push(req.params.id);
      db.prepare(`UPDATE classes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    const updated = db.prepare("SELECT * FROM classes WHERE id = ?").get(req.params.id);
    db.close();
    return ok(res, { message: "課程已更新", class: updated });
  } catch (err) {
    console.error("❌ partner/courses PUT error:", err.message);
    return serverError(res, "更新課程失敗");
  }
});

// ===== 10. GET /api/partner/payouts — 商戶睇 payout 記錄 =====
router.get("/payouts", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);
    const payouts = db
      .prepare(`SELECT * FROM partner_payouts WHERE venue_id = ? ORDER BY created_at DESC`)
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
  requireRole('admin'),
  (req, res) => {
    try {
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");

      const { period_start, period_end, venue_id } = req.body;

      const venues = venue_id
        ? [db.prepare("SELECT * FROM partner_venues WHERE id = ? AND status = 'active'").get(venue_id)].filter(Boolean)
        : db.prepare("SELECT * FROM partner_venues WHERE status = 'active'").all();

      if (venues.length === 0) {
        db.close();
        return notFound(res, "沒有已開通嘅商戶需要結算");
      }

      const payouts = [];

      for (const venue of venues) {
        let revenueQuery = `
          SELECT COUNT(*) as booking_count,
            COALESCE(SUM(amount), 0) as total_revenue,
            COALESCE(SUM(venue_earned_amount), 0) as venue_earned,
            COALESCE(SUM(platform_earned_amount), 0) as platform_commission
          FROM bookings
          WHERE venue_partner_id = ?
            AND status IN ('confirmed','attended')
            AND payment_status = 'paid'
        `;
        const params = [venue.id];
        if (period_start) { revenueQuery += " AND created_at >= ?"; params.push(period_start); }
        if (period_end) { revenueQuery += " AND created_at <= ?"; params.push(period_end); }

        const stats = db.prepare(revenueQuery).get(...params);
        if (stats.booking_count === 0) continue;

        const existingPayout = db
          .prepare(`SELECT id FROM partner_payouts WHERE venue_id = ? AND period_start = ? AND period_end = ? AND status = 'paid'`)
          .get(venue.id, period_start || "all", period_end || "all");
        if (existingPayout) continue;

        const payoutId = uuidv4();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO partner_payouts (id, venue_id, period_start, period_end,
            total_revenue, platform_commission, venue_earned, status, paid_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, datetime('now'))
        `).run(payoutId, venue.id, period_start || "all", period_end || "all",
          stats.total_revenue, stats.platform_commission, stats.venue_earned, now);

        payouts.push({
          id: payoutId, venue_id: venue.id, venue_name: venue.name,
          period_start: period_start || "all", period_end: period_end || "all",
          total_revenue: stats.total_revenue, platform_commission: stats.platform_commission,
          venue_earned: stats.venue_earned,
        });
      }

      db.close();
      return ok(res, { message: `已處理 ${payouts.length} 間商戶嘅結算`, payouts });
    } catch (err) {
      console.error("❌ admin/process-partner-payouts error:", err.message);
      return serverError(res, "處理結算失敗");
    }
  },
);

// ===== 12. POST /api/partner/book — 商戶場地預約 =====
router.post("/book", authenticateToken, requireRole('user'), (req, res) => {
  try {
    const { schedule_id, class_id, payment_type, amount } = req.body;

    if (!schedule_id || !class_id || !payment_type) {
      return fail(res, "缺少預約資料", 400);
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const classInfo = db.prepare("SELECT * FROM classes WHERE id = ?").get(class_id);
    if (!classInfo) { db.close(); return notFound(res, "課程不存在"); }

    const venue = db
      .prepare("SELECT * FROM partner_venues WHERE id = ? AND status = 'active'")
      .get(classInfo.partner_id || classInfo.partner_venue_id);

    if (!venue) { db.close(); return fail(res, "此課程不屬於合作場地", 400); }

    const schedule = db
      .prepare("SELECT * FROM class_schedules WHERE id = ? AND status = 'available'")
      .get(schedule_id);
    if (!schedule) { db.close(); return notFound(res, "該時段不存在或已滿"); }

    const capResult = db.prepare(
      "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ? AND enrolled_count < max_participants"
    ).run(schedule_id);
    if (capResult.changes === 0) { db.close(); return fail(res, "該時段已滿額", 400); }

    const planKey = venue.commission_plan || 'basic';
    const split = calcCommissionSplit(amount, planKey);

    const bookingId = uuidv4();
    db.prepare(`
      INSERT INTO bookings (id, user_id, schedule_id, class_id, payment_type,
        payment_status, amount, status, venue_partner_id,
        platform_commission_rate, venue_earned_amount, platform_earned_amount, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, 'pending_payment', ?, ?, ?, ?, datetime('now'))
    `).run(
      bookingId, req.user.id, schedule_id, class_id, payment_type,
      amount, venue.id, split.rate, split.venue_earned, split.platform_earned,
    );

    db.close();
    return created(res, {
      booking_id: bookingId,
      venue: venue.name,
      commission_plan: planKey,
      commission_rate: split.rate,
      venue_earned: Math.round(split.venue_earned * 100) / 100,
      platform_earned: Math.round(split.platform_earned * 100) / 100,
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
      SELECT id, name, description, category, district, logo_url, commission_plan, owner_id
      FROM partner_venues WHERE status = 'active'
      ORDER BY created_at DESC
    `).all();
    db.close();
    res.json({ partners });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== RBAC Helper: GET /api/partner/roles — 查角色層級 =====
router.get("/roles", authenticateToken, requireRole('admin'), (req, res) => {
  try {
    return ok(res, {
      hierarchy: ROLE_HIERARCHY,
      roles: Object.entries(ROLE_HIERARCHY).map(([role, level]) => ({
        role,
        level,
        label: role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      })).sort((a, b) => a.level - b.level),
    });
  } catch (err) {
    return serverError(res, "載入角色層級失敗");
  }
});

// ===== RBAC Helper: PUT /api/partner/users/:id/role — 管理員設定用戶角色 =====
router.put("/users/:id/role", authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { role, partner_id } = req.body;

    if (!role || !ROLE_HIERARCHY[role]) {
      return fail(res, `無效角色。可用角色: ${Object.keys(ROLE_HIERARCHY).join(', ')}`, 400);
    }

    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT id, email, role, partner_id FROM users WHERE id = ?").get(id);
    if (!user) { db.close(); return notFound(res, "用戶不存在"); }

    // Only super_admin/platform_manager can set roles above admin
    if (hasMinimumRole(role, 'admin') && !hasMinimumRole(req.user.role, 'platform_manager')) {
      db.close();
      return fail(res, "你無法設定管理層級角色", 403);
    }

    db.prepare("UPDATE users SET role = ?, partner_id = COALESCE(?, partner_id), updated_at = datetime('now') WHERE id = ?")
      .run(role, partner_id || null, id);

    const updated = db.prepare("SELECT id, email, name, role, partner_id FROM users WHERE id = ?").get(id);
    db.close();

    return ok(res, { message: `已更新用戶 ${updated.name} 角色為 ${role}`, user: updated });
  } catch (err) {
    console.error("❌ partner/users/:id/role error:", err.message);
    return serverError(res, "設定用戶角色失敗");
  }
});

// ===== RBAC Helper: GET /api/partner/members — 商戶成員列表 =====
router.get("/members", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const db = new Database(DB_PATH);
    const members = db.prepare(`
      SELECT pm.id, pm.user_id, pm.role as member_role, pm.status, pm.created_at,
             u.name, u.email, u.role as user_role, u.phone
      FROM partner_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.partner_id = ? AND pm.status = 'active'
      ORDER BY pm.created_at DESC
    `).all(venue.id);

    // Add per-coach stats (courses taught, earnings)
    for (const m of members) {
      if (m.member_role === 'coach' || m.member_role === 'partner_staff') {
        const courseCount = db.prepare(`
          SELECT COUNT(DISTINCT c.id) as count
          FROM classes c
          WHERE c.coach_user_id = ?
        `).get(m.user_id);
        m.courses_count = courseCount ? courseCount.count : 0;

        const earnings = db.prepare(`
          SELECT
            COUNT(*) as bookings_count,
            COALESCE(SUM(b.amount), 0) as total_revenue
          FROM bookings b
          JOIN classes c ON b.class_id = c.id
          WHERE c.coach_user_id = ? AND b.status IN ('confirmed','attended')
        `).get(m.user_id);
        m.bookings_count = earnings ? earnings.bookings_count : 0;
        m.total_revenue = earnings ? earnings.total_revenue : 0;
      } else {
        m.courses_count = 0;
        m.bookings_count = 0;
        m.total_revenue = 0;
      }
    }

    db.close();
    return ok(res, { members });
  } catch (err) {
    console.error("❌ partner/members error:", err.message);
    return serverError(res, "查詢成員失敗");
  }
});

// ===== RBAC Helper: POST /api/partner/members — 商戶新增成員 =====
router.post("/members", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    const { user_id, role } = req.body;
    if (!user_id) { return fail(res, "請提供用戶 ID", 400); }

    const memberRole = role || 'coach';

    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(user_id);
    if (!user) { db.close(); return notFound(res, "用戶不存在"); }

    const existing = db.prepare("SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?").get(user_id, venue.id);
    if (existing) { db.close(); return fail(res, "此用戶已是機構成員", 409); }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at)
      VALUES (?, ?, ?, ?, 'active', datetime('now'))
    `).run(id, user_id, venue.id, memberRole);

    // Also update user's role to coach/partner_staff if they're just a regular user
    const targetUser = db.prepare("SELECT role FROM users WHERE id = ?").get(user_id);
    if (targetUser && (!targetUser.role || ROLE_HIERARCHY[targetUser.role] > ROLE_HIERARCHY.coach)) {
      db.prepare("UPDATE users SET role = ?, partner_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(memberRole === 'coach' ? 'coach' : 'partner_staff', venue.id, user_id);
    }

    db.close();
    return created(res, { message: `已新增 ${user.name} 為機構成員`, member_id: id });
  } catch (err) {
    console.error("❌ partner/members POST error:", err.message);
    return serverError(res, "新增成員失敗");
  }
});

// ===== RBAC Helper: DELETE /api/partner/members/:userId — 商戶移除成員 =====
router.delete("/members/:userId", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _getUserVenue(req.user.id);
    if (!venue) { return fail(res, "你未有已開通嘅商戶戶口", 403); }

    // Only owner/admin can remove members
    const requesterRole = req.user.role;
    if (!hasMinimumRole(requesterRole, 'partner_admin')) {
      return fail(res, "需要管理權限先可移除成員", 403);
    }

    const { userId } = req.params;
    const db = new Database(DB_PATH);

    const member = db.prepare("SELECT * FROM partner_members WHERE user_id = ? AND partner_id = ?").get(userId, venue.id);
    if (!member) { db.close(); return notFound(res, "成員不存在"); }

    db.prepare("DELETE FROM partner_members WHERE user_id = ? AND partner_id = ?").run(userId, venue.id);
    db.close();

    return ok(res, { message: "已移除成員" });
  } catch (err) {
    console.error("❌ partner/members DELETE error:", err.message);
    return serverError(res, "移除成員失敗");
  }
});

// ===== Admin: PUT /api/admin/partner/:id/status — 管理員更改商戶狀態 (suspend/activate) =====
router.put("/admin/partner/:id/status", authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'rejected'].includes(status)) {
      return fail(res, "狀態必需係 active / suspended / rejected", 400);
    }

    const db = new Database(DB_PATH);
    const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
    if (!venue) { db.close(); return notFound(res, "場地不存在"); }

    db.prepare("UPDATE partner_venues SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id);

    const updated = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
    db.close();

    return ok(res, { message: `商戶狀態已更新爲 ${status}`, venue: updated });
  } catch (err) {
    console.error("❌ admin/partner status error:", err.message);
    return serverError(res, "更新狀態失敗");
  }
});

// ===== Admin: GET /api/admin/partner/:id/courses — 管理員睇特定商戶嘅課程 =====
router.get("/admin/partner/:id/courses", authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const db = new Database(DB_PATH);

    const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
    if (!venue) { db.close(); return notFound(res, "場地不存在"); }

    const courses = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM class_schedules cs WHERE cs.class_id = c.id) as schedule_count,
        (SELECT COUNT(*) FROM bookings b JOIN class_schedules cs ON b.schedule_id = cs.id WHERE cs.class_id = c.id AND b.status IN ('confirmed','attended')) as booking_count
      FROM classes c
      WHERE c.partner_venue_id = ? OR c.partner_id = ?
      ORDER BY c.created_at DESC
    `).all(id, id);

    // Get venues for this partner
    const venues = db.prepare("SELECT id, name, category, district, status FROM partner_venues WHERE id = ?").all(id);

    db.close();
    return ok(res, { courses, venues });
  } catch (err) {
    console.error("❌ admin/partner courses error:", err.message);
    return serverError(res, "查詢課程失敗");
  }
});

// ===== Admin: GET /api/admin/partner/:id/owner — 查詢商戶負責人資訊 =====
router.get("/admin/partner/:id/owner", authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const db = new Database(DB_PATH);

    const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
    if (!venue) { db.close(); return notFound(res, "場地不存在"); }

    let owner = null;
    if (venue.owner_id) {
      owner = db.prepare("SELECT id, name, email, phone, role FROM users WHERE id = ?").get(venue.owner_id);
    }

    // Get all users who could be owners
    const potentialOwners = db.prepare(
      "SELECT id, name, email FROM users WHERE role IN ('partner_owner', 'partner_admin', 'partner_staff', 'coach') OR partner_id = ? ORDER BY name"
    ).all(id);

    db.close();
    return ok(res, { venue: { id: venue.id, name: venue.name, owner_id: venue.owner_id }, owner, potential_owners: potentialOwners });
  } catch (err) {
    console.error("❌ admin/partner owner error:", err.message);
    return serverError(res, "查詢負責人資訊失敗");
  }
});

// ===== Admin: PUT /api/admin/partner/:id/owner — 管理員指派商戶負責人 =====
router.put("/admin/partner/:id/owner", authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { owner_id } = req.body;

    if (!owner_id) { return fail(res, "請提供負責人用戶 ID", 400); }

    const db = new Database(DB_PATH);
    const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(id);
    if (!venue) { db.close(); return notFound(res, "場地不存在"); }

    const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(owner_id);
    if (!user) { db.close(); return notFound(res, "用戶不存在"); }

    // Update venue owner
    db.prepare("UPDATE partner_venues SET owner_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(owner_id, id);

    // Update user role to partner_owner
    db.prepare("UPDATE users SET role = 'partner_owner', partner_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(id, owner_id);

    // Ensure this user is in partner_members
    const existing = db.prepare("SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?").get(owner_id, id);
    if (!existing) {
      const mid = uuidv4();
      db.prepare("INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at) VALUES (?, ?, ?, 'partner_owner', 'active', datetime('now'))")
        .run(mid, owner_id, id);
    }

    db.close();
    return ok(res, { message: `已指派 ${user.name} 爲商戶負責人` });
  } catch (err) {
    console.error("❌ admin/partner owner assign error:", err.message);
    return serverError(res, "指派負責人失敗");
  }
});

module.exports = router;
