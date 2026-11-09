/** 工單八 — 首發班次監控（admin only） */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/launch-tracker", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : "2026-12-12";
    const start = new Date(date + "T00:00:00+08:00");
    const end = new Date(start.getTime() + 86400e3);

    const sessions = db
      .prepare(
        `SELECT s.id AS session_id, s.start_time, s.end_time, s.max_participants,
                c.id AS class_id, c.title AS course_title, c.venue_name, u.name AS coach_name,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status IN ('confirmed','attended')) AS enrolled_count,
                (SELECT COALESCE(SUM(b.amount),0) FROM bookings b WHERE b.schedule_id=s.id AND b.payment_status='paid' AND b.status<>'cancelled') AS revenue
           FROM class_schedules s
           JOIN classes c ON c.id=s.class_id
           LEFT JOIN users u ON u.id=c.coach_id
           LEFT JOIN partner_venues pv ON pv.id=c.partner_venue_id
          WHERE s.start_time >= ? AND s.start_time < ?
            AND COALESCE(s.status,'') <> 'cancelled'
            AND COALESCE(c.status,'active') <> 'deleted'
            AND COALESCE(pv.is_sandbox,0) = 0
          ORDER BY s.start_time`,
      )
      .all(start.toISOString(), end.toISOString());

    const utmStmt = db.prepare(
      `SELECT COALESCE(NULLIF(utm_source,''),'direct') AS src, COUNT(*) AS n
         FROM bookings WHERE schedule_id=? AND status<>'cancelled' GROUP BY src`,
    );

    let totalEnrolled = 0, totalCapacity = 0, gross = 0;
    const utmTotal = {};
    const items = sessions.map((s) => {
      const breakdown = {};
      for (const r of utmStmt.all(s.session_id)) breakdown[r.src] = r.n;
      for (const [k, v] of Object.entries(breakdown)) utmTotal[k] = (utmTotal[k] || 0) + v;
      const cap = Number(s.max_participants || 0);
      totalEnrolled += Number(s.enrolled_count || 0);
      totalCapacity += cap;
      gross += Number(s.revenue || 0);
      return {
        session_id: s.session_id,
        course_title: s.course_title,
        venue_name: s.venue_name || "",
        coach_name: s.coach_name || "",
        start_time: s.start_time,
        enrolled_count: Number(s.enrolled_count || 0),
        max_participants: cap,
        seats_left: Math.max(0, cap - Number(s.enrolled_count || 0)),
        occupancy_rate: cap ? Math.round((Number(s.enrolled_count || 0) / cap) * 100) + "%" : "0%",
        total_revenue_cents: Math.round(Number(s.revenue || 0) * 100),
        utm_breakdown: breakdown,
      };
    });

    const family = utmTotal.family_outreach || 0;
    res.json({
      success: true,
      target_date: date,
      sessions: items,
      summary: {
        total_sessions: items.length,
        total_enrolled: totalEnrolled,
        total_capacity: totalCapacity,
        overall_occupancy: totalCapacity ? Math.round((totalEnrolled / totalCapacity) * 100) + "%" : "0%",
        total_gross_hkd: Math.round(gross * 100) / 100,
        utm_breakdown: utmTotal,
        family_share: totalEnrolled ? Math.round((family / totalEnrolled) * 100) + "%" : "0%",
      },
    });
  } catch (e) {
    console.error("[LAUNCH] tracker:", e.message);
    res.status(500).json({ success: false, error: "讀取首發數據失敗" });
  }
});

module.exports = router;
