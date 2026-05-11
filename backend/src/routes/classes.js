/**
 * ZenPass 禪流 - 課程路由
 * 課程列表、詳情、搜尋
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { cache } = require("../middleware/cache");
const {
  authenticateToken,
  optionalAuth,
  requireCoach,
} = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/classes — 課程列表（支援分頁、篩選、搜尋） =====
router.get("/", optionalAuth, cache(30), (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const {
      category,
      difficulty,
      coach_id,
      search,
      date,
      page = 1,
      limit = 20,
      sort = "popular",
    } = req.query;

    let whereConditions = ["c.status = ?"];
    let params = ["active"];

    if (category && category !== "全部" && category !== "all") {
      whereConditions.push("c.category = ?");
      params.push(category);
    }

    if (difficulty) {
      whereConditions.push("c.difficulty = ?");
      params.push(difficulty);
    }

    if (coach_id) {
      whereConditions.push("c.coach_id = ?");
      params.push(coach_id);
    }

    if (search) {
      whereConditions.push(
        "(c.title LIKE ? OR c.description LIKE ? OR c.title_en LIKE ?)",
      );
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (req.query.price_min) {
      whereConditions.push("c.price_hkd >= ?");
      params.push(parseInt(req.query.price_min));
    }
    if (req.query.price_max) {
      whereConditions.push("c.price_hkd <= ?");
      params.push(parseInt(req.query.price_max));
    }

    if (date) {
      whereConditions.push(`c.id IN (
        SELECT class_id FROM class_schedules 
        WHERE date(start_time) = date(?) AND status = 'available'
      )`);
      params.push(date);
    }

    const whereClause = whereConditions.join(" AND ");

    // Count total
    const countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total FROM classes c WHERE ${whereClause}
    `,
      )
      .get(...params);

    const total = countResult.total;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Sort
    let orderBy = "c.created_at DESC";
    if (sort === "popular")
      orderBy = "(SELECT COUNT(*) FROM bookings WHERE class_id = c.id) DESC";
    if (sort === "price_asc") orderBy = "c.price_hkd ASC";
    if (sort === "price_desc") orderBy = "c.price_hkd DESC";

    const classes = db
      .prepare(
        `
      SELECT 
        c.*,
        u.name as coach_name,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as booking_count,
        (SELECT ROUND(AVG(CAST(b.status AS REAL)), 1) FROM bookings b WHERE b.class_id = c.id AND b.status = 'attended') as rating,
        (SELECT COUNT(DISTINCT cs.id) FROM class_schedules cs 
         WHERE cs.class_id = c.id AND cs.start_time > datetime('now') AND cs.status = 'available'
        ) as upcoming_sessions
      FROM classes c
      JOIN users u ON c.coach_id = u.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, parseInt(limit), offset);

    //     // Batch query all schedules in one go (avoid N+1)
    let scheduleMap = {};
    if (classes.length > 0) {
      const classIds = classes.map(c => c.id);
      const placeholders = classIds.map(() => '?').join(',');
      const allSchedules = db.prepare(`
        SELECT id, class_id, start_time, end_time, enrolled_count, max_participants, status
        FROM class_schedules
        WHERE class_id IN (${placeholders}) AND start_time > datetime('now') AND status = 'available'
        ORDER BY start_time ASC
      `).all(...classIds);
      for (const s of allSchedules) {
        if (!scheduleMap[s.class_id]) scheduleMap[s.class_id] = [];
        if (scheduleMap[s.class_id].length < 5) {
          scheduleMap[s.class_id].push(s);
        }
      }
    }
    const classesWithSchedule = classes.map(cls => ({
      ...cls,
      schedules: scheduleMap[cls.id] || []
    }));

    db.close();

    res.json({
      classes: classesWithSchedule,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("課程列表錯誤:", err);
    res.status(500).json({ error: "無法取得課程列表" });
  }
});

// ===== GET /api/classes/categories — 分類列表 =====
router.get("/available-dates", cache(60), (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const dates = db
      .prepare(`
        SELECT DISTINCT date(start_time) as d
        FROM class_schedules
        WHERE start_time > datetime('now') AND status = 'available'
        ORDER BY start_time ASC
        LIMIT 14
      `)
      .all()
      .map(row => row.d);
    db.close();
    res.json({ dates });
  } catch (err) {
    console.error("取可用日期錯誤:", err);
    res.status(500).json({ error: "無法取得可用日期" });
  }
});


router.get("/:id/recommended", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const course = db.prepare("SELECT category FROM classes WHERE id = ?").get(req.params.id);
    if (!course) { db.close(); return res.json({ classes: [] }); }
    const classes = db.prepare(`
      SELECT id, title, category, difficulty, price_hkd, duration, image_url
      FROM classes WHERE category = ? AND id != ? AND status = 'active'
      ORDER BY category ASC LIMIT 4
    `).all(course.category, req.params.id);
    db.close();
    res.json({ classes });
  } catch (err) {
    console.error("推薦課程錯誤:", err);
    res.status(500).json({ error: "無法取得推薦" });
  }
});

router.get("/categories", cache(300), (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const categories = db
      .prepare(
        `
      SELECT category, COUNT(*) as count 
      FROM classes 
      WHERE status = 'active'
      GROUP BY category 
      ORDER BY count DESC
    `,
      )
      .all();

    db.close();
    res.json({ categories });
  } catch (err) {
    console.error("分類列表錯誤:", err);
    res.status(500).json({ error: "無法取得分類" });
  }
});

// ===== GET /api/classes/:id — 課程詳情 =====
router.get("/:id", optionalAuth, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const classData = db
      .prepare(
        `
      SELECT c.*, u.name as coach_name, u.avatar_url as coach_avatar,
        u.is_coach, u.coach_verified
      FROM classes c
      JOIN users u ON c.coach_id = u.id
      WHERE c.id = ? AND c.status = 'active'
    `,
      )
      .get(req.params.id);

    if (!classData) {
      db.close();
      return res.status(404).json({ error: "課程不存在" });
    }

    // Get schedules
    const schedules = db
      .prepare(
        `
      SELECT id, start_time, end_time, enrolled_count, max_participants, status
      FROM class_schedules
      WHERE class_id = ? AND start_time > datetime('now')
      ORDER BY start_time ASC
      LIMIT 30
    `,
      )
      .all(req.params.id);

    // Get reviews (from attended bookings)
    const reviews = db
      .prepare(
        `
      SELECT b.id, u.name as user_name, u.avatar_url, b.created_at as review_date, 
             '★★★★★' as rating_text
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE b.class_id = ? AND b.status = 'attended'
      ORDER BY b.created_at DESC
      LIMIT 10
    `,
      )
      .all(req.params.id);

    db.close();

    res.json({
      class: classData,
      schedules,
      reviews,
    });
  } catch (err) {
    console.error("課程詳情錯誤:", err);
    res.status(500).json({ error: "無法取得課程詳情" });
  }
});

// ===== POST /api/classes — 新增課程（教練專用） =====
router.post("/", requireCoach, (req, res) => {
  try {
    const {
      title,
      title_en,
      description,
      description_en,
      category,
      difficulty,
      duration,
      max_participants,
      price_hkd,
      credits_cost,
      venue_name,
      venue_address,
      latitude,
      longitude,
      image_url,
    } = req.body;

    if (!title || !category || !duration || !price_hkd) {
      return res
        .status(400)
        .json({ error: "請填寫課程名稱、分類、時長和價格" });
    }

    const id = uuidv4();
    const clRef =
      "CL-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase();
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    db.prepare(
      `
      INSERT INTO classes (id, class_reference, coach_id, title, title_en, description, description_en, 
        category, difficulty, duration, max_participants, price_hkd, credits_cost,
        venue_name, venue_address, latitude, longitude, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      clRef,
      req.user.id,
      title,
      title_en || null,
      description || null,
      description_en || null,
      category,
      difficulty || "beginner",
      duration,
      max_participants || 15,
      price_hkd,
      credits_cost || 0,
      venue_name || null,
      venue_address || null,
      latitude || null,
      longitude || null,
      image_url || null,
    );

    db.close();

    res.status(201).json({ message: "課程已建立", class_id: id });
  } catch (err) {
    console.error("新增課程錯誤:", err);
    res.status(500).json({ error: "無法建立課程" });
  }
});

// ===== PUT /api/classes/:id — 更新課程 =====
router.put("/:id", requireCoach, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Verify ownership
    const classData = db
      .prepare("SELECT * FROM classes WHERE id = ? AND coach_id = ?")
      .get(req.params.id, req.user.id);
    if (!classData) {
      db.close();
      return res.status(403).json({ error: "你無權限修改此課程" });
    }

    const updates = [];
    const params = [];
    const allowedFields = [
      "title",
      "title_en",
      "description",
      "description_en",
      "category",
      "difficulty",
      "duration",
      "max_participants",
      "price_hkd",
      "credits_cost",
      "venue_name",
      "venue_address",
      "image_url",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    });

    if (updates.length === 0) {
      db.close();
      return res.status(400).json({ error: "沒有需要更新的資料" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params,
    );
    db.close();

    res.json({ message: "課程已更新" });
  } catch (err) {
    console.error("更新課程錯誤:", err);
    res.status(500).json({ error: "無法更新課程" });
  }
});

module.exports = router;
