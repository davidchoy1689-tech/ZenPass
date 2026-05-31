/**
 * ZenPass 禪流 — 進階報表 API
 * 教練業績、轉化漏斗、留存分析、收入預測
 */

const express = require("express");
const Database = require("better-sqlite3");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/reporting/coach-ranking — 教練業績排名 =====
router.get("/coach-ranking", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const coaches = db
      .prepare(
        `
      SELECT u.id, u.name, u.email, u.total_earnings, u.pending_payout, u.commission_rate,
        (SELECT COUNT(*) FROM classes WHERE coach_id = u.id AND status = 'active') as class_count,
        (SELECT COUNT(*) FROM coach_earnings WHERE coach_id = u.id) as earning_entries,
        (SELECT COALESCE(SUM(ce.net_amount), 0) FROM coach_earnings ce WHERE ce.coach_id = u.id) as total_earned,
        (SELECT COUNT(*) FROM bookings b JOIN classes c ON b.class_id = c.id WHERE c.coach_id = u.id) as total_bookings,
        (SELECT COUNT(*) FROM bookings b JOIN classes c ON b.class_id = c.id WHERE c.coach_id = u.id AND b.status = 'attended') as attended_bookings
      FROM users u WHERE u.is_coach = 1 AND u.coach_verified = 1
      ORDER BY total_earned DESC
    `,
      )
      .all();
    db.close();
    res.json({ coaches });
  } catch (err) {
    console.error("Coach ranking error:", err);
    res.status(500).json({ error: "無法獲取教練排名" });
  }
});

// ===== GET /api/reporting/funnel — 轉化漏斗 =====
router.get("/funnel", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    const usersWithBooking = db
      .prepare("SELECT COUNT(DISTINCT user_id) as c FROM bookings")
      .get().c;
    const usersAttended = db
      .prepare(
        "SELECT COUNT(DISTINCT user_id) as c FROM bookings WHERE status='attended'",
      )
      .get().c;
    const repeatUsers =
      db.prepare(
        "SELECT COUNT(DISTINCT user_id) as c FROM bookings GROUP BY user_id HAVING COUNT(*) > 1",
      ).length ||
      db
        .prepare(
          "SELECT COUNT(*) as c FROM (SELECT user_id FROM bookings GROUP BY user_id HAVING COUNT(*) > 1)",
        )
        .get().c;
    const paidUsers = db
      .prepare(
        "SELECT COUNT(DISTINCT user_id) as c FROM bookings WHERE payment_status='paid'",
      )
      .get().c;
    db.close();

    res.json({
      funnel: [
        { stage: "所有用戶", count: totalUsers },
        {
          stage: "已預約",
          count: usersWithBooking,
          rate:
            totalUsers > 0
              ? Math.round((usersWithBooking / totalUsers) * 100)
              : 0,
        },
        {
          stage: "已付款",
          count: paidUsers,
          rate: totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : 0,
        },
        {
          stage: "已出席",
          count: usersAttended,
          rate:
            totalUsers > 0 ? Math.round((usersAttended / totalUsers) * 100) : 0,
        },
        {
          stage: "重複預約",
          count: repeatUsers,
          rate:
            totalUsers > 0 ? Math.round((repeatUsers / totalUsers) * 100) : 0,
        },
      ],
    });
  } catch (err) {
    console.error("Funnel error:", err);
    res.status(500).json({ error: "無法獲取轉化漏斗" });
  }
});

// ===== GET /api/reporting/retention — 留存率 =====
router.get("/retention", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const now = new Date().toISOString().split("T")[0];

    // Monthly cohorts
    const cohorts = db
      .prepare(
        `
      SELECT substr(created_at,1,7) as cohort,
        COUNT(*) as users,
        SUM(CASE WHEN julianday('now') - julianday(created_at) > 30 THEN 1 ELSE 0 END) as retained_30d,
        SUM(CASE WHEN julianday('now') - julianday(created_at) > 90 THEN 1 ELSE 0 END) as retained_90d
      FROM users
      GROUP BY cohort ORDER BY cohort DESC LIMIT 12
    `,
      )
      .all();

    // Overall retention
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
    const active30d = db
      .prepare(
        "SELECT COUNT(DISTINCT user_id) as c FROM bookings WHERE created_at > datetime('now', '-30 days')",
      )
      .get().c;
    const active90d = db
      .prepare(
        "SELECT COUNT(DISTINCT user_id) as c FROM bookings WHERE created_at > datetime('now', '-90 days')",
      )
      .get().c;
    db.close();

    res.json({
      cohorts,
      overall: {
        total_users: totalUsers,
        active_30d: active30d,
        active_90d: active90d,
        retention_30d:
          totalUsers > 0 ? Math.round((active30d / totalUsers) * 100) : 0,
        retention_90d:
          totalUsers > 0 ? Math.round((active90d / totalUsers) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("Retention error:", err);
    res.status(500).json({ error: "無法獲取留存率" });
  }
});

// ===== GET /api/reporting/revenue-trend — 收入趨勢 =====
router.get("/revenue-trend", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const monthly = db
      .prepare(
        `
      SELECT substr(created_at,1,7) as month,
        SUM(CASE WHEN payment_status='paid' THEN amount ELSE 0 END) as revenue,
        COUNT(CASE WHEN payment_status='paid' THEN 1 END) as paid_bookings,
        COUNT(*) as total_bookings
      FROM bookings
      GROUP BY month ORDER BY month DESC LIMIT 12
    `,
      )
      .all();

    const totalRevenue = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as rev FROM bookings WHERE payment_status='paid'",
      )
      .get().rev;
    const pendingRevenue = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as rev FROM bookings WHERE payment_status='pending'",
      )
      .get().rev;
    const thisMonth = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as rev FROM bookings WHERE payment_status='paid' AND substr(created_at,1,7) = substr(datetime('now'),1,7)",
      )
      .get().rev;
    db.close();

    res.json({
      monthly,
      summary: {
        total_revenue: totalRevenue,
        pending_revenue: pendingRevenue,
        this_month: thisMonth,
      },
    });
  } catch (err) {
    console.error("Revenue trend error:", err);
    res.status(500).json({ error: "無法獲取收入趨勢" });
  }
});

module.exports = router;
