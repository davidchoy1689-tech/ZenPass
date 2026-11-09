/**
 * 工單十一 — 學員自助改期（開課前 ≥24h）
 * POST /api/student/bookings/:id/reschedule  { new_session_id }
 * 只限本人；同一課程；新班有位；單一 transaction 轉移名額。
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");

const router = express.Router();

function ensureCol(db) {
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  if (!cols.includes("rescheduled_at")) db.exec("ALTER TABLE bookings ADD COLUMN rescheduled_at TEXT");
}

router.post("/bookings/:id/reschedule", authenticateToken, (req, res) => {
  const db = getDb();
  try {
    ensureCol(db);
    const bookingId = String(req.params.id);
    const newSessionId = String((req.body && req.body.new_session_id) || "");
    if (!newSessionId) return res.status(400).json({ success: false, error: "請選擇新時段" });

    const b = db
      .prepare(
        `SELECT b.id, b.user_id, b.class_id, b.schedule_id, b.status, b.payment_status,
                s.start_time AS old_start
           FROM bookings b JOIN class_schedules s ON s.id = b.schedule_id
          WHERE b.id = ?`,
      )
      .get(bookingId);
    if (!b) return res.status(404).json({ success: false, error: "找不到預約" });
    const isAdmin = ["super_admin", "platform_manager", "admin"].includes(req.user.role);
    if (b.user_id !== req.user.id && !isAdmin) return res.status(403).json({ success: false, error: "只可改自己嘅預約" });
    if (b.status !== "confirmed") return res.status(400).json({ success: false, error: "只有確認中嘅預約可以改期" });
    if (String(b.schedule_id) === newSessionId) return res.status(400).json({ success: false, error: "已係同一時段" });

    const HOUR = 3600e3;
    const oldStart = new Date(String(b.old_start).replace(" ", "T")).getTime();
    if (!(oldStart - Date.now() >= 24 * HOUR)) {
      return res.status(400).json({ success: false, error: "開課前 24 小時內不可自主改期，請聯絡客服" });
    }

    const target = db
      .prepare(
        `SELECT s.id, s.class_id, s.start_time, s.max_participants, s.enrolled_count, COALESCE(s.status,'available') st
           FROM class_schedules s WHERE s.id = ?`,
      )
      .get(newSessionId);
    if (!target) return res.status(404).json({ success: false, error: "找不到新時段" });
    if (String(target.class_id) !== String(b.class_id)) return res.status(400).json({ success: false, error: "只可改同一課程嘅時段" });
    if (target.st === "cancelled") return res.status(400).json({ success: false, error: "該時段已取消" });
    const newStart = new Date(String(target.start_time).replace(" ", "T")).getTime();
    if (!(newStart > Date.now())) return res.status(400).json({ success: false, error: "不可改到已開始或過去嘅時段" });
    if (Number(target.enrolled_count || 0) >= Number(target.max_participants || 0)) {
      return res.status(409).json({ success: false, error: "該時段已滿" });
    }

    const tx = db.transaction(() => {
      const dec = db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, COALESCE(enrolled_count,0) - 1) WHERE id = ?").run(b.schedule_id);
      if (!dec.changes) throw new Error("舊班次更新失敗");
      const inc = db.prepare(
        "UPDATE class_schedules SET enrolled_count = COALESCE(enrolled_count,0) + 1 WHERE id = ? AND COALESCE(enrolled_count,0) < max_participants",
      ).run(newSessionId);
      if (!inc.changes) throw new Error("新班次已滿");
      const upd = db.prepare("UPDATE bookings SET schedule_id = ?, rescheduled_at = datetime('now') WHERE id = ? AND schedule_id = ?").run(newSessionId, bookingId, b.schedule_id);
      if (!upd.changes) throw new Error("預約更新失敗");
    });
    tx();

    audit({
      actionType: "booking.rescheduled",
      entityType: "booking",
      entityId: bookingId,
      userId: req.user.id,
      oldValues: { schedule_id: b.schedule_id, start_time: b.old_start },
      newValues: { schedule_id: newSessionId, start_time: target.start_time },
      description: "學員自助改期",
    });

    res.json({ success: true, booking_id: bookingId, new_session_id: newSessionId, start_time: target.start_time });
  } catch (e) {
    console.error("[RESCHEDULE]", e.message);
    res.status(409).json({ success: false, error: e.message || "改期失敗" });
  }
});

module.exports = router;
