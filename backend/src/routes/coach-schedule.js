/**
 * 教練更表（工單二）— 日／週／月視圖資料、鎖時段、代堂申請
 *  GET  /api/coach/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  POST /api/coach/schedules/lock-slot   { start_time, end_time, reason }
 *  POST /api/coach/schedules/substitute  { session_id, target_coach_id, reason }
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { dbNotification } = require("../services/notification");

const router = express.Router();
router.use(authenticateToken);

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_unavailability (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_unavail_coach ON coach_unavailability(coach_id, start_time);
    CREATE TABLE IF NOT EXISTS coach_substitution_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_coach_id TEXT NOT NULL,
      target_coach_id TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by TEXT
    );
  `);
}

const parse = (s) => new Date(String(s || "").replace(" ", "T"));

router.get("/schedule", (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    const rows = db
      .prepare(
        `SELECT s.id, s.start_time, s.end_time, s.status, s.enrolled_count, s.max_participants, s.coach_override_id,
                c.id AS class_id, c.title, c.venue_name, c.venue_address, c.price_hkd,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status IN ('confirmed','attended')) AS booked,
                (SELECT r.status FROM coach_substitution_requests r WHERE r.session_id=s.id ORDER BY r.created_at DESC LIMIT 1) AS sub_status
           FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE COALESCE(s.coach_override_id, c.coach_id)=? AND COALESCE(c.status,'active')<>'deleted'
          ORDER BY s.start_time`,
      )
      .all(req.user.id);
    let sessions = rows.map((r) => ({
      ...r,
      booked: Number(r.booked) || 0,
      start_ms: parse(r.start_time).getTime(),
    }));
    if (from) sessions = sessions.filter((s) => s.start_time.slice(0, 10) >= from);
    if (to) sessions = sessions.filter((s) => s.start_time.slice(0, 10) <= to);

    const locks = db
      .prepare("SELECT * FROM coach_unavailability WHERE coach_id=? ORDER BY start_time")
      .all(req.user.id);
    const subs = db
      .prepare("SELECT * FROM coach_substitution_requests WHERE from_coach_id=? ORDER BY created_at DESC")
      .all(req.user.id);
    res.json({ success: true, sessions, locks, substitutions: subs });
  } catch (e) {
    console.error("[SCHEDULE] get:", e.message);
    res.status(500).json({ success: false, error: "讀取更表失敗" });
  }
});

router.post("/schedules/lock-slot", (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const { start_time, end_time, reason } = req.body || {};
    const s = parse(start_time), e = parse(end_time);
    if (isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ success: false, error: "時間範圍無效" });
    const id = uuidv4();
    db.prepare(
      "INSERT INTO coach_unavailability (id, coach_id, start_time, end_time, reason) VALUES (?,?,?,?,?)",
    ).run(id, req.user.id, start_time, end_time, String(reason || "").slice(0, 200));
    audit({
      actionType: "coach.slot_locked",
      entityType: "coach",
      entityId: req.user.id,
      userId: req.user.id,
      newValues: { start_time, end_time, reason: reason || "" },
      description: "教練鎖定私人時段",
    });
    res.json({ success: true, lock_id: id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/schedules/substitute", (req, res) => {
  try {
    const db = getDb();
    ensureTables(db);
    const { session_id, target_coach_id, reason } = req.body || {};
    const s = db
      .prepare(
        "SELECT s.id, c.coach_id, c.title FROM class_schedules s JOIN classes c ON c.id=s.class_id WHERE s.id=?",
      )
      .get(session_id);
    if (!s || s.coach_id !== req.user.id) return res.status(404).json({ success: false, error: "找不到班次" });
    const target = db.prepare("SELECT id, name, role FROM users WHERE id=?").get(target_coach_id);
    if (!target || !["coach", "admin", "platform_manager", "super_admin"].some((r) => hasMinimumRole(target.role, r))) {
      return res.status(400).json({ success: false, error: "目標教練無效" });
    }
    const id = uuidv4();
    db.prepare(
      "INSERT INTO coach_substitution_requests (id, session_id, from_coach_id, target_coach_id, reason) VALUES (?,?,?,?,?)",
    ).run(id, session_id, req.user.id, target_coach_id, String(reason || "").slice(0, 300));
    audit({
      actionType: "coach.substitute_requested",
      entityType: "class_schedule",
      entityId: session_id,
      userId: req.user.id,
      newValues: { target_coach_id, reason: reason || "" },
      description: `代堂申請（${s.title}）`,
    });
    res.json({ success: true, request_id: id, status: "pending" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
