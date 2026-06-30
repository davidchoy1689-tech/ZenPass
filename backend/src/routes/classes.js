/**
 * ZenPass 禪流 - 課程路由
 * 課程列表、詳情、搜尋
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { cache } = require("../middleware/cache");
const {
  authenticateToken,
  optionalAuth,
  requireCoach,
} = require("../middleware/auth");

const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// ===== GET /api/classes — 課程列表（支援分頁、篩選、搜尋） =====
router.get("/", optionalAuth, cache(30), (req, res) => {
  try {
    const db = getDb();
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
    if (sort === "rating") orderBy = "coach_avg_rating DESC";

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
        ) as upcoming_sessions,
        (SELECT ROUND(AVG(rating), 1) FROM coach_ratings WHERE coach_id = c.coach_id) as coach_avg_rating,
        (SELECT COUNT(*) FROM coach_ratings WHERE coach_id = c.coach_id) as coach_rating_count
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
      const classIds = classes.map((c) => c.id);
      const placeholders = classIds.map(() => "?").join(",");
      const allSchedules = db
        .prepare(
          `
        SELECT id, class_id, start_time, end_time, enrolled_count, max_participants, status
        FROM class_schedules
        WHERE class_id IN (${placeholders}) AND start_time > datetime('now') AND status = 'available'
        ORDER BY start_time ASC
      `,
        )
        .all(...classIds);
      for (const s of allSchedules) {
        if (!scheduleMap[s.class_id]) scheduleMap[s.class_id] = [];
        if (scheduleMap[s.class_id].length < 5) {
          scheduleMap[s.class_id].push(s);
        }
      }
    }
    const classesWithSchedule = classes.map((cls) => ({
      ...cls,
      schedules: scheduleMap[cls.id] || [],
    }));

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
    const db = getDb();
    const dates = db
      .prepare(
        `
        SELECT DISTINCT date(start_time) as d
        FROM class_schedules
        WHERE start_time > datetime('now') AND status = 'available'
        ORDER BY start_time ASC
        LIMIT 14
      `,
      )
      .all()
      .map((row) => row.d);

    res.json({ dates });
  } catch (err) {
    console.error("取可用日期錯誤:", err);
    res.status(500).json({ error: "無法取得可用日期" });
  }
});

router.get("/:id/recommended", (req, res) => {
  try {
    const db = getDb();
    const course = db
      .prepare("SELECT category FROM classes WHERE id = ?")
      .get(req.params.id);
    if (!course) {

      return res.json({ classes: [] });
    }
    const classes = db
      .prepare(
        `
      SELECT id, title, category, difficulty, price_hkd, duration, image_url
      FROM classes WHERE category = ? AND id != ? AND status = 'active'
      ORDER BY category ASC LIMIT 4
    `,
      )
      .all(course.category, req.params.id);

    res.json({ classes });
  } catch (err) {
    console.error("推薦課程錯誤:", err);
    res.status(500).json({ error: "無法取得推薦" });
  }
});

// ===== GET /api/classes/upcoming — 即將開課時間表 (for QR checkin) =====
router.get("/upcoming", optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const schedules = db
      .prepare(
        `
      SELECT cs.id as schedule_id, c.title, c.id as class_id, cs.start_time, cs.end_time,
             c.venue_name, c.venue_address, c.latitude, c.longitude, c.coach_id, c.price_hkd, c.credits_cost, cs.enrolled_count, cs.max_participants
      FROM class_schedules cs, classes c
      WHERE cs.class_id = c.id
        AND cs.start_time >= strftime('%Y-%m-%dT%H:%M:%S', 'now')
        AND cs.status = 'available'
      ORDER BY cs.start_time ASC
      LIMIT 50
    `,
      )
      .all();
    // Enrich with coach names
    var enriched = schedules.map(function (s) {
      var coach = db
        .prepare("SELECT name FROM users WHERE id = ?")
        .get(s.coach_id);
      s.coach_name = coach ? coach.name : "";
      delete s.coach_id;
      return s;
    });

    res.json({ schedules: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/categories", cache(300), (req, res) => {
  try {
    const db = getDb();
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

    res.json({ categories });
  } catch (err) {
    console.error("分類列表錯誤:", err);
    res.status(500).json({ error: "無法取得分類" });
  }
});

// ===== GET /api/classes/:id — 課程詳情 =====
router.get("/:id", optionalAuth, (req, res) => {
  try {
    const db = getDb();
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

    // 🔔 追蹤：瀏覽課程行為（async fire-and-forget）
    try {
      var userId = req.user ? req.user.id : null;
      if (userId && classData) {
        var { trackUserAction } = require("../services/recommendation");
        trackUserAction(userId, "view_class", {
          class_id: req.params.id,
          category: classData.category,
        });
      }
    } catch (trackErr) {
      // 追蹤失敗唔影響 response
    }

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
router.post("/", authenticateToken, requireCoach, (req, res) => {
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
    const db = getDb();
    const maxS3 =
      db
        .prepare(
          "SELECT MAX(CAST(SUBSTR(class_reference, 4) AS INTEGER)) as m FROM classes WHERE class_reference GLOB 'CL-[0-9]*'",
        )
        .get().m || 0;
    const clRef = "CL-" + String(maxS3 + 1).padStart(4, "0");
    db.pragma("foreign_keys = ON");

    db.prepare(
      `
      INSERT INTO classes (id, class_reference, coach_id, title, title_en, description, description_en, 
        category, difficulty, duration, max_participants, price_hkd, credits_cost,
        venue_name, venue_address, latitude, longitude, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    // ⛓️ 區塊鏈：記錄課程建立
    try {
      writeBlock({
        entityType: "class",
        entityId: id,
        data: {
          title,
          category,
          price: price_hkd,
          coach_id: req.user.id,
          status: "active",
          class_reference: clRef,
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (class create):", bcErr.message);
    }

    res.status(201).json({ message: "課程已建立", class_id: id });
  } catch (err) {
    console.error("新增課程錯誤:", err);
    res.status(500).json({ error: "無法建立課程" });
  }
});

// ===== PUT /api/classes/:id — 更新課程 =====
router.put("/:id", authenticateToken, requireCoach, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Verify ownership
    const classData = db
      .prepare("SELECT * FROM classes WHERE id = ? AND coach_id = ?")
      .get(req.params.id, req.user.id);
    if (!classData) {

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

      return res.status(400).json({ error: "沒有需要更新的資料" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    db.prepare(`UPDATE classes SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params,
    );

    // ⛓️ 區塊鏈：記錄課程更新
    try {
      writeBlock({
        entityType: "class",
        entityId: req.params.id,
        data: {
          class_id: req.params.id,
          updates: Object.fromEntries(
            allowedFields
              .filter((f) => req.body[f] !== undefined)
              .map((f) => [f, req.body[f]]),
          ),
          changed_by: req.user.id,
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (class update):", bcErr.message);
    }

    res.json({ message: "課程已更新" });
  } catch (err) {
    console.error("更新課程錯誤:", err);
    res.status(500).json({ error: "無法更新課程" });
  }
});

module.exports = router;
