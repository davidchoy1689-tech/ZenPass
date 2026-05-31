/**
 * ZenPass 禪流 - course_contents CRUD routes
 * 課程詳細內容（本地 SQLite 版本）
 */

const express = require("express");
const router = express.Router();
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  return db;
}

// ===== GET /api/course-contents — 全部課程內容列表 =====
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const { course_id } = req.query;

    let sql = `
      SELECT cc.*, c.title AS course_title, c.title_en AS course_title_en, c.category
      FROM course_contents cc
      LEFT JOIN classes c ON cc.course_id = c.id
    `;
    const params = [];

    if (course_id) {
      sql += " WHERE cc.course_id = ?";
      params.push(course_id);
    }

    sql += " ORDER BY cc.created_at DESC";

    const data = db.prepare(sql).all(...params);
    db.close();

    // Parse JSON fields
    const parsed = data.map((row) => ({
      ...row,
      images: row.images ? JSON.parse(row.images) : [],
      materials: row.materials ? JSON.parse(row.materials) : [],
      benefits: row.benefits ? JSON.parse(row.benefits) : [],
      faqs: row.faqs ? JSON.parse(row.faqs) : [],
      rich_content: row.rich_content ? JSON.parse(row.rich_content) : null,
    }));

    res.json({ data: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/course-contents/:id — 單個課程內容 =====
router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT cc.*, c.title AS course_title, c.title_en AS course_title_en
         FROM course_contents cc
         LEFT JOIN classes c ON cc.course_id = c.id
         WHERE cc.id = ?`,
      )
      .get(req.params.id);

    db.close();

    if (!row) {
      return res.status(404).json({ error: "course_contents not found" });
    }

    // Parse JSON fields
    const parsed = {
      ...row,
      images: row.images ? JSON.parse(row.images) : [],
      materials: row.materials ? JSON.parse(row.materials) : [],
      benefits: row.benefits ? JSON.parse(row.benefits) : [],
      faqs: row.faqs ? JSON.parse(row.faqs) : [],
      rich_content: row.rich_content ? JSON.parse(row.rich_content) : null,
    };

    res.json({ data: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/course-contents — 新增課程內容 =====
router.post("/", authenticateToken, requireAdmin, (req, res) => {
  try {
    const {
      course_id,
      title,
      description,
      rich_content,
      video_url,
      images,
      materials,
      level,
      benefits,
      faqs,
    } = req.body;

    if (!course_id) {
      return res.status(400).json({ error: "course_id is required" });
    }

    const courseNumber =
      "CT-" +
      new Date().toISOString().substring(0, 4) +
      "-" +
      String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");

    const db = getDb();

    // Check course exists
    const courseExists = db
      .prepare("SELECT id FROM classes WHERE id = ?")
      .get(course_id);
    if (!courseExists) {
      db.close();
      return res.status(400).json({ error: "course_id does not exist" });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO course_contents (id, course_id, course_number, title, description, rich_content,
        video_url, images, materials, level, benefits, faqs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      course_id,
      courseNumber,
      title || null,
      description || null,
      rich_content ? JSON.stringify(rich_content) : null,
      video_url || null,
      images ? JSON.stringify(images) : "[]",
      materials ? JSON.stringify(materials) : "[]",
      level || "beginner",
      benefits ? JSON.stringify(benefits) : "[]",
      faqs ? JSON.stringify(faqs) : "[]",
      now,
      now,
    );

    db.close();

    res.status(201).json({
      data: {
        id,
        course_id,
        course_number: courseNumber,
        title,
        description,
        rich_content,
        video_url,
        images: images || [],
        materials: materials || [],
        level: level || "beginner",
        benefits: benefits || [],
        faqs: faqs || [],
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PUT /api/course-contents/:id — 更新課程內容 =====
router.put("/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const existing = db
      .prepare("SELECT * FROM course_contents WHERE id = ?")
      .get(req.params.id);

    if (!existing) {
      db.close();
      return res.status(404).json({ error: "course_contents not found" });
    }

    const allowed = [
      "title",
      "description",
      "rich_content",
      "video_url",
      "images",
      "materials",
      "level",
      "benefits",
      "faqs",
    ];

    const updates = [];
    const params = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (["images", "materials", "benefits"].includes(key)) {
          val = JSON.stringify(val);
        }
        if (key === "rich_content" && val) {
          val = JSON.stringify(val);
        }
        if (key === "faqs" && val) {
          val = JSON.stringify(val);
        }
        updates.push(`${key} = ?`);
        params.push(val);
      }
    }

    if (updates.length === 0) {
      db.close();
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(req.params.id);

    db.prepare(
      `UPDATE course_contents SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...params);

    const updated = db
      .prepare("SELECT * FROM course_contents WHERE id = ?")
      .get(req.params.id);
    db.close();

    res.json({ data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== DELETE /api/course-contents/:id — 刪除課程內容 =====
router.delete("/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM course_contents WHERE id = ?")
      .run(req.params.id);

    db.close();

    if (result.changes === 0) {
      return res.status(404).json({ error: "course_contents not found" });
    }

    res.json({ status: "deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
