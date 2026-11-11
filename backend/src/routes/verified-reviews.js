/** Phase 5.2 — 真實履約評價 API */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const mk = require("../services/marketplace");

const router = express.Router();
const REVIEW_WINDOW_DAYS = 7;

function fail(res, status, code, error) {
  return res.status(status).json({ success: false, code, error });
}

function toIso(v) {
  const s = String(v || "");
  return /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z";
}

function loadBooking(db, bookingId) {
  return db.prepare(
    `SELECT b.*, s.end_time, s.coach_override_id, c.coach_id AS class_coach_id, c.title
       FROM bookings b
       LEFT JOIN class_schedules s ON s.id=b.schedule_id
       LEFT JOIN classes c ON c.id=b.class_id
      WHERE b.id=?`,
  ).get(bookingId);
}

// ===== POST /api/reviews/submit =====
router.post("/submit", authenticateToken, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    mk.ensureSchema(db);
    const b = req.body || {};
    const bookingId = String(b.booking_id || b.bookingId || "");
    const rating = Number(b.rating_score ?? b.ratingScore);
    const relief = b.pain_relief_score == null && b.painReliefScore == null ? null : Number(b.pain_relief_score ?? b.painReliefScore);
    const content = String(b.content || "").trim().slice(0, 1200);
    if (!bookingId) return fail(res, 400, "BOOKING_REQUIRED", "缺少預約編號");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, "RATING_INVALID", "評分必須為 1–5");
    if (relief != null && (!Number.isInteger(relief) || relief < 1 || relief > 5)) return fail(res, 400, "RELIEF_INVALID", "痛點改善評分必須為 1–5");
    if (content.length > 0 && content.length < 5) return fail(res, 400, "CONTENT_TOO_SHORT", "評語至少 5 個字，或留空");

    const booking = loadBooking(db, bookingId);
    if (!booking) return fail(res, 404, "BOOKING_NOT_FOUND", "找不到預約");
    if (booking.user_id !== req.user.id) return fail(res, 403, "FORBIDDEN", "只限本人評價");

    const attended = booking.attendance_status === "present" || booking.status === "attended";
    const clean = !String(booking.fraud_audit_status || "").startsWith("flagged");
    if (!attended || !clean) {
      return fail(res, 403, "FORBIDDEN", "僅限已完成核銷出席的學員提交真實評價");
    }

    const end = new Date(toIso(booking.end_time)).getTime();
    if (!Number.isFinite(end)) return fail(res, 409, "SCHEDULE_TIME_MISSING", "此預約缺少課堂時間，暫不可評價");
    const ageDays = (Date.now() - end) / 86400000;
    if (ageDays < 0) return fail(res, 409, "CLASS_NOT_FINISHED", "課堂仍未結束");
    if (ageDays > REVIEW_WINDOW_DAYS) return fail(res, 409, "REVIEW_WINDOW_CLOSED", "課後 7 天評價通道已關閉");

    const exists = db.prepare("SELECT id FROM verified_reviews WHERE booking_id=?").get(bookingId);
    if (exists) return fail(res, 409, "ALREADY_REVIEWED", "此課堂已提交評價");

    const coachId = booking.coach_override_id || booking.class_coach_id;
    if (!coachId) return fail(res, 409, "COACH_NOT_FOUND", "找不到此課堂教練");

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    const id = mk.uuidv4();
    db.prepare(
      `INSERT INTO verified_reviews (id, booking_id, schedule_id, coach_id, student_user_id, rating_score, pain_relief_score, content, is_anonymous)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, bookingId, booking.schedule_id, coachId, req.user.id, rating, relief, content, b.is_anonymous === false ? 0 : 1);
    db.exec("COMMIT");
    inTx = false;

    const stats = mk.recalcCoachRating(db, coachId);
    audit({
      actionType: "review.verified_submitted",
      entityType: "verified_review",
      entityId: id,
      userId: req.user.id,
      newValues: { booking_id: bookingId, coach_id: coachId, rating, pain_relief: relief, anonymous: b.is_anonymous !== false },
      description: "真實出席評價",
    });

    res.status(201).json({ success: true, review_id: id, coach: { id: coachId, ...stats }, message: "感謝你嘅真實反饋" });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    if (String(e.code || "").startsWith("SQLITE_CONSTRAINT")) return fail(res, 409, "ALREADY_REVIEWED", "此課堂已提交評價");
    console.error("[REVIEW] submit:", e.message);
    fail(res, 500, "SERVER_ERROR", "提交評價失敗");
  }
});

// ===== GET /api/reviews/coach/:coachId（公開） =====
router.get("/coach/:coachId", (req, res) => {
  try {
    const db = getDb();
    mk.ensureSchema(db);
    const coachId = String(req.params.coachId);
    const u = db.prepare("SELECT id,name,coach_headline,coach_tags,rating FROM users WHERE id=?").get(coachId);
    if (!u) return fail(res, 404, "COACH_NOT_FOUND", "找不到教練");
    const stats = mk.coachStats(db, coachId);
    const rows = db.prepare(
      `SELECT r.*, c.title, s.start_time FROM verified_reviews r
         LEFT JOIN classes c ON c.id=(SELECT class_id FROM class_schedules WHERE id=r.schedule_id)
         LEFT JOIN class_schedules s ON s.id=r.schedule_id
        WHERE r.coach_id=? AND r.is_anonymous=1 ORDER BY r.created_at DESC LIMIT 20`,
    ).all(coachId);
    res.json({
      success: true,
      coach: { id: u.id, name: mk.maskName(u.name), headline: u.coach_headline || "", tags: u.coach_tags || "" },
      stats,
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating_score,
        pain_relief: r.pain_relief_score,
        content: r.content || "",
        class_title: r.title || "",
        reviewed_at: r.created_at,
        verified: true,
        badge: "🛡️ 已通過 GPS 與現場核銷核實出席",
        coach_reply: r.coach_reply || null,
      })),
    });
  } catch (e) {
    console.error("[REVIEW] coach:", e.message);
    fail(res, 500, "SERVER_ERROR", "讀取評價失敗");
  }
});

// ===== POST /api/reviews/:id/reply（教練本人） =====
router.post("/:id/reply", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    mk.ensureSchema(db);
    const reply = String(req.body?.coach_reply || req.body?.reply || "").trim().slice(0, 600);
    if (reply.length < 2) return fail(res, 400, "REPLY_REQUIRED", "請輸入回覆內容");
    const r = db.prepare("SELECT * FROM verified_reviews WHERE id=?").get(req.params.id);
    if (!r) return fail(res, 404, "REVIEW_NOT_FOUND", "評價不存在");
    if (r.coach_id !== req.user.id) return fail(res, 403, "FORBIDDEN", "只限該堂教練回覆");
    if (r.coach_reply) return fail(res, 409, "ALREADY_REPLIED", "此評價已回覆");
    db.prepare("UPDATE verified_reviews SET coach_reply=?, coach_replied_at=datetime('now') WHERE id=?").run(reply, r.id);
    audit({ actionType: "review.coach_replied", entityType: "verified_review", entityId: r.id, userId: req.user.id, newValues: { reply }, description: "教練回覆評價" });
    res.json({ success: true, reply });
  } catch (e) {
    fail(res, 500, "SERVER_ERROR", "回覆失敗");
  }
});

module.exports = router;
module.exports.REVIEW_WINDOW_DAYS = REVIEW_WINDOW_DAYS;
