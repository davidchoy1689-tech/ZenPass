/**
 * 教練學員名冊（美化版頁面用）— 真實資料總覽
 * GET /api/coach/roster/overview?q=
 *   → { students, sessions, enrollments, stats }
 * 唯讀；新增／編輯行返 /api/coach/students、簽到行 /api/coach/attendance/batch。
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const svc = require("../services/coach-students");

const router = express.Router();

function requireCoach(req, res, next) {
  const db = getDb();
  const u = db.prepare("SELECT role, is_coach FROM users WHERE id=?").get(req.user.id) || {};
  if (u.is_coach || ["coach", "super_admin", "platform_manager"].includes(u.role)) return next();
  return res.status(403).json({ success: false, error: "只限教練" });
}

router.get("/roster/overview", authenticateToken, requireCoach, (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    svc.matchAndBind(db, req.user.id);
    const { students, stats } = svc.listStudents(db, req.user.id, { q: req.query.q });

    const coachId = req.user.id;
    const sessions = db
      .prepare(
        `SELECT cs.id, COALESCE(cs.title, cl.title, '課堂') AS title, cs.start_time, cs.end_time,
                cs.max_participants, cs.status,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=cs.id AND b.status IN ('confirmed','attended')) AS booked
           FROM class_schedules cs
           LEFT JOIN classes cl ON cl.id = cs.class_id
          WHERE (cs.coach_id=? OR cs.coach_override_id=? OR cl.coach_id=?)
            AND cs.start_time >= datetime('now','-30 day')
          ORDER BY cs.start_time DESC
          LIMIT 200`,
      )
      .all(coachId, coachId, coachId);

    const enrollmentRows = db
      .prepare(
        `SELECT b.id AS booking_id, b.status AS booking_status, b.amount, b.group_size,
                COALESCE(u.name, b.parent_name, '學員') AS student_name,
                COALESCE(u.phone, b.parent_phone, '') AS phone,
                cs.id AS schedule_id, COALESCE(cs.title, cl.title, '課堂') AS title,
                cs.start_time, cs.status AS schedule_status
           FROM bookings b
           JOIN class_schedules cs ON cs.id = b.schedule_id
           LEFT JOIN classes cl ON cl.id = cs.class_id
           LEFT JOIN users u ON u.id = b.user_id
          WHERE (cs.coach_id=? OR cs.coach_override_id=? OR cl.coach_id=?)
            AND cs.start_time >= datetime('now','-90 day')
          ORDER BY cs.start_time DESC, b.created_at DESC
          LIMIT 1000`,
      )
      .all(coachId, coachId, coachId);

    const mapStatus = (s) =>
      s === "attended" ? "attended" : s === "no_show" ? "absent" : s === "cancelled" ? "cancelled" : s === "pending_payment" ? "pending" : "booked";
    const enrollments = enrollmentRows.map((e) => ({
      booking_id: e.booking_id,
      student_name: e.student_name,
      phone: e.phone,
      schedule_id: e.schedule_id,
      title: e.title,
      start_time: e.start_time,
      status: mapStatus(e.booking_status),
      raw_status: e.booking_status,
      group_size: Number(e.group_size) || 1,
      amount: Number(e.amount) || 0,
    }));

    const active = students.filter((s) => s.status === "registered" || s.status === "claimed").length;
    const pending = enrollments.filter((e) => e.status === "booked" || e.status === "pending").length;

    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      students: students.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        status: s.status,
        tags: s.tags,
        notes: s.notes,
        created_at: s.created_at,
        remaining_sessions: s.packages && s.packages.remaining_sessions,
      })),
      sessions,
      enrollments,
      stats: { students: students.length, active, enrollments: enrollments.length, pending },
    });
  } catch (e) {
    console.error("[ROSTER-OVERVIEW]", e.message);
    res.status(500).json({ success: false, error: "讀取名冊失敗" });
  }
});

module.exports = router;
