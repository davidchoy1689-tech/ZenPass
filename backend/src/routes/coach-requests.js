/**
 * 教練改期／取消申請（2026-11-16）
 * 教練唔可以直接取消有學生嘅班；改為提交申請，由營運審批。
 *
 *  POST /api/coach/change-requests            教練提交（cancel_session | reschedule）
 *  GET  /api/coach/change-requests            教練查看自己申請
 *  GET  /api/admin/coach-change-requests      營運查看（?status=pending|approved|rejected|all）
 *  POST /api/admin/coach-change-requests/:id/approve
 *  POST /api/admin/coach-change-requests/:id/reject
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");

const router = express.Router();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_change_requests (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('cancel_session','reschedule')),
      schedule_id TEXT NOT NULL,
      booking_id TEXT,
      preferred_time TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      admin_note TEXT,
      result TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ccr_status ON coach_change_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ccr_coach ON coach_change_requests(coach_id, created_at);
  `);
}

function ownsSchedule(db, coachId, scheduleId) {
  return db
    .prepare(
      `SELECT s.id, s.class_id, s.start_time, s.end_time, s.status, c.title, c.coach_id,
              COALESCE(s.coach_override_id, c.coach_id) AS actual_coach_id,
              (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status='confirmed') AS booked
         FROM class_schedules s JOIN classes c ON c.id=s.class_id
        WHERE s.id=?`,
    )
    .get(scheduleId);
}

/* ---------- 教練 ---------- */
router.post("/coach/change-requests", authenticateToken, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = req.body || {};
    const type = String(b.type || "");
    if (!["cancel_session", "reschedule"].includes(type)) {
      return res.status(400).json({ success: false, error: "申請類型無效" });
    }
    const reason = String(b.reason || "").trim().slice(0, 200);
    if (reason.length < 4) return res.status(400).json({ success: false, error: "請填寫原因（最少 4 字）" });

    const s = ownsSchedule(db, req.user.id, String(b.schedule_id || ""));
    if (!s) return res.status(404).json({ success: false, error: "找不到班次" });
    if (String(s.actual_coach_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: "只限該堂教練申請" });
    }
    if (s.status === "cancelled") return res.status(409).json({ success: false, error: "班次已取消" });
    if (new Date(String(s.start_time).replace(" ", "T") + "Z") < new Date()) {
      return res.status(409).json({ success: false, error: "課堂已開始，請直接聯絡營運" });
    }

    const dup = db
      .prepare("SELECT id FROM coach_change_requests WHERE coach_id=? AND schedule_id=? AND status='pending' LIMIT 1")
      .get(req.user.id, s.id);
    if (dup) return res.status(409).json({ success: false, error: "已有待處理申請", code: "DUPLICATE" });

    const id = "ccr_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO coach_change_requests (id, coach_id, type, schedule_id, booking_id, preferred_time, reason)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      id,
      req.user.id,
      type,
      s.id,
      b.booking_id ? String(b.booking_id) : null,
      b.preferred_time ? String(b.preferred_time).slice(0, 60) : null,
      reason,
    );

    try {
      const { audit } = require("../services/audit");
      audit({
        actionType: "coach.change_requested",
        entityType: "class_schedule",
        entityId: s.id,
        userId: req.user.id,
        newValues: { type, reason },
        description: `教練提交${type === "cancel_session" ? "取消" : "改期"}申請：${s.title}`,
      });
    } catch (e) {}

    res.status(201).json({ success: true, id });
  } catch (e) {
    console.error("[COACH-REQ] create:", e.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

router.get("/coach/change-requests", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT r.*, c.title, s.start_time
           FROM coach_change_requests r
           JOIN class_schedules s ON s.id=r.schedule_id
           JOIN classes c ON c.id=s.class_id
          WHERE r.coach_id=? ORDER BY r.created_at DESC LIMIT 50`,
      )
      .all(req.user.id);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, requests: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

/* ---------- 營運 ---------- */
const canReview = requirePermission("ops.booking.write");

router.get("/admin/coach-change-requests", authenticateToken, canReview, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const status = ["pending", "approved", "rejected", "all"].includes(String(req.query.status))
      ? String(req.query.status)
      : "pending";
    const where = status === "all" ? "" : "WHERE r.status=?";
    const params = status === "all" ? [] : [status];
    const rows = db
      .prepare(
        `SELECT r.*, u.name AS coach_name, c.title, s.start_time, s.end_time, s.enrolled_count,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status='confirmed') AS booked
           FROM coach_change_requests r
           JOIN users u ON u.id=r.coach_id
           JOIN class_schedules s ON s.id=r.schedule_id
           JOIN classes c ON c.id=s.class_id
           ${where}
          ORDER BY datetime(r.created_at) DESC LIMIT 100`,
      )
      .all(...params);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, requests: rows });
  } catch (e) {
    console.error("[ADMIN-REQ] list:", e.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/admin/coach-change-requests/:id/approve", authenticateToken, canReview, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const r = db.prepare("SELECT * FROM coach_change_requests WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: "申請不存在" });
    if (r.status !== "pending") return res.status(409).json({ success: false, error: "已處理" });

    const note = String((req.body || {}).note || "").slice(0, 200);
    let result = "已批准";

    if (r.type === "cancel_session") {
      // 重用後台人手取消（會退款＋通知＋審計）
      const ops = require("./admin-ops");
      const layer = ops.stack.find((x) => x.route && x.route.path === "/schedules/:id/manual-cancel" && x.route.methods.post);
      const handler = layer && layer.route.stack[layer.route.stack.length - 1].handle;
      if (!handler) return res.status(500).json({ success: false, error: "取消服務未就緒" });

      const out = { code: null, body: null };
      const fakeRes = {
        status(c) { out.code = c; return this; },
        json(o) { out.body = o; return this; },
      };
      handler(
        {
          user: req.user,
          params: { id: r.schedule_id },
          body: { reason: `教練申請：${r.reason}`, notify_type: "emergency", confirmed: true },
          headers: {}, ip: req.ip,
        },
        fakeRes,
      );
      if (out.code && out.code >= 400) {
        return res.status(out.code).json(out.body || { success: false, error: "取消失敗" });
      }
      result = "已取消班次併發退款";
    } else {
      result = "已批准（請到後台替學員改期）";
    }

    db.prepare(
      "UPDATE coach_change_requests SET status='approved', admin_note=?, result=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
    ).run(note || null, result, req.user.id, r.id);

    try {
      const { audit } = require("../services/audit");
      audit({
        actionType: "coach.change_approved",
        entityType: "class_schedule",
        entityId: r.schedule_id,
        userId: req.user.id,
        newValues: { request_id: r.id, type: r.type, result },
        description: `批准教練${r.type === "cancel_session" ? "取消" : "改期"}申請`,
      });
    } catch (e) {}

    res.json({ success: true, result });
  } catch (e) {
    console.error("[ADMIN-REQ] approve:", e.message);
    res.status(500).json({ success: false, error: "批核失敗" });
  }
});

router.post("/admin/coach-change-requests/:id/reject", authenticateToken, canReview, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const r = db.prepare("SELECT * FROM coach_change_requests WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: "申請不存在" });
    if (r.status !== "pending") return res.status(409).json({ success: false, error: "已處理" });
    const note = String((req.body || {}).note || "").trim().slice(0, 200);
    if (note.length < 2) return res.status(400).json({ success: false, error: "請填寫原因" });
    db.prepare(
      "UPDATE coach_change_requests SET status='rejected', admin_note=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
    ).run(note, req.user.id, r.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "駁回失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
