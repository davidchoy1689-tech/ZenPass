/**
 * P1 學員運動電子手冊（工單三）
 *  POST /api/coach/handbook/log           教練新增／更新手冊（標籤、評語、功課、相片）
 *  GET  /api/coach/handbook/students/:sid 教練查看某學員時間軸
 *  GET  /api/student/handbook/:sid        學員／代報子女查看（含 replies）
 *  POST /api/student/handbook/:id/reply   學員／子女留言
 */
const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, hasMinimumRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { writeBlock } = require("../services/blockchain-audit");
const { dbNotification } = require("../services/notification");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_handbooks (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      booking_id TEXT,
      session_id TEXT NOT NULL,
      coach_id TEXT NOT NULL,
      log_date TEXT NOT NULL,
      tags_json TEXT DEFAULT '[]',
      metrics_json TEXT,
      comment TEXT NOT NULL,
      homework TEXT,
      photos_json TEXT DEFAULT '[]',
      allow_reply INTEGER DEFAULT 1,
      sha256 TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sh_student ON student_handbooks(student_id, log_date);
    CREATE INDEX IF NOT EXISTS idx_sh_session ON student_handbooks(session_id);
    CREATE TABLE IF NOT EXISTS handbook_replies (
      id TEXT PRIMARY KEY,
      handbook_id TEXT NOT NULL,
      author_id TEXT,
      author_role TEXT NOT NULL CHECK(author_role IN ('student','guardian','coach')),
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (handbook_id) REFERENCES student_handbooks(id) ON DELETE CASCADE
    );
  `);
}

function canViewStudent(db, user, studentId) {
  if (user.id === studentId) return true;
  const me = db.prepare("SELECT role FROM users WHERE id=?").get(user.id);
  if (me && hasMinimumRole(me.role, "admin")) return true;
  // 教練：只限自己教過嘅學生，或已永久綁定俾自己嘅私域學生
  if (me && me.role === "coach") {
    try {
      const taught = db
        .prepare(
          `SELECT 1 FROM bookings b
             JOIN class_schedules s ON s.id = b.schedule_id
             JOIN classes c ON c.id = b.class_id
            WHERE b.user_id = ? AND COALESCE(s.coach_override_id, c.coach_id) = ? LIMIT 1`,
        )
        .get(studentId, user.id);
      if (taught) return true;
      const bound = db
        .prepare(
          "SELECT 1 FROM student_coach_affiliations WHERE student_user_id=? AND origin_coach_id=? AND status='active'",
        )
        .get(studentId, user.id);
      if (bound) return true;
    } catch (e) {
      // 舊 DB 未建 affiliation 表 → 只靠 taught
    }
  }
  // 手冊以報名帳戶（user_id）為單位：本人或管理員；代報子女用同一個家長帳戶
  return false;
}

function coachOwnsSession(db, coachId, sessionId) {
  return !!db
    .prepare("SELECT 1 FROM class_schedules s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND c.coach_id=?")
    .get(sessionId, coachId);
}

const router = express.Router();

router.post("/coach/handbook/log", authenticateToken, express.json({ limit: "8mb" }), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = req.body || {};
    const session_id = b.session_id || b.sessionId;
    const student_id = b.student_id || b.studentId;
    if (!session_id || !student_id) return res.status(400).json({ success: false, error: "缺少 session_id / student_id" });
    if (!coachOwnsSession(db, req.user.id, session_id)) return res.status(403).json({ success: false, error: "非此班教練" });

    const bk = db
      .prepare("SELECT * FROM bookings WHERE schedule_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1")
      .get(session_id, student_id);
    if (!bk) return res.status(404).json({ success: false, error: "學員不在此班" });

    const comment = String(b.comment || "").trim();
    if (comment.length < 2) return res.status(400).json({ success: false, error: "評語太短" });
    if (comment.length > 1200) return res.status(400).json({ success: false, error: "評語上限 1200 字" });

    const tags = Array.isArray(b.tags) ? b.tags.slice(0, 8).map((t) => String(t).slice(0, 20)) : [];
    const photos = Array.isArray(b.photos) ? b.photos.slice(0, 3) : [];
    for (const p of photos) {
      const s = String(p || "");
      if (/^https?:\/\//i.test(s)) continue;
      if (!/^data:image\/(jpeg|png|webp);base64,/i.test(s)) return res.status(400).json({ success: false, error: "相片格式不支援" });
      if (s.length > 1.6 * 1024 * 1024) return res.status(400).json({ success: false, error: "相片過大（每張約 1.2MB 上限）" });
    }

    const student = db.prepare("SELECT name FROM users WHERE id=?").get(student_id);
    const studentName = String(b.student_name || (student && student.name) || bk.child_name || "學員").slice(0, 40);
    const logDate = b.log_date ? String(b.log_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const homework = String(b.homework || "").slice(0, 300);
    const allowReply = b.allow_reply === false ? 0 : 1;
    const sha = crypto
      .createHash("sha256")
      .update(JSON.stringify({ session_id, student_id, logDate, comment, homework, tags, photos: photos.length }))
      .digest("hex");

    const existing = db
      .prepare("SELECT id FROM student_handbooks WHERE session_id=? AND student_id=? LIMIT 1")
      .get(session_id, student_id);
    const id = existing ? existing.id : uuidv4();
    if (existing) {
      db.prepare(
        `UPDATE student_handbooks SET comment=?, tags_json=?, homework=?, photos_json=?, metrics_json=?, allow_reply=?, sha256=?, log_date=? WHERE id=?`,
      ).run(comment, JSON.stringify(tags), homework, JSON.stringify(photos), JSON.stringify(b.metrics || null), allowReply, sha, logDate, id);
    } else {
      db.prepare(
        `INSERT INTO student_handbooks (id, student_id, student_name, booking_id, session_id, coach_id, log_date, tags_json, metrics_json, comment, homework, photos_json, allow_reply, sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, student_id, studentName, bk.id, session_id, req.user.id, logDate, JSON.stringify(tags), JSON.stringify(b.metrics || null), comment, homework, JSON.stringify(photos), allowReply, sha);
    }

    const block = writeBlock({
      entityType: "student_handbook",
      entityId: id,
      data: { session_id, student_id, coach_id: req.user.id, comment, sha256: sha },
    });
    audit({
      actionType: "handbook.log_published",
      entityType: "student_handbook",
      entityId: id,
      userId: req.user.id,
      newValues: { student_id, session_id, tags, sha256: sha, block_hash: block.hash || null },
      description: "教練發佈學員運動手冊",
    });
    try {
      dbNotification(student_id, "handbook", "📖 教練更新了你的運動手冊", `${studentName}，教練已更新今日評語同功課。`, { handbook_id: id });
    } catch (e) {}

    res.status(existing ? 200 : 201).json({ success: true, handbook_id: id, sha256: sha, updated: !!existing, block_hash: block.hash || null });
  } catch (e) {
    console.error("[HANDBOOK-P1] log:", e.message);
    res.status(500).json({ success: false, error: "手冊儲存失敗" });
  }
});

