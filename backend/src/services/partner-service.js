/**
 * ZenPass 禪流 - 商戶服務層
 * 從 routes/partner.js 抽出嘅所有 Business Logic
 */

const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const { writeBlock } = require("./blockchain-audit");

// ==================== Helpers ====================

function generatePartnerReference() {
  const db = getDb();
  const max =
    db
      .prepare(
        "SELECT MAX(CAST(SUBSTR(partner_reference, 4) AS INTEGER)) as m FROM partner_venues WHERE partner_reference GLOB 'PT-[0-9]*'",
      )
      .get().m || 0;
  return "PT-" + String(max + 1).padStart(4, "0");
}

const COMMISSION_PLANS = {
  free: {
    key: "free",
    label: "Free",
    labelZh: "免費計劃",
    monthly_fee: 0,
    commission_rate: 0,
    description: "完全免費，不限課程數量，無隱藏收費",
  },
  basic: {
    key: "basic",
    label: "Basic",
    labelZh: "基本計劃",
    monthly_fee: 0,
    commission_rate: 0,
    description: "完全免費，不限課程數量，無隱藏收費",
  },
};

function getCommissionPlan(key) {
  return COMMISSION_PLANS[key] || COMMISSION_PLANS.basic;
}

function calcCommissionSplit(amount, planKey) {
  const plan = getCommissionPlan(planKey);
  const rate = plan.commission_rate;
  return {
    rate,
    platform_earned: Math.round(amount * rate * 100) / 100,
    venue_earned: Math.round(amount * (1 - rate) * 100) / 100,
  };
}

