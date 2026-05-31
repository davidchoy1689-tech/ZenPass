/**
 * ZenPass 禪流 - Local Migration Route
 * 因為 Supabase 連接池未啟用，改用本地 SQLite 直接建立表格
 */

const express = require("express");
const router = express.Router();
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/migrate/course-contents — 檢查並建立 course_contents 表 =====
router.get("/course-contents", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='course_contents'",
      )
      .get();
    db.close();

    res.json({
      exists: !!tableExists,
      message: tableExists
        ? "course_contents table exists"
        : "course_contents table NOT found",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/migrate/course-contents — 執行 migration =====
router.post("/course-contents", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Check if table exists
    const existing = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='course_contents'",
      )
      .get();

    if (existing) {
      db.close();
      return res.json({ status: "skipped", message: "Table already exists" });
    }

    // Create table (SQLite syntax)
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_contents (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        course_number TEXT UNIQUE,
        title TEXT,
        description TEXT,
        rich_content TEXT,
        video_url TEXT,
        images TEXT,
        materials TEXT,
        level TEXT DEFAULT 'beginner'
          CHECK(level IN ('beginner','intermediate','advanced','all_levels')),
        benefits TEXT,
        faqs TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES classes(id)
      )
    `);

    // Create indexes
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_course_contents_course ON course_contents(course_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_course_contents_number ON course_contents(course_number)",
    );

    db.close();

    res.json({
      status: "created",
      message: "course_contents table created successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
