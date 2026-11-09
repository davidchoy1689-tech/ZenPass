/**
 * 工單五：教練公告欄 + WhatsApp 廣播
 *  POST   /api/coach/announcements
 *  GET    /api/coach/announcements
 *  DELETE /api/coach/announcements/:id
 *  GET    /api/student/announcements?session_id=&course_id=
 *
 * 注意：所有 auth 都逐條 route 加，唔可以 router.use(authenticateToken)，
 * 以免 mount 喺 /api 時攔截 /api/health 等公開端點。
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");
const { audit } = require("../services/audit");

const router = express.Router();

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_announcements (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'all_students'
        CHECK(target_type IN ('all_students','course_specific','session_specific')),
      target_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      template_type TEXT NOT NULL DEFAULT 'general'
        CHECK(template_type IN ('weather','equipment','earlybird','general')),
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ann_coach ON class_announcements(coach_id, is_pinned, created_at);
    CREATE INDEX IF NOT EXISTS idx_ann_target ON class_announcements(target_type, target_id);
  `);
}

function isCoachOrAdmin(db, user) {
  const me = db.prepare("SELECT role FROM users WHERE id=?").get(user.id);
  return me && hasMinimumRole(me.role, "coach");
}

function ownsTarget(db, coachId, targetType, targetId) {
  if (targetType === "all_students") return true;
  if (!targetId) return false;
  if (targetType === "course_specific") {
    return !!db.prepare("SELECT 1 FROM classes WHERE id=? AND coach_id=?").get(targetId, coachId);
  }
  return !!db
    .prepare("SELECT 1 FROM class_schedules s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND c.coach_id=?")
    .get(targetId, coachId);
}

router.post("/coach/announcements", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    if (!isCoachOrAdmin(db, req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const content = String(b.content || "").trim();
    const target_type = ["all_students", "course_specific", "session_specific"].includes(b.target_type) ? b.target_type : "all_students";
    const target_id = String(b.target_id || "") || null;
    const template_type = ["weather", "equipment", "earlybird", "general"].includes(b.template_type) ? b.template_type : "general";
    if (title.length < 2 || title.length > 120) return res.status(400).json({ success: false, error: "標題 2–120 字" });
    if (content.length < 2 || content.length > 2000) return res.status(400).json({ success: false, error: "內容 2–2000 字" });
    if (!ownsTarget(db, req.user.id, target_type, target_id)) return res.status(403).json({ success: false, error: "無權限對此對象發公告" });

    const id = uuidv4();
    db.prepare(
      `INSERT INTO class_announcements (id, coach_id, target_type, target_id, title, content, template_type, is_pinned)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, req.user.id, target_type, target_type === "all_students" ? null : target_id, title, content, template_type, b.is_pinned ? 1 : 0);

    audit({
      actionType: "announcement.published",
      entityType: "class_announcement",
      entityId: id,
      userId: req.user.id,
      newValues: { target_type, target_id, title, template_type, is_pinned: !!b.is_pinned },
      description: "教練發布課堂公告",
    });
    const row = db.prepare("SELECT * FROM class_announcements WHERE id=?").get(id);
    res.status(201).json({ success: true, announcement: row });
  } catch (e) {
    console.error("[ANN] post:", e.message);
    res.status(500).json({ success: false, error: "發佈失敗" });
  }
});

router.get("/coach/announcements", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const rows = db
      .prepare("SELECT * FROM class_announcements WHERE coach_id=? ORDER BY is_pinned DESC, created_at DESC")
      .all(req.user.id);
    res.json({ success: true, announcements: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put("/coach/announcements/:id", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    if (!isCoachOrAdmin(db, req.user)) return res.status(403).json({ success: false, error: "只限教練" });
    const old = db.prepare("SELECT * FROM class_announcements WHERE id=? AND coach_id=?").get(req.params.id, req.user.id);
    if (!old) return res.status(404).json({ success: false, error: "找不到公告或無權限" });
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const content = String(b.content || "").trim();
    const target_type = ["all_students", "course_specific", "session_specific"].includes(b.target_type) ? b.target_type : old.target_type;
    const target_id = target_type === "all_students" ? null : String(b.target_id || old.target_id || "") || null;
    const template_type = ["weather", "equipment", "earlybird", "general"].includes(b.template_type) ? b.template_type : old.template_type;
    if (title.length < 2 || title.length > 120) return res.status(400).json({ success: false, error: "標題 2–120 字" });
    if (content.length < 2 || content.length > 2000) return res.status(400).json({ success: false, error: "內容 2–2000 字" });
    if (!ownsTarget(db, req.user.id, target_type, target_id)) return res.status(403).json({ success: false, error: "無權限對此對象發公告" });
    db.prepare(
      `UPDATE class_announcements SET title=?, content=?, target_type=?, target_id=?, template_type=?, is_pinned=? WHERE id=? AND coach_id=?`,
    ).run(title, content, target_type, target_id, template_type, b.is_pinned ? 1 : 0, req.params.id, req.user.id);
    audit({
      actionType: "announcement.updated",
      entityType: "class_announcement",
      entityId: req.params.id,
      userId: req.user.id,
      oldValues: { title: old.title, content: old.content, target_type: old.target_type, target_id: old.target_id, is_pinned: old.is_pinned },
      newValues: { title, content, target_type, target_id, is_pinned: !!b.is_pinned },
      description: "教練修改課堂公告",
    });
    res.json({ success: true, announcement: db.prepare("SELECT * FROM class_announcements WHERE id=?").get(req.params.id) });
  } catch (e) {
    console.error("[ANN] put:", e.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

router.delete("/coach/announcements/:id", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const r = db.prepare("DELETE FROM class_announcements WHERE id=? AND coach_id=?").run(req.params.id, req.user.id);
    if (!r.changes) return res.status(404).json({ success: false, error: "找不到公告或無權限" });
    audit({
      actionType: "announcement.deleted",
      entityType: "class_announcement",
      entityId: req.params.id,
      userId: req.user.id,
      oldValues: { id: req.params.id },
      description: "教練刪除課堂公告",
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get("/student/announcements", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureTable(db);
    const session_id = String(req.query.session_id || "");
    const course_id = String(req.query.course_id || "");
    let coachId = null;
    if (session_id) {
      const s = db.prepare("SELECT c.coach_id FROM class_schedules s JOIN classes c ON c.id=s.class_id WHERE s.id=?").get(session_id);
      coachId = s && s.coach_id;
    } else if (course_id) {
      const c = db.prepare("SELECT coach_id FROM classes WHERE id=?").get(course_id);
      coachId = c && c.coach_id;
    }
    if (!session_id && !course_id) return res.json({ success: true, announcements: [] });
    const rows = db
      .prepare(
        `SELECT a.*, u.name AS coach_name FROM class_announcements a
           LEFT JOIN users u ON u.id=a.coach_id
          WHERE (? IS NULL OR a.coach_id = ?)
            AND (a.target_type='all_students'
                 OR (a.target_type='course_specific' AND a.target_id=?)
                 OR (a.target_type='session_specific' AND a.target_id=?))
          ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 20`,
      )
      .all(coachId, coachId, course_id, session_id);
    res.json({ success: true, announcements: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