function partnerBlockchainHash({ venueId, reference, action, performedBy, data }) {
  try {
    return writeBlock({
      entityType: "partner_venue",
      entityId: venueId,
      data: JSON.stringify({
        reference,
        action,
        performedBy,
        data,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("[PARTNER-BLOCKCHAIN] Error:", e.message);
    return { error: e.message };
  }
}

function _getUserVenue(userId) {
  const db = getDb();
  try {
    const user = db
      .prepare("SELECT id, email, partner_id FROM users WHERE id = ?")
      .get(userId);
    if (!user) return null;
    if (user.partner_id) {
      return db
        .prepare("SELECT * FROM partner_venues WHERE id = ? AND status = 'active'")
        .get(user.partner_id);
    }
    return db
      .prepare("SELECT * FROM partner_venues WHERE (email = ? OR user_id = ?) AND status = 'active'")
      .get(user.email, userId);
  } finally {
    // noop
  }
}

// ==================== Venue Application ====================

function applyPartner(req) {
  const {
    name, description, address, phone, email, contact_person,
    category, district, website, commission_plan, logo_urls, facilities,
  } = req.body;

  if (!name || !phone) return { status: 400, body: { success: false, error: "請填寫場地名稱同電話" } };
  if (!category) return { status: 400, body: { success: false, error: "請選擇場地類別" } };
  if (!email) return { status: 400, body: { success: false, error: "請填寫電郵地址" } };

  const planKey = commission_plan || "free";
  const plan = getCommissionPlan(planKey);

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const existing = db.prepare("SELECT id FROM partner_venues WHERE email = ?").get(email);
  if (existing) {
    return { status: 409, body: { success: false, error: "此電郵已申請過，如有疑問請聯絡我們" } };
  }

  const id = uuidv4();
  const refNumber = generatePartnerReference();

  db.prepare(
    `INSERT INTO partner_venues (id, partner_type, name, description, address, phone, email,
       contact_person, category, district, logo_url, website, facilities,
       commission_plan, commission_rate, partner_reference, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
  ).run(
    id, req.body.partner_type || "full", name, description || "", address || "", phone, email,
    contact_person || "", category, district || "",
    Array.isArray(logo_urls) ? logo_urls[0] : logo_urls || null,
    website || "", JSON.stringify(Array.isArray(facilities) ? facilities : []),
    planKey, plan.commission_rate, refNumber,
  );

  partnerBlockchainHash({
    venueId: id, reference: refNumber, action: "created",
    performedBy: email, data: { name, category, plan: planKey },
  });

  return {
    status: 201,
    body: {
      id, reference: refNumber,
      commission_plan: planKey, commission_rate: plan.commission_rate,
      status: "active",
      dashboard_url: "/partner-dashboard.html",
      message: "🎉 登記成功！你嘅場地已自動啟用，而家可以開始加入課程",
    },
  };
}

function getPartnerStatus(userId) {
  const db = getDb();
  const user = db.prepare("SELECT email, name, partner_id FROM users WHERE id = ?").get(userId);
  if (!user) return { status: 404, body: { success: false, error: "用戶不存在" } };

  let venue;
  if (user.partner_id) {
    venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(user.partner_id);
  } else {
    venue = db.prepare("SELECT * FROM partner_venues WHERE email = ?").get(user.email);
  }

  if (!venue) return { status: 200, body: { has_application: false } };

  const plan = getCommissionPlan(venue.commission_plan || "basic");
  return {
    status: 200,
    body: {
      has_application: true,
      venue: {
        id: venue.id, name: venue.name, owner_id: venue.owner_id,
        status: venue.status, category: venue.category, district: venue.district,
        commission_rate: venue.commission_rate,
        commission_plan: venue.commission_plan || "basic",
        commission_plan_label: plan.labelZh,
        commission_plan_fee: plan.monthly_fee,
        created_at: venue.created_at, updated_at: venue.updated_at,
      },
    },
  };
}

function listCommissionPlans() {
  const plans = Object.values(COMMISSION_PLANS).map((p) => ({
    key: p.key, label: p.label, labelZh: p.labelZh,
    monthly_fee: p.monthly_fee, commission_rate: p.commission_rate,
    description: p.description,
  }));
  return { status: 200, body: { plans } };
}

// ==================== Venue CRUD ====================

function partnerDashboard(userId) {
  const venue = _getUserVenue(userId);
  if (!venue || venue.status !== "active") {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const bookingStats = db.prepare(
    `SELECT COUNT(*) as total_bookings, COALESCE(SUM(amount), 0) as total_revenue,
            COALESCE(SUM(venue_earned_amount), 0) as total_earned,
            COALESCE(SUM(platform_earned_amount), 0) as total_platform_fee,
            COUNT(DISTINCT user_id) as total_students
     FROM bookings
     WHERE venue_partner_id = ? AND status IN ('confirmed','attended')`
  ).get(venue.id);

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStats = db.prepare(
    `SELECT COALESCE(SUM(venue_earned_amount), 0) as this_month_earnings,
            COUNT(*) as this_month_bookings
     FROM bookings
     WHERE venue_partner_id = ? AND status IN ('confirmed','attended') AND created_at >= ?`
  ).get(venue.id, monthStart.toISOString().split("T")[0]);

  const monthPayouts = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total_paid
     FROM partner_payouts WHERE venue_id = ? AND status = 'paid'`
  ).get(venue.id);

  const coaches = db.prepare(
    `SELECT DISTINCT u.id, u.name, u.email, u.role
     FROM classes c JOIN users u ON c.coach_id = u.id
     WHERE c.partner_id = ?`
  ).all(venue.id);

  const plan = getCommissionPlan(venue.commission_plan || "basic");

  return {
    status: 200,
    body: {
      venue: {
        id: venue.id, name: venue.name, status: venue.status,
        owner_id: venue.owner_id, category: venue.category, district: venue.district,
        commission_rate: venue.commission_rate,
        commission_plan: venue.commission_plan || "basic",
        commission_plan_label: plan.labelZh,
        commission_plan_fee: plan.monthly_fee, description: plan.description,
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
    },
  };
}

function revenueReport(userId, query) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const { group_by = "month", limit: lim = 12 } = query;
  const validGroups = { day: "%Y-%m-%d", week: "%Y-%W", month: "%Y-%m" };
  const fmt = validGroups[group_by] || "%Y-%m";

  const rows = db.prepare(
    `SELECT strftime('${fmt}', cs.start_time) as period,
            COUNT(*) as booking_count,
            COALESCE(SUM(b.amount), 0) as total_revenue,
            COALESCE(SUM(b.venue_earned_amount), 0) as venue_earned,
            COALESCE(SUM(b.platform_earned_amount), 0) as platform_fee
     FROM bookings b
     JOIN class_schedules cs ON b.schedule_id = cs.id
     WHERE b.venue_partner_id = ? AND b.status IN ('confirmed','attended')
     GROUP BY strftime('${fmt}', cs.start_time)
     ORDER BY period DESC
     LIMIT ?`
  ).all(venue.id, Number(lim));

  return { status: 200, body: { report: rows, group_by } };
}

// ==================== Partner Bookings ====================

function partnerBookings(userId, query) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const { date_from, date_to, status, limit: lim = 50, offset: off = 0 } = query;

  let sql = `SELECT b.id, b.user_id, b.schedule_id, b.class_id, b.status,
                    b.amount, b.payment_status, b.platform_commission_rate,
                    b.venue_earned_amount, b.platform_earned_amount, b.created_at,
                    u.name as student_name, u.email as student_email, u.phone as student_phone,
                    c.title as class_title, c.category, cs.start_time, cs.end_time
             FROM bookings b
             JOIN users u ON b.user_id = u.id
             JOIN classes c ON b.class_id = c.id
             JOIN class_schedules cs ON b.schedule_id = cs.id
             WHERE b.venue_partner_id = ?`;
  const params = [venue.id];

  if (date_from) { sql += " AND cs.start_time >= ?"; params.push(date_from); }
  if (date_to) { sql += " AND cs.start_time <= ?"; params.push(date_to); }
  if (status) { sql += " AND b.status = ?"; params.push(status); }

  sql += " ORDER BY cs.start_time DESC LIMIT ? OFFSET ?";
  params.push(Number(lim), Number(off));

  const bookings = db.prepare(sql).all(...params);
  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM bookings b
     JOIN class_schedules cs ON b.schedule_id = cs.id
     WHERE b.venue_partner_id = ?`
  ).get(venue.id);

  return { status: 200, body: { bookings, total, limit: Number(lim), offset: Number(off) } };
}

// ==================== Partner Courses CRUD ====================

function createCourse(userId, body) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const { title, category, price_hkd, credits_cost, duration, max_participants,
          description, difficulty, schedules, image_url, coach_id } = body;

  if (!title || !category || !duration) {
    return { status: 400, body: { success: false, error: "請填寫課程標題、類別同時長" } };
  }
  // 至少要填 HK$ 價格或 Credits 其中一個
  if (!price_hkd && !credits_cost) {
    return { status: 400, body: { success: false, error: "請填寫 HK$ 價格或 Credits 消耗（可二選一或兩者都填）" } };
  }
  if (!schedules || !Array.isArray(schedules) || schedules.length === 0) {
    return { status: 400, body: { success: false, error: "請至少新增一個上堂時段" } };
  }

  const classId = uuidv4();
  const cid = coach_id || userId;
  const computedCredits = credits_cost
    ? Number(credits_cost)
    : Math.max(3, Math.round(price_hkd / 10));
  const finalPrice = price_hkd ? Number(price_hkd) : 0;

  db.prepare(
    `INSERT INTO classes (id, coach_id, title, description, category, difficulty,
       duration, max_participants, price_hkd, credits_cost, venue_name, venue_address,
       image_url, partner_venue_id, partner_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
  ).run(classId, cid, title, description || "", category, difficulty || "beginner",
    duration, max_participants || 15, finalPrice, computedCredits,
    venue.name, venue.address || "", image_url || null, venue.id, venue.id);

  const scheduleIds = [];
  for (const s of schedules) {
    const scheduleId = uuidv4();
    db.prepare(
      `INSERT INTO class_schedules (id, class_id, start_time, end_time,
         max_participants, enrolled_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 'available', datetime('now'))`
    ).run(scheduleId, classId, s.start_time, s.end_time, s.max_participants || max_participants || 15);
    scheduleIds.push(scheduleId);
  }

  // Ensure coach is linked
  const existingMember = db.prepare(
    "SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?"
  ).get(cid, venue.id);
  if (!existingMember) {
    db.prepare(
      `INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at)
       VALUES (?, ?, ?, 'coach', 'active', datetime('now'))`
    ).run(uuidv4(), cid, venue.id);
    try {
      writeBlock({
        entityType: "partner_member", entityId: uuidv4(),
        data: JSON.stringify({ user_id: cid, partner_id: venue.id, role: "coach", status: "active" }),
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (partner_member course):", bcErr.message);
    }
  }

  return {
    status: 201,
    body: {
      class_id: classId, title, price_hkd: finalPrice,
      credits_cost: computedCredits,
      schedules_count: scheduleIds.length, schedules: scheduleIds,
      partner_id: venue.id, message: "課程已成功建立",
    },
  };
}

function listCourses(userId) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const courses = db.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM bookings b WHERE b.class_id = c.id AND b.status IN ('confirmed','attended')) as booking_count
     FROM classes c
     WHERE (c.partner_id = ? OR c.partner_venue_id = ? OR c.venue_name = ?) AND c.status = 'active'
     ORDER BY c.created_at DESC`
  ).all(venue.id, venue.id, venue.name);

  for (const course of courses) {
    course.schedules = db.prepare(
      "SELECT * FROM class_schedules WHERE class_id = ? ORDER BY start_time ASC"
    ).all(course.id);
  }

  return { status: 200, body: courses };
}

function updateCourse(userId, courseId, body) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const classInfo = db.prepare(
    "SELECT * FROM classes WHERE id = ? AND (partner_id = ? OR partner_venue_id = ?)"
  ).get(courseId, venue.id, venue.id);
  if (!classInfo) {
    return { status: 404, body: { success: false, error: "課程不存在或唔屬於你" } };
  }

  const { title, price_hkd, description, difficulty, max_participants, credits_cost, image_url } = body;
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
    params.push(courseId);
    db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare("SELECT * FROM classes WHERE id = ?").get(courseId);
  return { status: 200, body: { message: "課程已更新", class: updated } };
}

// ==================== Partner Members ====================

function listMembers(userId) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const members = db.prepare(
    `SELECT pm.id, pm.user_id, pm.role as member_role, pm.status, pm.created_at,
            u.name, u.email, u.role as user_role, u.phone
     FROM partner_members pm JOIN users u ON pm.user_id = u.id
     WHERE pm.partner_id = ? AND pm.status = 'active'
     ORDER BY pm.created_at DESC`
  ).all(venue.id);

  for (const m of members) {
    if (m.member_role === "coach" || m.member_role === "partner_staff") {
      const courseCount = db.prepare(
        "SELECT COUNT(DISTINCT c.id) as count FROM classes c WHERE c.coach_user_id = ?"
      ).get(m.user_id);
      m.courses_count = courseCount ? courseCount.count : 0;
      const earnings = db.prepare(
        `SELECT COUNT(*) as bookings_count, COALESCE(SUM(b.amount), 0) as total_revenue
         FROM bookings b JOIN classes c ON b.class_id = c.id
         WHERE c.coach_user_id = ? AND b.status IN ('confirmed','attended')`
      ).get(m.user_id);
      m.bookings_count = earnings ? earnings.bookings_count : 0;
      m.total_revenue = earnings ? earnings.total_revenue : 0;
    } else {
      m.courses_count = 0; m.bookings_count = 0; m.total_revenue = 0;
    }
  }

  return { status: 200, body: { members } };
}

function addMember(userId, body) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const { user_id, role } = body;
  if (!user_id) return { status: 400, body: { success: false, error: "請提供用戶 ID" } };

  const memberRole = role || "coach";
  const db = getDb();

  const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(user_id);
  if (!user) return { status: 404, body: { success: false, error: "用戶不存在" } };

  const existing = db.prepare(
    "SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?"
  ).get(user_id, venue.id);
  if (existing) {
    return { status: 409, body: { success: false, error: "此用戶已是機構成員" } };
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at)
     VALUES (?, ?, ?, ?, 'active', datetime('now'))`
  ).run(id, user_id, venue.id, memberRole);

  try {
    writeBlock({
      entityType: "partner_member", entityId: id,
      data: JSON.stringify({ user_id, partner_id: venue.id, role: memberRole, status: "active" }),
    });
  } catch (bcErr) {
    console.error("⚠️ Blockchain write failed (partner_member add):", bcErr.message);
  }

  // Update user role
  const targetUser = db.prepare("SELECT role FROM users WHERE id = ?").get(user_id);
  if (targetUser && (!targetUser.role || targetUser.role === "user")) {
    db.prepare(
      "UPDATE users SET role = ?, partner_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(memberRole === "coach" ? "coach" : "partner_staff", venue.id, user_id);
  }

  return { status: 201, body: { message: `已新增 ${user.name} 為機構成員`, member_id: id } };
}

function removeMember(requesterId, targetUserId) {
  const venue = _getUserVenue(requesterId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const member = db.prepare(
    "SELECT * FROM partner_members WHERE user_id = ? AND partner_id = ?"
  ).get(targetUserId, venue.id);
  if (!member) return { status: 404, body: { success: false, error: "成員不存在" } };

  db.prepare("DELETE FROM partner_members WHERE user_id = ? AND partner_id = ?")
    .run(targetUserId, venue.id);

  return { status: 200, body: { message: "已移除成員" } };
}

// ==================== Payouts ====================

function listPayouts(userId) {
  const venue = _getUserVenue(userId);
  if (!venue) {
    return { status: 403, body: { success: false, error: "你未有已開通嘅商戶戶口" } };
  }

  const db = getDb();
  const payouts = db.prepare(
    "SELECT * FROM partner_payouts WHERE venue_id = ? ORDER BY created_at DESC"
  ).all(venue.id);

  return { status: 200, body: payouts };
}

// ==================== Partner Booking (via partner/book) ====================

function partnerBook(body, userId) {
  const { schedule_id, class_id, payment_type, amount } = body;
  if (!schedule_id || !class_id || !payment_type) {
    return { status: 400, body: { success: false, error: "缺少預約資料" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const classInfo = db.prepare("SELECT * FROM classes WHERE id = ?").get(class_id);
  if (!classInfo) return { status: 404, body: { success: false, error: "課程不存在" } };

  const venue = db.prepare(
    "SELECT * FROM partner_venues WHERE id = ? AND status = 'active'"
  ).get(classInfo.partner_id || classInfo.partner_venue_id);
  if (!venue) {
    return { status: 400, body: { success: false, error: "此課程不屬於合作場地" } };
  }

  const schedule = db.prepare(
    "SELECT * FROM class_schedules WHERE id = ? AND status = 'available'"
  ).get(schedule_id);
  if (!schedule) return { status: 404, body: { success: false, error: "該時段不存在或已滿" } };

  const capResult = db.prepare(
    "UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ? AND enrolled_count < max_participants"
  ).run(schedule_id);
  if (capResult.changes === 0) {
    return { status: 400, body: { success: false, error: "該時段已滿額" } };
  }

  const planKey = venue.commission_plan || "basic";
  const split = calcCommissionSplit(amount, planKey);

  const bookingId = uuidv4();
  db.prepare(
    `INSERT INTO bookings (id, user_id, schedule_id, class_id, payment_type,
       payment_status, amount, status, venue_partner_id,
       platform_commission_rate, venue_earned_amount, platform_earned_amount, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, 'pending_payment', ?, ?, ?, ?, datetime('now'))`
  ).run(bookingId, userId, schedule_id, class_id, payment_type,
    amount, venue.id, split.rate, split.venue_earned, split.platform_earned);

  return {
    status: 201,
    body: {
      booking_id: bookingId, venue: venue.name,
      commission_plan: planKey, commission_rate: split.rate,
      venue_earned: Math.round(split.venue_earned * 100) / 100,
      platform_earned: Math.round(split.platform_earned * 100) / 100,
    },
  };
}

// ==================== Admin: Partner Management ====================

function adminListApplications(status) {
  const db = getDb();
  const queryStatus = status || "pending";
  const rows = db.prepare(
    "SELECT * FROM partner_venues WHERE status = ? ORDER BY created_at DESC"
  ).all(queryStatus);

  for (const r of rows) {
    r._plan = getCommissionPlan(r.commission_plan || "basic");
  }

  return { status: 200, body: rows };
}

function adminApprovePartner(body, reqUser) {
  const { venue_id, action, commission_rate, commission_plan } = body;
  if (!venue_id || !action) return { status: 400, body: { success: false, error: "請提供 venue_id 同 action" } };
  if (!["accept", "reject"].includes(action)) {
    return { status: 400, body: { success: false, error: "action 必須係 accept 或 reject" } };
  }

  const db = getDb();
  db.pragma("foreign_keys = ON");

  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(venue_id);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  const now = new Date().toISOString();

  if (action === "accept") {
    let finalPlan = commission_plan || venue.commission_plan || "basic";
    let finalRate = commission_rate;
    if (finalRate === undefined || finalRate === null) {
      finalRate = getCommissionPlan(finalPlan).commission_rate;
    }
    const partnerRef = venue.partner_reference || generatePartnerReference();

    db.prepare(
      `UPDATE partner_venues SET status = 'active', commission_plan = ?, commission_rate = ?,
       partner_reference = COALESCE(partner_reference, ?), updated_at = ? WHERE id = ?`
    ).run(finalPlan, finalRate, partnerRef, now, venue_id);

    partnerBlockchainHash({
      venueId: venue_id, reference: partnerRef, action: "approved",
      performedBy: reqUser?.email || reqUser?.id || "system",
      data: { plan: finalPlan, rate: finalRate },
    });

    const planInfo = getCommissionPlan(finalPlan);
    return {
      status: 200,
      body: {
        message: "已通過申請，商戶可以開始使用平台",
        venue_id, partner_reference: partnerRef, status: "active",
        commission_plan: finalPlan, commission_rate: finalRate,
        plan_label: planInfo.labelZh, monthly_fee: planInfo.monthly_fee,
      },
    };
  } else {
    db.prepare("UPDATE partner_venues SET status = 'rejected', updated_at = ? WHERE id = ?")
      .run(now, venue_id);
    return { status: 200, body: { message: "已拒絕申請", venue_id, status: "rejected" } };
  }
}

function adminUpdatePartner(partnerId, body) {
  const { commission_plan, commission_rate, status, notes } = body;
  const db = getDb();

  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  const updates = [];
  const params = [];

  if (commission_plan) {
    const plan = getCommissionPlan(commission_plan);
    updates.push("commission_plan = ?"); params.push(commission_plan);
    updates.push("commission_rate = ?"); params.push(plan.commission_rate);
  }
  if (commission_rate !== undefined && !commission_plan) {
    updates.push("commission_rate = ?"); params.push(commission_rate);
  }
  if (status) { updates.push("status = ?"); params.push(status); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(partnerId);
    db.prepare(`UPDATE partner_venues SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  return { status: 200, body: { message: "已更新商戶設定", venue: updated } };
}

function adminListPartners(status) {
  const db = getDb();
  let rows;
  if (status) {
    rows = db.prepare("SELECT * FROM partner_venues WHERE status = ? ORDER BY created_at DESC").all(status);
  } else {
    rows = db.prepare("SELECT * FROM partner_venues ORDER BY created_at DESC").all();
  }

  for (const v of rows) {
    const stats = db.prepare(
      `SELECT COUNT(*) as total_bookings, COALESCE(SUM(b.amount), 0) as total_revenue
       FROM bookings b JOIN class_schedules cs ON b.schedule_id = cs.id
       JOIN classes c ON cs.class_id = c.id
       WHERE c.partner_venue_id = ? AND b.status IN ('confirmed','attended')`
    ).get(v.id);
    v.stats = stats;
    v._plan = getCommissionPlan(v.commission_plan || "basic");

    if (v.owner_id) {
      v.owner = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(v.owner_id);
    } else {
      v.owner = null;
    }

    const courseCount = db.prepare(
      "SELECT COUNT(*) as count FROM classes WHERE partner_venue_id = ? OR partner_id = ?"
    ).get(v.id, v.id);
    v.course_count = courseCount ? courseCount.count : 0;
  }

  return { status: 200, body: rows };
}

function adminRevenueReport(partnerId) {
  const db = getDb();
  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  const monthlyStats = db.prepare(
    `SELECT strftime('%Y-%m', cs.start_time) as month,
            COUNT(*) as booking_count,
            COALESCE(SUM(b.amount), 0) as total_revenue,
            COALESCE(SUM(b.venue_earned_amount), 0) as venue_earned,
            COALESCE(SUM(b.platform_earned_amount), 0) as platform_fee
     FROM bookings b
     JOIN class_schedules cs ON b.schedule_id = cs.id
     JOIN classes c ON cs.class_id = c.id
     WHERE c.partner_venue_id = ? AND b.status IN ('confirmed','attended')
       AND cs.start_time >= datetime('now', '-12 months')
     GROUP BY strftime('%Y-%m', cs.start_time)
     ORDER BY month DESC`
  ).all(venue.id);

  const totals = db.prepare(
    `SELECT COUNT(*) as total_bookings, COALESCE(SUM(b.amount), 0) as total_revenue,
            COALESCE(SUM(b.venue_earned_amount), 0) as total_venue_earned,
            COALESCE(SUM(b.platform_earned_amount), 0) as total_platform_fee
     FROM bookings b JOIN classes c ON b.class_id = c.id
     WHERE c.partner_venue_id = ? AND b.status IN ('confirmed','attended')`
  ).get(venue.id);

  const payouts = db.prepare(
    "SELECT * FROM partner_payouts WHERE venue_id = ? ORDER BY created_at DESC LIMIT 20"
  ).all(venue.id);

  return {
    status: 200,
    body: {
      venue: { id: venue.id, name: venue.name, commission_plan: venue.commission_plan, commission_rate: venue.commission_rate },
      monthly_stats: monthlyStats, totals, payouts,
    },
  };
}

function adminProcessPartnerPayouts(body) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const { period_start, period_end, venue_id } = body;

  const venues = venue_id
    ? [db.prepare("SELECT * FROM partner_venues WHERE id = ? AND status = 'active'").get(venue_id)].filter(Boolean)
    : db.prepare("SELECT * FROM partner_venues WHERE status = 'active'").all();

  if (venues.length === 0) {
    return { status: 404, body: { success: false, error: "沒有已開通嘅商戶需要結算" } };
  }

  const payouts = [];
  for (const venue of venues) {
    let revenueQuery = `SELECT COUNT(*) as booking_count,
                               COALESCE(SUM(amount), 0) as total_revenue,
                               COALESCE(SUM(venue_earned_amount), 0) as venue_earned,
                               COALESCE(SUM(platform_earned_amount), 0) as platform_commission
                        FROM bookings WHERE venue_partner_id = ?
                          AND status IN ('confirmed','attended') AND payment_status = 'paid'`;
    const params = [venue.id];
    if (period_start) { revenueQuery += " AND created_at >= ?"; params.push(period_start); }
    if (period_end) { revenueQuery += " AND created_at <= ?"; params.push(period_end); }

    const stats = db.prepare(revenueQuery).get(...params);
    if (stats.booking_count === 0) continue;

    const existingPayout = db.prepare(
      "SELECT id FROM partner_payouts WHERE venue_id = ? AND period_start = ? AND period_end = ? AND status = 'paid'"
    ).get(venue.id, period_start || "all", period_end || "all");
    if (existingPayout) continue;

    const payoutId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO partner_payouts (id, venue_id, period_start, period_end,
         total_revenue, platform_commission, venue_earned, status, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, datetime('now'))`
    ).run(payoutId, venue.id, period_start || "all", period_end || "all",
      stats.total_revenue, stats.platform_commission, stats.venue_earned, now);

    payouts.push({
      id: payoutId, venue_id: venue.id, venue_name: venue.name,
      period_start: period_start || "all", period_end: period_end || "all",
      total_revenue: stats.total_revenue,
      platform_commission: stats.platform_commission,
      venue_earned: stats.venue_earned,
    });
  }

  return {
    status: 200,
    body: { message: `已處理 ${payouts.length} 間商戶嘅結算`, payouts },
  };
}

function adminSetPartnerStatus(partnerId, status) {
  if (!["active", "suspended", "rejected"].includes(status)) {
    return { status: 400, body: { success: false, error: "狀態必需係 active / suspended / rejected" } };
  }

  const db = getDb();
  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  db.prepare("UPDATE partner_venues SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, partnerId);

  const updated = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  return { status: 200, body: { message: `商戶狀態已更新爲 ${status}`, venue: updated } };
}

function adminPartnerCourses(partnerId) {
  const db = getDb();
  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  const courses = db.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM class_schedules cs WHERE cs.class_id = c.id) as schedule_count,
            (SELECT COUNT(*) FROM bookings b JOIN class_schedules cs ON b.schedule_id = cs.id WHERE cs.class_id = c.id AND b.status IN ('confirmed','attended')) as booking_count
     FROM classes c WHERE c.partner_venue_id = ? OR c.partner_id = ?
     ORDER BY c.created_at DESC`
  ).all(partnerId, partnerId);

  const venues = db.prepare(
    "SELECT id, name, category, district, status FROM partner_venues WHERE id = ?"
  ).all(partnerId);

  return { status: 200, body: { courses, venues } };
}

function adminGetPartnerOwner(partnerId) {
  const db = getDb();
  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  let owner = null;
  if (venue.owner_id) {
    owner = db.prepare("SELECT id, name, email, phone, role FROM users WHERE id = ?").get(venue.owner_id);
  }

  const potentialOwners = db.prepare(
    "SELECT id, name, email FROM users WHERE role IN ('partner_owner', 'partner_admin', 'partner_staff', 'coach') OR partner_id = ? ORDER BY name"
  ).all(partnerId);

  return {
    status: 200,
    body: {
      venue: { id: venue.id, name: venue.name, owner_id: venue.owner_id },
      owner, potential_owners: potentialOwners,
    },
  };
}

function adminSetPartnerOwner(partnerId, ownerId, reqUserId) {
  if (!ownerId) return { status: 400, body: { success: false, error: "請提供負責人用戶 ID" } };

  const db = getDb();
  const venue = db.prepare("SELECT * FROM partner_venues WHERE id = ?").get(partnerId);
  if (!venue) return { status: 404, body: { success: false, error: "場地不存在" } };

  const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(ownerId);
  if (!user) return { status: 404, body: { success: false, error: "用戶不存在" } };

  db.prepare("UPDATE partner_venues SET owner_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(ownerId, partnerId);
  db.prepare("UPDATE users SET role = 'partner_owner', partner_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(partnerId, ownerId);

  const existing = db.prepare("SELECT id FROM partner_members WHERE user_id = ? AND partner_id = ?")
    .get(ownerId, partnerId);
  if (!existing) {
    const mid = uuidv4();
    db.prepare(
      `INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at)
       VALUES (?, ?, ?, 'partner_owner', 'active', datetime('now'))`
    ).run(mid, ownerId, partnerId);
    try {
      writeBlock({
        entityType: "partner_member", entityId: mid,
        data: JSON.stringify({ user_id: ownerId, partner_id: partnerId, role: "partner_owner", status: "active" }),
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (partner_member owner):", bcErr.message);
    }
  }

  return { status: 200, body: { message: `已指派 ${user.name} 爲商戶負責人` } };
}

// ==================== Exports ====================

module.exports = {
  // Core constants
  COMMISSION_PLANS,
  getCommissionPlan,
  calcCommissionSplit,

  // Helpers
  generatePartnerReference,
  _getUserVenue,
  partnerBlockchainHash,

  // Venue application
  applyPartner,
  getPartnerStatus,
  listCommissionPlans,

  // Dashboard & Reports
  partnerDashboard,
  revenueReport,
  partnerBookings,

  // Course CRUD
  createCourse,
  listCourses,
  updateCourse,

  // Members
  listMembers,
  addMember,
  removeMember,

  // Payouts
  listPayouts,

  // Partner booking
  partnerBook,

  // Admin: Partner management
  adminListApplications,
  adminApprovePartner,
  adminUpdatePartner,
  adminListPartners,
  adminRevenueReport,
  adminProcessPartnerPayouts,
  adminSetPartnerStatus,
  adminPartnerCourses,
  adminGetPartnerOwner,
  adminSetPartnerOwner,
};
