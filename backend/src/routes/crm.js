/**
 * ZenPass 禪流 - CRM 路由
 * 學生管理、標籤、筆記、出席追蹤
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, requireCoach } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// ===== GET /api/crm/students — 學生列表（多條件篩選）=====
router.get("/students", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

    const total = db
      .prepare(`SELECT COUNT(*) as c FROM users u WHERE ${whereClause}`)
      .get(...params);
    const students = db
      .prepare(
        `
      SELECT u.id, u.name, u.email, u.phone, u.tags, u.credits,
        u.membership_type, u.total_visits, u.total_spent, u.last_visit,
        u.created_at, u.lead_source,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id) as total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND status = 'attended') as attended_bookings
      FROM users u
      WHERE ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, parseInt(limit), offset);

    res.json({ students, total: total.c, page: parseInt(page) });
  } catch (err) {
    console.error("CRM student list error:", err);
    res.status(500).json({ success: false, error: "無法取得學生列表" });
  }
});

// ===== GET /api/crm/students/:id — 學生詳情 =====
router.get("/students/:id", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const student = db
      .prepare(
        `
      SELECT u.*,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id) as total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND status = 'attended') as attended_bookings,
        (SELECT SUM(amount) FROM bookings WHERE user_id = u.id AND payment_status = 'paid') as total_spent_calc
      FROM users u WHERE u.id = ?
    `,
      )
      .get(req.params.id);

    if (!student) {

      return res.status(404).json({ success: false, error: "學生不存在" });
    }

    const bookings = db
      .prepare(
        `
      SELECT b.*, c.title, cs.start_time, cs.end_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.user_id = ?
      ORDER BY cs.start_time DESC LIMIT 50
    `,
      )
      .all(req.params.id);

    const notes = db
      .prepare(
        `
      SELECT sn.*, u.name as coach_name
      FROM student_notes sn
      JOIN users u ON sn.coach_id = u.id
      WHERE sn.student_id = ?
      ORDER BY sn.created_at DESC LIMIT 20
    `,
      )
      .all(req.params.id);

    const comms = db
      .prepare(
        `
      SELECT nl.* FROM notification_logs nl
      WHERE nl.user_id = ?
      ORDER BY nl.created_at DESC LIMIT 20
    `,
      )
      .all(req.params.id);

    res.json({ student, bookings, notes, communications: comms });
  } catch (err) {
    console.error("CRM student detail error:", err);
    res.status(500).json({ success: false, error: "無法取得學生詳情" });
  }
});

// ===== PUT /api/crm/students/:id — 更新學生資料 =====
router.put("/students/:id", authenticateToken, (req, res) => {
  try {
    const { tags, notes, lead_source } = req.body;
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const updates = [];
    const params = [];
    if (tags !== undefined) {
      updates.push("tags = ?");
      params.push(tags);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      params.push(notes);
    }
    if (lead_source !== undefined) {
      updates.push("lead_source = ?");
      params.push(lead_source);
    }

    if (updates.length === 0) {

      return res.status(400).json({ success: false, error: "沒有需要更新的資料" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params,
    );

    res.json({ message: "已更新" });
  } catch (err) {
    console.error("CRM update error:", err);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

// ===== POST /api/crm/students/:id/notes — 新增教練筆記 =====
router.post("/students/:id/notes", authenticateToken, (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, error: "請填寫筆記內容" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    const id = uuidv4();
    db.prepare(
      `
      INSERT INTO student_notes (id, student_id, coach_id, content)
      VALUES (?, ?, ?, ?)
    `,
    ).run(id, req.params.id, req.user.id, content);
    try {
      writeBlock({
        entityType: "student_note",
        entityId: id,
        data: JSON.stringify({
          student_id: req.params.id,
          coach_id: req.user.id,
          content: (content || "").substring(0, 100),
        }),
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (student_note):", bcErr.message);
    }

    const note = db
      .prepare(
        `
      SELECT sn.*, u.name as coach_name FROM student_notes sn
      JOIN users u ON sn.coach_id = u.id WHERE sn.id = ?
    `,
      )
      .get(id);

    res.status(201).json({ note });
  } catch (err) {
    console.error("CRM add note error:", err);
    res.status(500).json({ success: false, error: "新增筆記失敗" });
  }
});

// ===== POST /api/crm/import — CSV 匯入學生 =====
router.post("/import", authenticateToken, (req, res) => {
  try {
    const { students } = req.body;
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, error: "請提供學生資料" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    let imported = 0,
      skipped = 0;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, phone, lead_source, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const s of students) {
      if (!s.name) continue;
      const existing = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(s.email);
      if (existing) {
        skipped++;
        continue;
      }
      insert.run(
        uuidv4(),
        s.email || "",
        s.name,
        s.phone || "",
        s.source || "",
      );
      imported++;
    }

    res.json({ message: `已匯入 ${imported} 個學生，${skipped} 個已存在` });
  } catch (err) {
    console.error("CRM import error:", err);
    res.status(500).json({ success: false, error: "匯入失敗" });
  }
});

/**
 * 自動分群 — 根據用戶行為自動更新標籤
 * 每小時執行一次，由 index.js cron 調用
 */
