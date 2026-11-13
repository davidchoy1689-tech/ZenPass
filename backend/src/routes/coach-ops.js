/**
 * Phase 6.3：教練作業閉環（安全子集）
 *
 *   GET  /api/coach/ops/demo-roster            公開、唯讀示範名單（?schedule_id 可選）
 *   POST /api/coach/ops/schedules/:id/start    教練開始課堂（session_state → in_progress）
 *   POST /api/coach/ops/disputes               課後漏簽補登工單（唔會即時改錢）
 *
 * 刻意未做（要 David 明確批准）：
 *   - 未達最低成團自動取消 + 自動退堂（涉及金錢；現有 quorum-worker 已有類似能力，避免雙重退款）
 *   - 拆帳比例改 85%（現時 platform_settings.coach_commission_rate = 0.8，改動即影響所有教練收入）
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");
const { audit } = require("../services/audit");

/* ---------------- 示範名單（公開、唯讀） ---------------- */
router.get("/demo-roster", (req, res) => {
  res.json({
    ok: true,
    is_demo: true,
    note: "示範資料，唔會讀取或修改任何真實預約",
    schedule: {
      id: "demo_molkky_01",
      title: "芬蘭木柱體驗班（觀塘・示範）",
      start_time: "2026-11-14T02:30:00.000Z", // = 11/14 10:30 HKT
      end_time: "2026-11-14T04:00:00.000Z",
      max_participants: 8,
      min_threshold: 4,
      enrolled_count: 6,
      session_state: "scheduled",
      venue_name: "新興運動推廣社",
      custom_venue_address: "觀塘興業街 14 號永興工業大廈 5 樓",
      custom_transit_guide: "港鐵觀塘站 B2 出口步行 4 分鐘",
    },
    roster: [
      { booking_id: "demo1", name: "陳大文（父親）", phone_last4: "5432", badge: "👨‍👩‍👧 家庭 Pass · 餘 4 堂", is_guest: false, payment_status: "paid", attendance_status: "pending" },
      { booking_id: "demo2", name: "林嘉欣（訪客）", phone_last4: "8821", badge: "⚡ 免註冊單堂", is_guest: true, payment_status: "paid", attendance_status: "pending" },
      { booking_id: "demo3", name: "黃美儀", phone_last4: "6610", badge: "🎫 4 堂卡 · 餘 2 堂", is_guest: false, payment_status: "paid", attendance_status: "present" },
    ],
  });
});

/* ---------------- 以下需要登入 ---------------- */
router.use(authenticateToken);

function ownSchedule(db, user, sid) {
  const row = db
    .prepare("SELECT cs.id, cs.coach_id, cs.coach_override_id, cs.status FROM class_schedules cs WHERE cs.id = ?")
    .get(sid);
  if (!row) return null;
  const me = db.prepare("SELECT role FROM users WHERE id=?").get(user.id);
  const isCoach = row.coach_id === user.id || row.coach_override_id === user.id;
  if (!(me && hasMinimumRole(me.role, "admin")) && !isCoach) return null;
  return row;
}

router.post("/schedules/:id/start", (req, res) => {
  try {
    const db = getDb();
    const sched = ownSchedule(db, req.user, req.params.id);
    if (!sched) return res.status(404).json({ ok: false, error: "找不到班次或無權限" });
    if (sched.status === "cancelled") return res.status(409).json({ ok: false, error: "班次已取消" });
    db.prepare(
      `UPDATE class_schedules
          SET session_state = 'in_progress', started_at = COALESCE(started_at, datetime('now'))
        WHERE id = ?`,
    ).run(sched.id);
    try {
      audit({
        actionType: "coach.session_started",
        entityType: "class_schedule",
        entityId: sched.id,
        userId: req.user.id,
        newValues: { session_state: "in_progress" },
        description: "教練開始課堂",
      });
    } catch (e) {}
    return res.json({ ok: true, session_state: "in_progress" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "START_FAILED", message: e.message });
  }
});

router.post("/disputes", (req, res) => {
  try {
    const db = getDb();
    const { schedule_id, booking_id, reason } = req.body || {};
    if (!schedule_id || !booking_id || !String(reason || "").trim()) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "請提供班次、預約與原因" });
    }
    const sched = ownSchedule(db, req.user, schedule_id);
    if (!sched) return res.status(404).json({ ok: false, error: "找不到班次或無權限" });

    const bk = db.prepare("SELECT id, schedule_id, user_id FROM bookings WHERE id = ?").get(booking_id);
    if (!bk || bk.schedule_id !== schedule_id) {
      return res.status(404).json({ ok: false, error: "BOOKING_NOT_IN_SCHEDULE" });
    }
    const dup = db
      .prepare("SELECT id FROM coach_reconciliation_disputes WHERE booking_id = ? AND status = 'open'")
      .get(booking_id);
    if (dup) return res.status(409).json({ ok: false, error: "DUPLICATE", message: "已有一張待處理工單" });

    const id = "disp_" + crypto.randomBytes(6).toString("hex");
    db.prepare(
      `INSERT INTO coach_reconciliation_disputes (id, schedule_id, booking_id, coach_id, reason)
       VALUES (?,?,?,?,?)`,
    ).run(id, schedule_id, booking_id, req.user.id, String(reason).trim().slice(0, 500));

    try {
      audit({
        actionType: "coach.dispute_opened",
        entityType: "booking",
        entityId: booking_id,
        userId: req.user.id,
        newValues: { dispute_id: id, reason: String(reason).slice(0, 120) },
        description: "課後漏簽補登工單",
      });
    } catch (e) {}

    return res.status(201).json({
      ok: true,
      dispute_id: id,
      message: "已提交，營運團隊會人手核實（唔會自動補錢）",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "DISPUTE_FAILED", message: e.message });
  }
});

module.exports = router;
