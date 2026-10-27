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
      sport_slug,
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

    // 已完結超過 7 日 → 自動不再顯示（只適用於曾開放預約嘅課程；未開放嘅目錄項繼續展示）
    const LAST_END =
      "(SELECT MAX(cs.end_time) FROM class_schedules cs WHERE cs.class_id = c.id)";
    whereConditions.push(
      `NOT (COALESCE(c.booking_open,0) = 1 AND ${LAST_END} IS NOT NULL AND ${LAST_END} < datetime('now','-7 days'))`,
    );

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
    const HAS_CC = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_credentials'").get();

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
    if (sort === "newest") orderBy = "c.created_at DESC";
    if (sort === "price_asc") orderBy = "c.price_hkd ASC";
    if (sort === "price_desc") orderBy = "c.price_hkd DESC";
    if (sort === "rating") orderBy = "coach_avg_rating DESC";

    const classes = db
      .prepare(
        `
      SELECT 
        c.*,
        u.name as coach_name,
        ${LAST_END} as last_session_end,
        CASE WHEN COALESCE(c.booking_open,0) = 1 AND ${LAST_END} IS NOT NULL AND ${LAST_END} < datetime('now') THEN 1 ELSE 0 END as is_expired,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id) as booking_count,
        (SELECT ROUND(AVG(CAST(b.status AS REAL)), 1) FROM bookings b WHERE b.class_id = c.id AND b.status = 'attended') as rating,
        (SELECT COUNT(DISTINCT cs.id) FROM class_schedules cs 
         WHERE cs.class_id = c.id AND cs.start_time > datetime('now') AND cs.start_time <= datetime('now','+2 months') AND cs.status = 'available'
        ) as upcoming_sessions,
        (SELECT ROUND(AVG(rating), 1) FROM mutual_reviews WHERE target_type='coach' AND target_id = c.coach_id AND rater_role='student') as coach_avg_rating,
        (SELECT COUNT(*) FROM mutual_reviews WHERE target_type='coach' AND target_id = c.coach_id AND rater_role='student') as coach_rating_count,
        ${HAS_CC ? `(SELECT CASE WHEN cc.status='verified' AND COALESCE(cc.is_starred,0)=1
                      AND (cc.license_expiry IS NULL OR cc.license_expiry = '' OR cc.license_expiry >= date('now'))
                 THEN 1 ELSE 0 END
           FROM coach_credentials cc WHERE cc.user_id = c.coach_id)` : "0"} as coach_starred,
        ${HAS_CC ? `(SELECT CASE WHEN cc.status='verified' THEN 1 ELSE 0 END FROM coach_credentials cc WHERE cc.user_id = c.coach_id)` : "0"} as coach_verified
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
        WHERE class_id IN (${placeholders}) AND start_time > datetime('now') AND start_time <= datetime('now','+2 months') AND status = 'available'
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
    res.status(500).json({ success: false, error: "無法取得課程列表" });
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
        WHERE start_time > datetime('now') AND start_time <= datetime('now','+2 months') AND status = 'available'
        ORDER BY start_time ASC
        LIMIT 14
      `,
      )
      .all()
      .map((row) => row.d);

    res.json({ dates });
  } catch (err) {
    console.error("取可用日期錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得可用日期" });
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
    res.status(500).json({ success: false, error: "無法取得推薦" });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/classes/featured — 首頁「本週末首發推薦」（真實即將開班） =====
