/**
 * 教練點名冊（工單一）— 出席狀態機
 *  GET  /api/coach/sessions/:sid/roster
 *  POST /api/coach/attendance/batch  { session_id, records:[{booking_id,status,notes}] }
 *
 * status: present | absent_notified | absent_unexcused | late
 * - attendances 表存狀態同審計；bookings 同步（present/late → attended；absent_unexcused → no_show）
 * - absent_notified（合規請假）如用通行卡，自動退回 1 堂
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { writeBlock } = require("../services/blockchain-audit");
const passes = require("../services/passes");
const referralRewards = require("../services/referral-rewards");
const coachAffiliate = require("../services/coach-affiliate");

const router = express.Router();
router.use(authenticateToken);

const STATUSES = ["present", "absent_notified", "absent_unexcused", "late"];

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendances (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent_notified','absent_unexcused','late')),
      checkin_time TEXT,
      notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_booking ON attendances(booking_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendances(session_id);
  `);
  // 舊 DB 兼容欄位（點名冊需要）
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    [
      ["attendee_type", "TEXT DEFAULT 'self'"],
      ["child_name", "TEXT"],
      ["parent_name", "TEXT"],
      ["parent_phone", "TEXT"],
      ["medical_notes", "TEXT"],
      ["group_size", "INTEGER DEFAULT 1"],
    ].forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) {}
}

function ownSchedule(db, user, sid) {
  const row = db
    .prepare(
      `SELECT cs.*, c.title, c.coach_id, c.venue_name, c.venue_address
       FROM class_schedules cs JOIN classes c ON c.id = cs.class_id WHERE cs.id = ?`,
    )
    .get(sid);
  if (!row) return null;
  const me = db.prepare("SELECT role FROM users WHERE id=?").get(user.id);
  const isTeacher = row.coach_id === user.id || row.coach_override_id === user.id;
  if (!(me && hasMinimumRole(me.role, "admin")) && !isTeacher) return null;
  return row;
}

router.get("/sessions/:sid/roster", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const sched = ownSchedule(db, req.user, req.params.sid);
    if (!sched) return res.status(404).json({ success: false, error: "找不到班次或無權限" });
    const actualCoachId = sched.coach_override_id || sched.coach_id;
    try { coachAffiliate.ensureSchema(db); } catch (e) {}

    const rows = db
      .prepare(
        `SELECT b.id AS booking_id, b.user_id, b.status AS booking_status, b.payment_status,
                b.attendee_type, b.child_name, b.parent_name, b.parent_phone, b.medical_notes,
                b.group_size, b.pass_id,
                u.name, u.phone, u.emergency_name, u.emergency_phone,
                a.id AS attendance_id, a.status AS attendance_status, a.checkin_time, a.notes,
                p.remaining_credits, p.total_credits, p.expires_at,
                f.origin_coach_id
           FROM bookings b
           JOIN users u ON u.id = b.user_id
           LEFT JOIN attendances a ON a.booking_id = b.id
           LEFT JOIN user_passes p ON p.id = b.pass_id
           LEFT JOIN student_coach_affiliations f ON f.student_user_id = b.user_id AND f.status='active'
          WHERE b.schedule_id = ? AND b.status IN ('confirmed','attended','no_show')
          ORDER BY u.name`,
      )
      .all(req.params.sid);

    // 匯入時填寫嘅舊患備註（同一教練、同一電話）
    const notesByPhone = new Map();
    try {
      const hasInvites = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='student_onboarding_invites'")
        .get();
      if (hasInvites) {
        for (const n of db
          .prepare(
            "SELECT phone, notes FROM student_onboarding_invites WHERE coach_id=? AND COALESCE(notes,'')<>'' ORDER BY datetime(created_at) DESC",
          )
          .all(actualCoachId)) {
          if (!notesByPhone.has(n.phone)) notesByPhone.set(n.phone, n.notes);
        }
      }
    } catch (e) {}

    const roster = rows.map((r) => {
      const derived =
        r.attendance_status ||
        (r.booking_status === "attended" ? "present" : r.booking_status === "no_show" ? "absent_unexcused" : null);
      const isOwn = !!r.origin_coach_id && r.origin_coach_id === actualCoachId;
      return {
        booking_id: r.booking_id,
        user_id: r.user_id,
        student_name: r.attendee_type === "child" ? r.child_name || r.name : r.name,
        name: r.name,
        phone: r.attendee_type === "parent" ? r.parent_phone : r.phone,
        phone_masked: r.phone ? String(r.phone).replace(/^(\d{4})\d{4}$/, "$1****") : "",
        emergency_name: r.emergency_name,
        emergency_phone: r.emergency_phone,
        medical_notes: r.medical_notes,
        health_notes: r.medical_notes || notesByPhone.get(r.phone) || "",
        is_own_student: isOwn,
        origin_coach_id: r.origin_coach_id || null,
        group_size: Number(r.group_size) || 1,
        booking_status: r.booking_status,
        payment_status: r.payment_status,
        pass_id: r.pass_id || null,
        pass_remaining: r.remaining_credits == null ? null : Number(r.remaining_credits),
        pass_total: r.total_credits == null ? null : Number(r.total_credits),
        status: derived,
        checkin_time: r.checkin_time,
        notes: r.notes || "",
      };
    });

    res.json({
      success: true,
      schedule: {
        id: sched.id,
        title: sched.title,
        venue_name: sched.venue_name,
        venue_address: sched.venue_address,
        start_time: sched.start_time,
        end_time: sched.end_time,
        max_participants: sched.max_participants,
        enrolled_count: sched.enrolled_count,
      },
      roster,
      counts: {
        total: roster.length,
        present: roster.filter((x) => x.status === "present" || x.status === "late").length,
        excused: roster.filter((x) => x.status === "absent_notified").length,
        absent: roster.filter((x) => x.status === "absent_unexcused").length,
        own_students: roster.filter((x) => x.is_own_student).length,
        platform_students: roster.filter((x) => !x.is_own_student).length,
      },
    });
  } catch (e) {
    console.error("[ROSTER] get:", e.message);
    res.status(500).json({ success: false, error: "讀取名冊失敗" });
  }
});

router.post("/attendance/batch", (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const session_id = (req.body || {}).session_id || (req.body || {}).sessionId;
    const records = (req.body || {}).records;
    if (!session_id || !Array.isArray(records) || !records.length) {
      return res.status(400).json({ success: false, error: "缺少 session_id 或 records" });
    }
    const sched = ownSchedule(db, req.user, session_id);
    if (!sched) return res.status(404).json({ success: false, error: "找不到班次或無權限" });
    let hbReady = false;
    try {
      require("./handbook-p1").ensureHandbookSchema(db);
      hbReady = true;
    } catch (e) {}
    const actualCoachId = sched.coach_override_id || sched.coach_id;

    const getBooking = db.prepare("SELECT * FROM bookings WHERE id=? AND schedule_id=?");
    const getAtt = db.prepare("SELECT * FROM attendances WHERE booking_id=?");
    const insAtt = db.prepare(
      `INSERT INTO attendances (id, session_id, booking_id, student_name, status, checkin_time, notes, updated_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    const updAtt = db.prepare(
      `UPDATE attendances SET status=?, checkin_time=?, notes=?, updated_by=?, updated_at=datetime('now') WHERE booking_id=?`,
    );

    const results = [];
    const run = db.transaction(() => {
      for (const rec of records) {
        const bid = rec && (rec.booking_id || rec.bookingId);
        const status = String((rec && rec.status) || "");
        if (!STATUSES.includes(status)) throw Object.assign(new Error(`狀態無效：${status}`), { code: "BAD_STATUS" });
        const b = getBooking.get(bid, session_id);
        if (!b) throw Object.assign(new Error("學員不在此班"), { code: "NOT_IN_CLASS" });
        const existing = getAtt.get(b.id);
        const now = new Date().toISOString();
        const checkin = status === "present" || status === "late" ? now : null;
        const name = b.attendee_type === "child" ? b.child_name || "" : "";

        if (existing) updAtt.run(status, checkin, rec.notes || "", req.user.id, b.id);
        else insAtt.run(uuidv4(), session_id, b.id, name || "學員", status, checkin, rec.notes || "", req.user.id);

        // 同步 bookings（唯一真相仍然係 booking status）
        if (status === "present" || status === "late") {
          db.prepare(
            "UPDATE bookings SET status='attended', checked_in_at=COALESCE(checked_in_at, datetime('now')), checkin_method='roster' WHERE id=?",
          ).run(b.id);
        } else if (status === "absent_unexcused") {
          db.prepare("UPDATE bookings SET status='no_show', cancel_reason='coach_roster_no_show' WHERE id=?").run(b.id);
        }
        // absent_notified：保留 booking 狀態（唔計出席，亦唔當 no-show 扣堂）

        // 手冊動態更新：出席＋有備註 → 自動新增一則手冊紀錄（同一 booking 只一次）
        const noteText = String((rec && rec.notes) || "").trim();
        if (hbReady && (status === "present" || status === "late") && noteText.length >= 2 && b.user_id) {
          const seen = db.prepare("SELECT id FROM student_handbooks WHERE booking_id=?").get(b.id);
          if (!seen) {
            const stu = db.prepare("SELECT name FROM users WHERE id=?").get(b.user_id);
            const stuName =
              b.attendee_type === "child"
                ? b.child_name || (stu && stu.name) || "學員"
                : (stu && stu.name) || "學員";
            const tags = [];
            if (/膝|關節|手術/.test(noteText)) tags.push("關節活動度");
            if (/血壓|心臟|氣管|氣喘/.test(noteText)) tags.push("身體狀況");
            if (/動作|完成度|姿勢/.test(noteText)) tags.push("動作完成度");
            const logDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" });
            db.prepare(
              `INSERT INTO student_handbooks
                 (id, student_id, student_name, booking_id, session_id, coach_id, log_date, tags_json, comment, allow_reply)
               VALUES (?,?,?,?,?,?,?,?,?,1)`,
            ).run(
              uuidv4(),
              b.user_id,
              stuName,
              b.id,
              session_id,
              actualCoachId,
              logDate,
              JSON.stringify(tags),
              noteText.slice(0, 500),
            );
          }
        }

        // 推薦獎賞：被推薦人「生涯首次出席」先觸發（同一 transaction 內派堂）
        let referral_reward = null;
        if ((status === "present" || status === "late") && b.user_id) {
          referral_reward = referralRewards.onAttendance(db, { userId: b.user_id, bookingId: b.id });
        }

        // 合規請假：如用通行卡，退 1 堂（只退一次，restoreInTx 有防重）
        let pass_restored = false;
        if (status === "absent_notified" && b.pass_id) {
          pass_restored = passes.restoreInTx(db, { passId: b.pass_id, bookingId: b.id });
        }

        results.push({ booking_id: b.id, status, pass_restored, referral_reward });
      }
    });
    run();

    // 工單十六：點名 present 後結算私域補足／跨界 5%（冪等，重覆唔會再派）
    let affiliate_result = null;
    try {
      affiliate_result = require("../services/coach-affiliate").settleSchedule(session_id);
    } catch (e) {
      console.error("[ROSTER] affiliate settle:", e.message);
    }

    const block = writeBlock({
      entityType: "attendance_roster",
      entityId: session_id,
      data: { session_id, coach_id: req.user.id, at: new Date().toISOString(), records: results },
    });
    audit({
      actionType: "attendance.roster_batch",
      entityType: "class_schedule",
      entityId: session_id,
      userId: req.user.id,
      newValues: { count: results.length, records: results, block_hash: block.hash || null },
      description: `教練點名冊更新 ${results.length} 人（${sched.title}）`,
    });

    res.json({ success: true, updated: results.length, results, block_hash: block.hash || null, affiliate_result });
  } catch (e) {
    console.error("[ROSTER] batch:", e.message);
    if (e && e.code) return res.status(400).json({ success: false, code: e.code, error: e.message });
    res.status(500).json({ success: false, error: "更新點名失敗" });
  }
});

module.exports = router;
