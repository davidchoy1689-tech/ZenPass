/**
 * ZenPass 禪流 - CRM 路由
 * 學生管理、標籤、筆記、出席追蹤
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireCoach } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/crm/students — 學生列表（多條件篩選）=====
router.get("/students", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const { search, tag, status, page = 1, limit = 50 } = req.query;
    let where = ["1=1"];
    let params = [];

    if (search) {
      where.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (tag) {
      where.push("u.tags LIKE ?");
      params.push(`%${tag}%`);
    }
    if (status === "active") {
      where.push("u.total_visits > 0");
    } else if (status === "inactive") {
      where.push("(u.total_visits IS NULL OR u.total_visits = 0)");
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClause = where.join(" AND ");

    const total = db.prepare(`SELECT COUNT(*) as c FROM users u WHERE ${whereClause}`).get(...params);
    const students = db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.tags, u.credits,
        u.membership_type, u.total_visits, u.total_spent, u.last_visit,
        u.created_at, u.lead_source,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id) as total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND status = 'attended') as attended_bookings
      FROM users u
      WHERE ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    db.close();
    res.json({ students, total: total.c, page: parseInt(page) });
  } catch (err) {
    console.error("CRM student list error:", err);
    res.status(500).json({ error: "無法取得學生列表" });
  }
});

// ===== GET /api/crm/students/:id — 學生詳情 =====
router.get("/students/:id", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const student = db.prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id) as total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND status = 'attended') as attended_bookings,
        (SELECT SUM(amount) FROM bookings WHERE user_id = u.id AND payment_status = 'paid') as total_spent_calc
      FROM users u WHERE u.id = ?
    `).get(req.params.id);

    if (!student) { db.close(); return res.status(404).json({ error: "學生不存在" }); }

    const bookings = db.prepare(`
      SELECT b.*, c.title, cs.start_time, cs.end_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.user_id = ?
      ORDER BY cs.start_time DESC LIMIT 50
    `).all(req.params.id);

    const notes = db.prepare(`
      SELECT sn.*, u.name as coach_name
      FROM student_notes sn
      JOIN users u ON sn.coach_id = u.id
      WHERE sn.student_id = ?
      ORDER BY sn.created_at DESC LIMIT 20
    `).all(req.params.id);

    db.close();
    res.json({ student, bookings, notes });
  } catch (err) {
    console.error("CRM student detail error:", err);
    res.status(500).json({ error: "無法取得學生詳情" });
  }
});

// ===== PUT /api/crm/students/:id — 更新學生資料 =====
router.put("/students/:id", authenticateToken, (req, res) => {
  try {
    const { tags, notes, lead_source } = req.body;
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const updates = [];
    const params = [];
    if (tags !== undefined) { updates.push("tags = ?"); params.push(tags); }
    if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
    if (lead_source !== undefined) { updates.push("lead_source = ?"); params.push(lead_source); }

    if (updates.length === 0) { db.close(); return res.status(400).json({ error: "沒有需要更新的資料" }); }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    db.close();

    res.json({ message: "已更新" });
  } catch (err) {
    console.error("CRM update error:", err);
    res.status(500).json({ error: "更新失敗" });
  }
});

// ===== POST /api/crm/students/:id/notes — 新增教練筆記 =====
router.post("/students/:id/notes", authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "請填寫筆記內容" });

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const id = uuidv4();
    db.prepare(`
      INSERT INTO student_notes (id, student_id, coach_id, content)
      VALUES (?, ?, ?, ?)
    `).run(id, req.params.id, req.user.id, content);

    const note = db.prepare(`
      SELECT sn.*, u.name as coach_name FROM student_notes sn
      JOIN users u ON sn.coach_id = u.id WHERE sn.id = ?
    `).get(id);

    db.close();
    res.status(201).json({ note });
  } catch (err) {
    console.error("CRM add note error:", err);
    res.status(500).json({ error: "新增筆記失敗" });
  }
});

// ===== POST /api/crm/import — CSV 匯入學生 =====
router.post("/import", authenticateToken, (req, res) => {
  try {
    const { students } = req.body;
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: "請提供學生資料" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    let imported = 0, skipped = 0;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, phone, lead_source, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const s of students) {
      if (!s.name) continue;
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(s.email);
      if (existing) { skipped++; continue; }
      insert.run(uuidv4(), s.email || "", s.name, s.phone || "", s.source || "");
      imported++;
    }

    db.close();
    res.json({ message: `已匯入 ${imported} 個學生，${skipped} 個已存在` });
  } catch (err) {
    console.error("CRM import error:", err);
    res.status(500).json({ error: "匯入失敗" });
  }
});

module.exports = router;
