/**
 * coach-session-decision.js — 教練「開班決定」閉環（2026-11-16 David 指示）
 *
 * 背景：班上人數不足唔關學生事 → 一律 100% 退款，唔應該用「<24h 不退」政策。
 *      原本只有 quorum-worker 喺開課前 12 小時自動流標，教練冇任何話事權。
 *
 * 本模組畀教練自己決定：
 *   ① 照常開班（即使唔夠人）→ quorum_status='coach_will_run'，quorum-worker 唔會再自動取消
 *   ② 取消並 100% 退款 → 立即取消班次、逐筆原路退款（Pass 還堂 / Credits 全退 / 現金標記待人手 FPS）
 *
 * 鐵律：
 *  - 退款政策：人數不足取消 → 100%，任何時間都唔扣手續費
 *  - 只處理 status='confirmed' 預約（pending_payment 未付款不動）
 *  - 全程 transaction；重複呼叫安全（已取消嘅班次回 409）
 *  - 所有決定寫 audit_log；通知寫 scheduled_notifications_log（同 quorum-worker 同一隊列）
 *
 * API：
 *   GET  /api/coach/session-decisions?days=14
 *   POST /api/coach/session-decisions/:id/run
 *   POST /api/coach/session-decisions/:id/cancel   { reason, confirmed:true }
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const quorum = require("../services/quorum-worker");

const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ["super_admin", "platform_manager", "admin"];
const COACH_ROLES = ["coach", "partner_coach", ...ADMIN_ROLES];

function isCoachish(u) {
  return COACH_ROLES.includes(String((u && u.role) || ""));
}

function ensureColumns(db) {
  quorum.ensureSchema(db);
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    const add = (n, t) => {
      if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run();
    };
    add("cancel_reason", "TEXT");
    add("cancelled_at", "TEXT");
    add("refund_status", "TEXT DEFAULT 'none'");
    add("refund_reason", "TEXT");
    add("refund_reported_at", "TEXT");
    add("cancelled_by_user_id", "TEXT");
    add("attendance_status", "TEXT");
  } catch (e) {}
}

/** 只可以操作自己帶嘅班（管理員可以操作任何班） */
function loadOwnedSchedule(db, user, scheduleId) {
  const sch = db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, s.status AS schedule_status,
              s.min_quorum, s.quorum_status, s.quorum_checked_at, s.enrolled_count, s.max_participants,
              s.coach_override_id,
              c.title, c.venue_name, c.venue_address, c.coach_id, c.min_participants,
              COALESCE(s.coach_override_id, c.coach_id) AS actual_coach_id
         FROM class_schedules s JOIN classes c ON c.id = s.class_id
        WHERE s.id = ?`,
    )
    .get(scheduleId);
  if (!sch) return { error: { status: 404, body: { success: false, error: "找不到此班次" } } };
  const isAdmin = ADMIN_ROLES.includes(String(user.role || ""));
  if (!isAdmin && String(sch.actual_coach_id) !== String(user.id)) {
    return { error: { status: 403, body: { success: false, error: "只可以處理自己帶領嘅班次" } } };
  }
  return { sch, isAdmin };
}

function refundDestination(bk, db) {
  if (bk.pass_id) return { method: "pass", label: "原路退回 Pass 1 堂" };
  if (bk.payment_type === "credits") {
    let credits = 0;
    if (Number(bk.amount) > 0) credits = Math.round((Number(bk.amount) / 10) * 10) / 10;
    else {
      const c = db.prepare("SELECT credits_cost FROM classes WHERE id=?").get(bk.class_id);
      credits = Math.round((Number(c && c.credits_cost) || 0) * 10) / 10;
    }
    return { method: "credits", credits, label: `全額退回 ${credits} Credits` };
  }
  if (bk.payment_status === "paid" && Number(bk.amount) > 0) {
    return { method: "manual_refund_required", label: "FPS 全額退款（客服 1 個工作日內處理）" };
  }
  return { method: "none", label: "無需退款" };
}

function decisionState(sch, enrolled, minQuorum, hoursUntil) {
  const qs = String(sch.quorum_status || "pending");
  if (["cancelled", "completed"].includes(String(sch.status))) return "closed";
  if (qs === "cancelled_by_coach") return "cancelled_by_coach";
  if (qs === "cancelled_low_quorum") return "cancelled_low_quorum";
  if (qs === "coach_will_run") return "coach_will_run";
  if (qs === "confirmed") return "auto_confirmed";
  if (enrolled >= minQuorum) return "enough";
  return hoursUntil <= 36 ? "needs_decision" : "waiting";
}

// ===== GET /api/coach/session-decisions =====
router.get("/", (req, res) => {
  try {
    if (!isCoachish(req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const db = getDb();
    ensureColumns(db);
    const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));

    const rows = db
      .prepare(
        `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, s.min_quorum, s.quorum_status,
                s.enrolled_count, s.max_participants, s.coach_override_id,
                c.title, c.venue_name, c.min_participants,
                COALESCE(s.coach_override_id, c.coach_id) AS actual_coach_id
           FROM class_schedules s JOIN classes c ON c.id = s.class_id
          WHERE s.status NOT IN ('completed')
            AND datetime(s.start_time) >= datetime('now')
            AND datetime(s.start_time) <= datetime('now', '+' || ? || ' days')
            AND (? = 1 OR COALESCE(s.coach_override_id, c.coach_id) = ?)
          ORDER BY datetime(s.start_time) ASC`,
      )
      .all(days, ADMIN_ROLES.includes(String(req.user.role || "")) ? 1 : 0, req.user.id);

    const now = Date.now();
    const out = rows.map((sch) => {
      const bookings = quorum.activeBookings(db, sch.id);
      const enrolled = bookings.length;
      const minQuorum = quorum.resolveMinQuorum(sch);
      const start = quorum.parseUtc(sch.start_time);
      const hoursUntil = start ? Math.round(((start.getTime() - now) / 3600000) * 10) / 10 : null;

      const students = bookings.map((bk) => {
        const dest = refundDestination(bk, db);
        const phone = String(bk.user_phone || "").replace(/\D/g, "");
        return {
          booking_id: bk.id,
          booking_reference: bk.booking_reference,
          name: bk.user_name || "學員",
          phone_last4: phone ? phone.slice(-4) : "",
          payment_type: bk.payment_type,
          payment_status: bk.payment_status,
          refund_method: dest.method,
          refund_label: dest.label,
          credits: dest.credits || 0,
        };
      });

      const preview = {
        credits: students.filter((s) => s.refund_method === "credits").reduce((a, s) => a + Number(s.credits || 0), 0),
        passes: students.filter((s) => s.refund_method === "pass").length,
        cash_count: students.filter((s) => s.refund_method === "manual_refund_required").length,
      };

      return {
        id: sch.id,
        title: sch.title,
        venue_name: sch.venue_name,
        start_time: sch.start_time,
        end_time: sch.end_time,
        status: sch.status,
        quorum_status: sch.quorum_status || "pending",
        min_quorum: minQuorum,
        max_participants: sch.max_participants,
        enrolled,
        shortfall: Math.max(0, minQuorum - enrolled),
        hours_until: hoursUntil,
        decision_state: decisionState(sch, enrolled, minQuorum, hoursUntil),
        refund_preview: preview,
        students,
      };
    });

    const need = out.filter((x) => x.decision_state === "needs_decision").length;
    res.json({ success: true, data: out, summary: { total: out.length, needs_decision: need }, policy: "人數不足取消 → 100% 退款（不扣手續費）" });
  } catch (e) {
    console.error("[SESSION-DECISION] list:", e.message);
    res.status(500).json({ success: false, error: "讀取開班決定失敗" });
  }
});

// ===== POST /api/coach/session-decisions/:id/run — 照常開班 =====
router.post("/:id/run", (req, res) => {
  try {
    if (!isCoachish(req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const db = getDb();
    ensureColumns(db);
    const { sch, error } = loadOwnedSchedule(db, req.user, req.params.id);
    if (error) return res.status(error.status).json(error.body);
    if (["cancelled", "completed"].includes(String(sch.status)))
      return res.status(409).json({ success: false, error: "此班次已取消或已完結" });
    if (String(sch.quorum_status) === "coach_will_run")
      return res.json({ success: true, already: true, quorum_status: "coach_will_run" });

    const bookings = quorum.activeBookings(db, sch.id);
    const minQuorum = quorum.resolveMinQuorum(sch);

    db.prepare(
      "UPDATE class_schedules SET quorum_status='coach_will_run', quorum_checked_at=datetime('now') WHERE id=?",
    ).run(sch.id);

    audit({
      actionType: "schedule.coach_will_run",
      entityType: "class_schedule",
      entityId: sch.id,
      userId: req.user.id,
      newValues: { enrolled: bookings.length, min_quorum: minQuorum, note: String((req.body || {}).note || "").slice(0, 200) },
      description: `教練決定照常開班：${sch.title}（${bookings.length}/${minQuorum} 人）`,
    });

    res.json({ success: true, quorum_status: "coach_will_run", enrolled: bookings.length, min_quorum: minQuorum });
  } catch (e) {
    console.error("[SESSION-DECISION] run:", e.message);
    res.status(500).json({ success: false, error: "無法更新開班決定" });
  }
});

// ===== POST /api/coach/session-decisions/:id/cancel — 取消並 100% 退款 =====
router.post("/:id/cancel", (req, res) => {
  try {
    if (!isCoachish(req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const body = req.body || {};
    const reason = String(body.reason || "").trim();
    if (body.confirmed !== true) return res.status(400).json({ success: false, error: "請確認取消（confirmed=true）" });
    if (reason.length < 4) return res.status(400).json({ success: false, error: "請填寫取消原因（至少 4 字）" });

    const db = getDb();
    ensureColumns(db);
    const { sch, error } = loadOwnedSchedule(db, req.user, req.params.id);
    if (error) return res.status(error.status).json(error.body);
    if (["cancelled", "completed"].includes(String(sch.status)))
      return res.status(409).json({ success: false, error: "此班次已取消或已完結，無需重複處理" });

    const bookings = quorum.activeBookings(db, sch.id);
    const minQuorum = quorum.resolveMinQuorum(sch);
    const enrolled = bookings.length;

    const run = db.transaction(() => {
      db.prepare(
        "UPDATE class_schedules SET status='cancelled', quorum_status='cancelled_by_coach', quorum_checked_at=datetime('now') WHERE id=?",
      ).run(sch.id);

      const results = [];
      for (const bk of bookings) {
        db.prepare(
          `UPDATE bookings SET status='cancelled', cancel_reason='coach_cancelled_full_refund',
                  cancelled_at=datetime('now'), cancelled_by_user_id=?
            WHERE id=? AND status='confirmed'`,
        ).run(req.user.id, bk.id);
        const refund = quorum.refundBooking(db, bk);
        if (refund.method === "manual_refund_required") {
          // 現金（FPS／信用卡）→ 交人手退款隊列，標記 100% 全退
          db.prepare(
            `UPDATE bookings SET refund_status='requested', refund_reason='人數不足取消 · 100% 全額退款',
                    refund_reported_at=datetime('now') WHERE id=?`,
          ).run(bk.id);
        }
        results.push({ booking: bk, refund });
      }

      db.prepare("UPDATE class_schedules SET enrolled_count=0 WHERE id=?").run(sch.id);

      audit({
        actionType: "schedule.coach_cancelled_full_refund",
        entityType: "class_schedule",
        entityId: sch.id,
        userId: req.user.id,
        newValues: {
          reason,
          policy: "low_quorum_full_refund_100pct",
          enrolled,
          min_quorum: minQuorum,
          refunds: results.map((r) => ({ booking_id: r.booking.id, method: r.refund.method, credits: r.refund.credits })),
        },
        description: `教練取消班次並 100% 退款：${sch.title}（${enrolled}/${minQuorum} 人）`,
      });

      return results;
    });

    const results = run();

    // 通知（同一 quorum 通知隊列，會有 WhatsApp 發送器處理）
    const messages = [];
    for (const { booking: bk, refund } of results) {
      const text = require("../services/quorum-worker").textForCancelled({
        sch,
        bk,
        enrolled,
        minQuorum,
        refund,
      });
      quorum.enqueue(db, {
        scheduleId: sch.id,
        bookingId: bk.id,
        userId: bk.user_id,
        phone: bk.user_phone,
        type: "coach_cancelled_refund",
        message: text,
      });
      messages.push({ name: bk.user_name || "學員", phone: bk.user_phone || "", text });
    }

    const manual = results.filter((r) => r.refund.method === "manual_refund_required");
    if (manual.length) {
      try {
        require("../services/notify-admins").notifyAdmins("coach_cancel_manual_refund", {
          schedule_id: sch.id,
          title: sch.title,
          count: manual.length,
          booking_ids: manual.map((r) => r.booking.id),
        });
      } catch (e) {}
    }

    res.json({
      success: true,
      schedule_id: sch.id,
      cancelled_bookings: results.length,
      refunds: results.map((r) => ({
        booking_id: r.booking.id,
        booking_reference: r.booking.booking_reference,
        name: r.booking.user_name,
        method: r.refund.method,
        credits: r.refund.credits || 0,
      })),
      manual_refund_count: manual.length,
      policy: "人數不足取消 → 100% 退款",
      messages,
    });
  } catch (e) {
    console.error("[SESSION-DECISION] cancel:", e.message);
    res.status(500).json({ success: false, error: "取消／退款失敗，請稍後再試" });
  }
});

module.exports = router;