router.get("/featured", cache(30), (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 4, 1), 8);
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 120);
    const HAS_CC = !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_credentials'")
      .get();
    // 舊 DB 可能缺新欄位 → 動態檢查，避免整條 route 500
    const cols = new Set(
      db.prepare("PRAGMA table_info(classes)").all().map((r) => r.name),
    );
    const col = (name) => (cols.has(name) ? `c.${name}` : `NULL AS ${name}`);

    const rows = db
      .prepare(
        `
      SELECT c.id, c.title, c.category, c.district, c.venue_name, c.venue_address,
             c.price_hkd, ${col("credits_cost")}, ${col("duration")}, ${col("image_url")},
             ${col("photos_gallery")}, ${col("difficulty")}, ${col("target_audience")},
             ${col("sport_slug")},
             u.name AS coach_name,
             cs.id AS schedule_id, cs.start_time, cs.end_time,
             cs.max_participants, cs.enrolled_count,
             ${HAS_CC ? `(SELECT CASE WHEN cc.status='verified' AND COALESCE(cc.is_starred,0)=1
                        AND (cc.license_expiry IS NULL OR cc.license_expiry = '' OR cc.license_expiry >= date('now'))
                   THEN 1 ELSE 0 END FROM coach_credentials cc WHERE cc.user_id = c.coach_id)` : "0"} as coach_starred,
             ${HAS_CC ? `(SELECT CASE WHEN cc.status='verified' THEN 1 ELSE 0 END FROM coach_credentials cc WHERE cc.user_id = c.coach_id)` : "0"} as coach_verified
      FROM classes c
      JOIN users u ON u.id = c.coach_id
      JOIN class_schedules cs ON cs.class_id = c.id
      WHERE c.status = 'active'
        AND COALESCE(c.booking_open, 0) = 1
        AND cs.status = 'available'
        AND cs.start_time >= datetime('now')
        AND cs.start_time <= datetime('now', '+' || ? || ' days')
        AND cs.start_time = (
          SELECT MIN(cs2.start_time) FROM class_schedules cs2
          WHERE cs2.class_id = c.id AND cs2.status = 'available'
            AND cs2.start_time >= datetime('now')
        )
      ORDER BY CASE WHEN strftime('%w', cs.start_time, '+8 hours') IN ('0','6') THEN 0 ELSE 1 END,
               cs.start_time ASC
      LIMIT ?
    `,
      )
      .all(days, limit);

    const classes = rows.map((r) => {
      const cap = Number(r.max_participants) || 0;
      const taken = Number(r.enrolled_count) || 0;
      return Object.assign({}, r, {
        seats_left: cap ? Math.max(0, cap - taken) : null,
      });
    });

    res.json({ success: true, classes, count: classes.length });
  } catch (err) {
    console.error("首發推薦錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得首發推薦" });
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
    res.status(500).json({ success: false, error: "無法取得分類" });
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
        u.is_coach, u.coach_verified,
        u.coach_headline, u.coach_bio, u.coach_tags, u.coach_languages, u.coach_years,
        (SELECT MAX(cs.end_time) FROM class_schedules cs WHERE cs.class_id = c.id) as last_session_end,
        CASE WHEN COALESCE(c.booking_open,0) = 1
              AND (SELECT MAX(cs.end_time) FROM class_schedules cs WHERE cs.class_id = c.id) IS NOT NULL
              AND (SELECT MAX(cs.end_time) FROM class_schedules cs WHERE cs.class_id = c.id) < datetime('now')
             THEN 1 ELSE 0 END as is_expired
      FROM classes c
      JOIN users u ON c.coach_id = u.id
      WHERE c.id = ? AND c.status = 'active'
    `,
      )
      .get(req.params.id);

    if (!classData) {

      return res.status(404).json({ success: false, error: "課程不存在" });
    }

    // 場地設施：只有合作場地真實登記嘅設施才回傳（冇 = 唔顯示，避免失實宣傳）
    try {
      const pvId = classData.partner_venue_id || null;
      if (pvId) {
        const pv = db.prepare("SELECT facilities FROM partner_venues WHERE id = ?").get(pvId);
        if (pv && pv.facilities) {
          let arr = [];
          try {
            arr = JSON.parse(pv.facilities);
          } catch (e) {
            arr = String(pv.facilities).split(/[,，、]/).map((x) => x.trim());
          }
          classData.facilities = Array.isArray(arr) ? arr.filter(Boolean) : [];
        }
      }
    } catch (e) {}

    // VIP 優先預約窗口（新課頭 N 小時只限 VIP Pass）— 前端顯示用
    try {
      const h = Number(classData.vip_priority_hours) || 0;
      const raw = String(classData.created_at || "");
      const iso = /Z$|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z";
      const until = h ? new Date(new Date(iso).getTime() + h * 3600 * 1000) : null;
      if (until && !isNaN(until) && until > new Date()) {
        classData.vip_priority_until = until.toISOString();
      }
    } catch (e) {}

    // 🛡️ 具體運動固有風險披露（Volenti 抗辯證據鏈）
    try {
      const { riskProfile } = require("../config/sport-risks");
      classData.risk_notice = riskProfile(classData.sport_slug, classData.category, classData.title);
    } catch (e) {}

    // ⛑️ 教練急救資格（前台徽章用）
    try {
      const fa = db
        .prepare(
          `SELECT first_aid_type, first_aid_expiry FROM coach_credentials
            WHERE user_id = ? AND COALESCE(first_aid_type,'') <> ''
            ORDER BY COALESCE(reviewed_at, created_at) DESC LIMIT 1`,
        )
        .get(classData.coach_id);
      const valid = !!(fa && fa.first_aid_expiry && String(fa.first_aid_expiry).slice(0, 10) >= new Date().toISOString().slice(0, 10));
      classData.coach_first_aid = valid ? { type: fa.first_aid_type, expiry: fa.first_aid_expiry } : null;
    } catch (e) {}

    // 教練公開資料 → 自動嵌入課程頁（註冊時收集 → 批核時寫入 users → 開班自動帶出）
    const splitList = (v) =>
      String(v || "")
        .split(/[,、，/]/)
        .map((x) => x.trim())
        .filter(Boolean);
    classData.coach_tags = splitList(classData.coach_tags);
    const langs = splitList(classData.coach_languages);
    if (langs.length) classData.coach_tags = classData.coach_tags.concat(langs);
    classData.coach_tags = Array.from(new Set(classData.coach_tags));
    classData.coach_stats = [];
    if (classData.coach_years) classData.coach_stats.push({ v: classData.coach_years + " 年", k: "教學年資" });
    const taughtCount = db
      .prepare("SELECT COUNT(*) c FROM classes WHERE coach_id = ? AND status = 'active'")
      .get(classData.coach_id || "").c;
    if (taughtCount) classData.coach_stats.push({ v: String(taughtCount), k: "開辦課程" });
    if (langs.length) classData.coach_stats.push({ v: String(langs.length), k: "授課語言" });

    // Get schedules
    const schedules = db
      .prepare(
        `
      SELECT id, start_time, end_time, enrolled_count, max_participants, status, notes
      FROM class_schedules
      WHERE class_id = ? AND start_time > datetime('now') AND start_time <= datetime('now','+2 months')
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
    res.status(500).json({ success: false, error: "無法取得課程詳情" });
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
      sport_slug,
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
      equipment,
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
        category, sport_slug, difficulty, duration, max_participants, price_hkd, credits_cost,
        venue_name, venue_address, latitude, longitude, image_url, equipment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      sport_slug || null,
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
      equipment || null,
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
    res.status(500).json({ success: false, error: "無法建立課程" });
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

      return res.status(403).json({ success: false, error: "你無權限修改此課程" });
    }

    const updates = [];
    const params = [];
    const allowedFields = [
      "title",
      "title_en",
      "description",
      "description_en",
      "category",
      "sport_slug",
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

      return res.status(400).json({ success: false, error: "沒有需要更新的資料" });
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
    res.status(500).json({ success: false, error: "無法更新課程" });
  }
});

module.exports = router;