router.get("/coach/handbook/students/:sid", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db
      .prepare("SELECT * FROM student_handbooks WHERE student_id=? AND coach_id=? ORDER BY log_date DESC, created_at DESC")
      .all(req.params.sid, req.user.id);
    res.json({ success: true, handbooks: rows.map(shape) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get("/student/handbook/:sid", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    if (!canViewStudent(db, req.user, req.params.sid)) return res.status(403).json({ success: false, error: "無權限查看" });
    const rows = db
      .prepare("SELECT * FROM student_handbooks WHERE student_id=? ORDER BY log_date DESC, created_at DESC")
      .all(req.params.sid);
    const repStmt = db.prepare("SELECT * FROM handbook_replies WHERE handbook_id=? ORDER BY created_at");
    res.json({ success: true, handbooks: rows.map((r) => ({ ...shape(r), replies: repStmt.all(r.id) })) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/student/handbook/:id/reply", authenticateToken, express.json({ limit: "32kb" }), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const h = db.prepare("SELECT * FROM student_handbooks WHERE id=?").get(req.params.id);
    if (!h) return res.status(404).json({ success: false, error: "找不到手冊" });
    if (!h.allow_reply) return res.status(403).json({ success: false, error: "此手冊已關閉留言" });
    const content = String((req.body || {}).content || "").trim();
    if (content.length < 1) return res.status(400).json({ success: false, error: "留言不可空白" });
    if (content.length > 500) return res.status(400).json({ success: false, error: "留言上限 500 字" });

    let role = "student";
    if (!canViewStudent(db, req.user, h.student_id)) return res.status(403).json({ success: false, error: "無權限留言" });
    const me = db.prepare("SELECT name, role FROM users WHERE id=?").get(req.user.id);
    if (req.user.id !== h.student_id) role = "guardian";
    if (me && hasMinimumRole(me.role, "admin")) role = "coach";
    const name = (me && me.name) || "學員";
    const id = uuidv4();
    db.prepare(
      "INSERT INTO handbook_replies (id, handbook_id, author_id, author_role, author_name, content) VALUES (?,?,?,?,?,?)",
    ).run(id, h.id, req.user.id, role, name, content);
    try {
      dbNotification(h.coach_id, "handbook_reply", "💬 學員回覆了手冊", `${name}：${content.slice(0, 60)}`, { handbook_id: h.id });
    } catch (e) {}
    res.status(201).json({ success: true, reply_id: id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function shape(r) {
  return {
    id: r.id,
    student_id: r.student_id,
    student_name: r.student_name,
    session_id: r.session_id,
    booking_id: r.booking_id,
    coach_id: r.coach_id,
    log_date: r.log_date,
    tags: safe(r.tags_json, []),
    metrics: safe(r.metrics_json, null),
    comment: r.comment,
    homework: r.homework || "",
    photos: safe(r.photos_json, []),
    allow_reply: !!r.allow_reply,
    sha256: r.sha256,
    created_at: r.created_at,
  };
}
function safe(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }

module.exports = router;