function autoSegmentUsers() {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 新客戶：註冊 <30日 + 預約 <3次
    db.prepare(
      `
      UPDATE users SET tags = CASE
        WHEN tags IS NULL OR tags = '' THEN 'new'
        WHEN tags NOT LIKE '%new%' THEN tags || ',new'
        ELSE tags END
      WHERE julianday('now') - julianday(created_at) < 30
      AND (SELECT COUNT(*) FROM bookings WHERE user_id = users.id) < 3
      AND (tags IS NULL OR tags NOT LIKE '%new%')
    `,
    ).run();

    // VIP：總消費 >$500 或 出席 >10 次
    db.prepare(
      `
      UPDATE users SET tags = CASE
        WHEN tags IS NULL OR tags = '' THEN 'vip'
        WHEN tags NOT LIKE '%vip%' THEN tags || ',vip'
        ELSE tags END
      WHERE (total_spent > 500 OR total_visits > 10)
      AND (tags IS NULL OR tags NOT LIKE '%vip%')
    `,
    ).run();

    // 流失風險：最後到訪 >60日
    db.prepare(
      `
      UPDATE users SET tags = CASE
        WHEN tags IS NULL OR tags = '' THEN 'at-risk'
        WHEN tags NOT LIKE '%at-risk%' THEN tags || ',at-risk'
        ELSE tags END
      WHERE last_visit IS NOT NULL
      AND julianday('now') - julianday(last_visit) > 60
      AND (tags IS NULL OR tags NOT LIKE '%at-risk%')
    `,
    ).run();

    // 定期：出席 >5次 + 最後到訪 <30日
    db.prepare(
      `
      UPDATE users SET tags = CASE
        WHEN tags IS NULL OR tags = '' THEN 'regular'
        WHEN tags NOT LIKE '%regular%' THEN tags || ',regular'
        ELSE tags END
      WHERE total_visits > 5
      AND last_visit IS NOT NULL
      AND julianday('now') - julianday(last_visit) < 30
      AND (tags IS NULL OR tags NOT LIKE '%regular%')
    `,
    ).run();

    return true;
  } catch (err) {
    console.error("Auto-segment error:", err.message);
    return false;
  }
}

// ===== POST /api/crm/waiver — 提交健康申報表 =====
router.post("/waiver", authenticateToken, (req, res) => {
  try {
    const { name, age, gender, phone, conditions, other } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "請輸入姓名" });

    const db = getDb();
    db.prepare(
      `
      INSERT INTO student_notes (id, student_id, coach_id, content, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `,
    ).run(
      require("uuid").v4(),
      req.user.id,
      req.user.id,
      `📋 健康申報\n姓名: ${name}\n年齡: ${age}\n性別: ${gender}\n電話: ${phone}\n健康狀況: ${conditions || "無"}\n其他: ${other || "無"}`,
    );
    try {
      const waiverId = require("uuid").v4();
      writeBlock({
        entityType: "student_note",
        entityId: waiverId,
        data: JSON.stringify({
          student_id: req.user.id,
          coach_id: req.user.id,
          content: "📋 健康申報",
        }),
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (waiver):", bcErr.message);
    }

    sendNotification("waiver.submitted", {
      user_id: req.user.id,
      data: { name, conditions },
    });

    res.json({ success: true, message: "✅ 健康申報已提交" });
  } catch (err) {
    console.error("Waiver error:", err.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

module.exports = router;
module.exports.autoSegmentUsers = autoSegmentUsers;
