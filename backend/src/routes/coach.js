/**
 * ZenPass 禪流 - 教練路由
 * 教練申請、管理課程
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { getSupabase } = require("../services/supabase");
const { sendNotification, dbNotification } = require("../services/notification");
const { notifyNewApplication } = require("../services/lead-notify");

const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// ===== GET /api/coach/list — 獲取教練列表 =====
router.get("/list", (req, res) => {
  try {
    const db = getDb();
    const coaches = db.prepare(`
      SELECT u.id, u.name, u.avatar_url as avatar,
        COALESCE(cr.avg_rating, 0) as rating,
        COALESCE(cr.total_students, 0) as students,
        (SELECT COUNT(*) FROM classes c WHERE c.coach_id = u.id AND c.status = 'active') as courses,
        COALESCE((SELECT ca.bio FROM coach_applications ca WHERE ca.user_id = u.id ORDER BY ca.created_at DESC LIMIT 1), '') as bio
      FROM users u
      LEFT JOIN (
        SELECT
          cr.coach_id,
          ROUND(AVG(cr.rating), 1) as avg_rating,
          COUNT(DISTINCT cr.user_id) as total_students
        FROM coach_ratings cr
        GROUP BY cr.coach_id
      ) cr ON cr.coach_id = u.id
      WHERE u.is_coach = 1
        AND COALESCE(u.is_active, 1) = 1
        AND COALESCE(u.coach_verified, 0) = 1
        AND u.email NOT LIKE '%e2e%'
        AND u.email NOT LIKE '%@zenpass.test'
        AND u.email NOT LIKE '%@test.hk'
        AND EXISTS (SELECT 1 FROM classes c2 WHERE c2.coach_id = u.id AND c2.status = 'active')
      ORDER BY COALESCE(cr.avg_rating, 0) DESC
      LIMIT ?
    `).all(parseInt(req.query.limit) || 50);
    res.json({ success: true, coaches: coaches });
  } catch(e) {
    console.error("Error fetching coaches:", e.message);
    res.json({ success: true, coaches: [] });
  }
});

// ===== POST /api/coach/apply — 提交教練申請 =====
router.post("/apply", authenticateToken, (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      years_experience,
      specialties,
      certificates,
      bio,
      venue_name,
      venue_address,
      venue_photos,
      facilities,
      headline,
      languages,
      avatar_url,
      id_doc_url,
      cert_doc_url,
      insurance_declared,
      insurance_doc_url,
      insurance_expiry,
    } = req.body;

    if (!name || !phone || !email || !venue_address) {
      return res.status(400).json({ success: false, error: "請填寫姓名、電話、電郵和住址" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 檢查是否已有申請
    const existing = db
      .prepare(
        "SELECT id FROM coach_applications WHERE user_id = ? AND status = 'pending'",
      )
      .get(req.user.id);

    if (existing) {

      return res.status(409).json({ success: false, error: "你已經有進行中的申請" });
    }

    const id = uuidv4();
    const specialtiesStr = Array.isArray(specialties)
      ? specialties.join(",")
      : specialties;
    const facilitiesStr = Array.isArray(facilities)
      ? facilities.join(",")
      : facilities;
    const venuePhotosStr = Array.isArray(venue_photos)
      ? venue_photos.join(",")
      : venue_photos;
    const maxCA =
      db
        .prepare(
          "SELECT MAX(CAST(SUBSTR(application_reference, 4) AS INTEGER)) as m FROM coach_applications WHERE application_reference GLOB 'CA-[0-9]*'",
        )
        .get().m || 0;
    const appRef = "CA-" + String(maxCA + 1).padStart(4, "0");

    db.prepare(
      `
      INSERT INTO coach_applications 
        (id, user_id, name, phone, email, years_experience, specialties, 
         certificates, bio, venue_name, venue_address, venue_photos, facilities,
         application_reference, headline, languages, avatar_url, id_doc_url, cert_doc_url,
         insurance_declared, insurance_doc_url, insurance_expiry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      req.user.id,
      name,
      phone,
      email,
      years_experience || null,
      specialtiesStr || null,
      certificates || null,
      bio || null,
      venue_name,
      venue_address,
      venuePhotosStr || null,
      facilitiesStr || null,
      appRef,
      headline || null,
      Array.isArray(languages) ? languages.join(",") : languages || null,
      avatar_url || null,
      id_doc_url || null,
      cert_doc_url || null,
      insurance_declared ? 1 : 0,
      insurance_doc_url || null,
      insurance_expiry || null,
    );

    // 即時通知負責人（唔阻塞回應；未配置管道都唔會出錯）
    notifyNewApplication(
      "教練",
      { name, phone, email, specialties, certificates, bio, venue_name, venue_address, years_experience },
      appRef,
    ).catch((e) => console.error("lead notify failed:", e.message));

    res.status(201).json({
      message: "申請已提交，我哋會喺 24 小時內完成審批",
      application_id: id,
      reference: appRef,
    });
  } catch (err) {
    console.error("教練申請錯誤:", err);
    res.status(500).json({ success: false, error: "提交申請失敗" });
  }
});

// ===== GET /api/coach/application — 查詢申請狀態 =====
router.get("/application", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const application = db
      .prepare(
        `
      SELECT * FROM coach_applications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(req.user.id);

    if (!application) {
      return res.json({ application: null });
    }

    res.json({ application });
  } catch (err) {
    console.error("查詢申請錯誤:", err);
    res.status(500).json({ success: false, error: "無法查詢申請狀態" });
  }
});

// ===== GET /api/coach/my-classes — 我的課程 =====
router.get("/my-classes", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const classes = db
      .prepare(
        `
      SELECT c.*, 
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'confirmed') as upcoming_bookings,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'attended') as total_attended
      FROM classes c
      WHERE c.coach_id = ? AND COALESCE(c.status,'active') <> 'deleted'
      ORDER BY c.created_at DESC
    `,
      )
      .all(req.user.id);

    res.json({ classes });
  } catch (err) {
    console.error("獲取課程錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取課程列表" });
  }
});

// ===== POST /api/coach/schedules — 新增課程時間（支援重複）=====
router.post("/schedules", authenticateToken, (req, res) => {
  try {
    const {
      class_id,
      start_time,
      end_time,
      recurring,
      recurring_until,
      max_participants,
    } = req.body;

    if (!class_id || !start_time || !end_time) {
      return res.status(400).json({ success: false, error: "請填寫課程、開始時間和結束時間" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Verify ownership
    const classData = db
      .prepare("SELECT * FROM classes WHERE id = ? AND coach_id = ?")
      .get(class_id, req.user.id);
    if (!classData) {

      return res.status(403).json({ success: false, error: "你無權限操作此課程" });
    }

    const recurringType = recurring || "none";
    const durationMs =
      new Date(end_time).getTime() - new Date(start_time).getTime();
    const scheduleIds = [];

    if (recurringType === "none" || !recurring_until) {
      // Single schedule
      const id = uuidv4();
      const recurringSave = ["weekly", "biweekly", "monthly"].includes(
        recurringType,
      )
        ? recurringType
        : "none";
      db.prepare(
        `
        INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        class_id,
        start_time,
        end_time,
        recurringSave,
        max_participants || classData.max_participants,
      );
      scheduleIds.push(id);

      // If recurring_until is set but recurring isn't, still mark as recurring
      if (recurringType !== "none") {
        db.prepare("UPDATE class_schedules SET recurring = ? WHERE id = ?").run(
          recurringSave,
          id,
        );
      }
    } else {
      // Generate recurring schedules
      const startDate = new Date(start_time);
      const endDate = new Date(end_time);
      const untilDate = new Date(recurring_until);
      const maxP = max_participants || classData.max_participants;
      let currentStart = new Date(startDate);
      let currentEnd = new Date(endDate);

      // First schedule - original dates
      let firstId = uuidv4();
      db.prepare(
        `INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        firstId,
        class_id,
        currentStart.toISOString(),
        currentEnd.toISOString(),
        recurringType,
        maxP,
      );
      scheduleIds.push(firstId);

      // Generate subsequent schedules
      let count = 1;
      const MAX_GENERATED = 365; // Safety limit

      while (count < MAX_GENERATED) {
        const nextStart = new Date(currentStart);
        const nextEnd = new Date(currentEnd);

        switch (recurringType) {
          case "weekly":
            nextStart.setDate(nextStart.getDate() + 7);
            nextEnd.setDate(nextEnd.getDate() + 7);
            break;
          case "biweekly":
            nextStart.setDate(nextStart.getDate() + 14);
            nextEnd.setDate(nextEnd.getDate() + 14);
            break;
          case "monthly":
            nextStart.setMonth(nextStart.getMonth() + 1);
            nextEnd.setMonth(nextEnd.getMonth() + 1);
            break;
          default:
            break;
        }

        if (nextStart > untilDate) break;

        const nextId = uuidv4();
        db.prepare(
          `INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          nextId,
          class_id,
          nextStart.toISOString(),
          nextEnd.toISOString(),
          recurringType,
          maxP,
        );
        scheduleIds.push(nextId);

        currentStart = nextStart;
        currentEnd = nextEnd;
        count++;
      }
    }

    // ⛓️ 區塊鏈：記錄課堂時間建立
    try {
      for (const sid of scheduleIds) {
        writeBlock({
          entityType: "class_schedule",
          entityId: sid,
          data: {
            class_id,
            start_time,
            end_time,
            recurring: recurringType,
            max_participants: max_participants || classData.max_participants,
            status: "available",
            coach_id: req.user.id,
          },
        });
      }
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (schedule create):", bcErr.message);
    }

    res.status(201).json({
      message: `時間已新增（共 ${scheduleIds.length} 個時段）`,
      schedule_ids: scheduleIds,
      count: scheduleIds.length,
    });
  } catch (err) {
    console.error("新增時間錯誤:", err);
    res.status(500).json({ success: false, error: "無法新增時間" });
  }
});

// ===== POST /api/coach/profile — 更新教練個人資料 =====
router.post("/profile", authenticateToken, async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: "資料庫連接失敗" });
    }

    const {
      full_name,
      age,
      height_cm,
      weight_kg,
      experience_detail,
      certificate_files,
      bio,
      specialties,
      rate_per_session,
    } = req.body;

    // Build update object (only include provided fields)
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (age !== undefined) updates.age = parseInt(age);
    if (height_cm !== undefined) updates.height_cm = parseFloat(height_cm);
    if (weight_kg !== undefined) updates.weight_kg = parseFloat(weight_kg);
    if (experience_detail !== undefined)
      updates.experience_detail = experience_detail;
    if (certificate_files !== undefined)
      updates.certificate_files = certificate_files;
    if (bio !== undefined) updates.bio = bio;
    if (specialties !== undefined) updates.specialties = specialties;
    if (rate_per_session !== undefined)
      updates.rate_per_session = parseFloat(rate_per_session);
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("coaches")
      .update(updates)
      .eq("user_id", req.user.id)
      .select();

    if (error) throw error;

    res.json({ message: "個人資料已更新", coach: data?.[0] || null });
  } catch (err) {
    console.error("更新教練資料錯誤:", err);
    res.status(500).json({ success: false, error: "更新失敗：" + err.message });
  }
});

// ===== GET /api/coach/profile — 獲取教練個人資料 =====
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: "資料庫連接失敗" });
    }

    const { data, error } = await supabase
      .from("coaches")
      .select("*")
      .eq("user_id", req.user.id)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    res.json({ coach: data || null });
  } catch (err) {
    console.error("獲取教練資料錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取資料" });
  }
});

// ===== GET /api/coach/public-profile — 我嘅教練公開資料 =====
router.get("/public-profile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const u = db
      .prepare(
        "SELECT id, name, avatar_url, is_coach, coach_verified, coach_headline, coach_bio, coach_tags, coach_languages, coach_years FROM users WHERE id = ?",
      )
      .get(req.user.id);
    if (!u) return res.status(404).json({ success: false, error: "用戶不存在" });
    res.json({ success: true, data: u });
  } catch (err) {
    console.error("coach/public-profile GET error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取資料" });
  }
});

// ===== POST /api/coach/public-profile — 更新教練公開資料 =====
router.post("/public-profile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT is_coach FROM users WHERE id = ?").get(req.user.id);
    if (!u) return res.status(404).json({ success: false, error: "用戶不存在" });
    if (!u.is_coach) return res.status(403).json({ success: false, error: "只限已批核教練" });

    const { headline, bio, tags, languages, years, avatar_url } = req.body || {};
    const clean = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
    const join = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(",") : clean(v));
    const yrs = years === undefined || years === null || years === "" ? null : Math.max(0, Math.min(70, parseInt(years, 10) || 0));

    db.prepare(
      `UPDATE users SET coach_headline = COALESCE(?, coach_headline),
                        coach_bio = COALESCE(?, coach_bio),
                        coach_tags = COALESCE(?, coach_tags),
                        coach_languages = COALESCE(?, coach_languages),
                        coach_years = COALESCE(?, coach_years),
                        avatar_url = COALESCE(?, avatar_url),
                        updated_at = datetime('now')
       WHERE id = ?`,
    ).run(clean(headline), clean(bio), join(tags), join(languages), yrs, clean(avatar_url), req.user.id);

    res.json({ success: true, message: "✅ 教練資料已更新，會自動顯示於你嘅課程頁" });
  } catch (err) {
    console.error("coach/public-profile POST error:", err.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

// ===== POST /api/coach/classes — 教練自助開班（唔需要商戶）=====
router.post("/classes", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db.prepare("SELECT id, name, is_coach, coach_verified FROM users WHERE id = ?").get(req.user.id);
    if (!me) return res.status(404).json({ success: false, error: "用戶不存在" });
    if (!me.is_coach) return res.status(403).json({ success: false, error: "只限已批核教練開班，請先申請成為教練" });

    const {
      title, category, sport_slug, description, difficulty, duration,
      max_participants, price_hkd, credits_cost, target_audience, image_url,
      venue = {}, schedules,
    } = req.body || {};

    if (!title || !category || !duration) {
      return res.status(400).json({ success: false, error: "請填寫課程標題、類別及時長" });
    }
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({ success: false, error: "請至少新增一個上堂時段" });
    }
    if (schedules.length > 60) return res.status(400).json({ success: false, error: "一次最多 60 個時段" });

    let venueName = String(venue.name || "").trim();
    let venueAddress = String(venue.address || "").trim();
    let partnerVenueId = null;
    let district = "";

    if (venue.partner_venue_id) {
      const v = db
        .prepare("SELECT id, name, address, district FROM partner_venues WHERE id = ? AND status = 'active'")
        .get(venue.partner_venue_id);
      if (!v) return res.status(400).json({ success: false, error: "場地不存在或未開通" });
      partnerVenueId = v.id;
      venueName = v.name;
      venueAddress = v.address || "";
      const { resolveDistrict } = require("../services/district");
      district = resolveDistrict(v.district) || resolveDistrict([v.address, v.name].filter(Boolean).join(" ")) || "";
    } else {
      if (!venueName) return res.status(400).json({ success: false, error: "請選擇場地或填寫場地名稱" });
      const { resolveDistrict } = require("../services/district");
      district = resolveDistrict([venue.district, venueAddress, venueName].filter(Boolean).join(" ")) || "";
    }

    // 時段驗證
    const { v4: uuidv4 } = require("uuid");
    const now = Date.now();
    const maxAhead = now + 1000 * 60 * 60 * 24 * 92; // 約 3 個月
    for (const s of schedules) {
      const st = new Date(s.start_time).getTime();
      const et = new Date(s.end_time).getTime();
      if (!st || !et) return res.status(400).json({ success: false, error: "時段時間格式錯誤" });
      if (et <= st) return res.status(400).json({ success: false, error: "完結時間必須遲過開始時間" });
      if (st < now - 1000 * 60 * 5) return res.status(400).json({ success: false, error: "唔可以開過去嘅時段" });
      if (st > maxAhead) return res.status(400).json({ success: false, error: "只可以開未來 3 個月嘅班" });
    }

    const finalPrice = Number(price_hkd) || 0;
    const credits = Number(credits_cost) || Math.max(3, Math.round(finalPrice / 10));
    const classId = uuidv4();

    db.prepare(
      `INSERT INTO classes (id, coach_id, title, description, category, difficulty,
         duration, max_participants, price_hkd, credits_cost, venue_name, venue_address,
         target_audience, image_url, partner_venue_id, partner_id, district, sport_slug,
         status, booking_open, vip_priority_hours, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, datetime('now'), datetime('now'))`,
    ).run(
      classId, me.id, title, description || "", category, difficulty || "beginner",
      Number(duration), Number(max_participants) || 15, finalPrice, credits,
      venueName, venueAddress, target_audience || null, image_url || null,
      partnerVenueId, partnerVenueId, district || null, sport_slug || null,
      req.body.vip_priority_hours === 0 ? 0 : 24,
    );

    const ids = [];
    for (const s of schedules) {
      const sid = uuidv4();
      db.prepare(
        `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 'available', datetime('now'))`,
      ).run(sid, classId, s.start_time, s.end_time, Number(s.max_participants) || Number(max_participants) || 15);
      ids.push(sid);
    }

    res.status(201).json({
      success: true,
      message: "✅ 班已開，已出現在探索頁",
      data: { id: classId, schedules: ids.length, district: district || null },
    });
  } catch (err) {
    console.error("coach/classes POST error:", err.message);
    res.status(500).json({ success: false, error: "開班失敗：" + err.message });
  }
});

// ===== GET /api/coach/my-rating — 我嘅教練評分（階段 1：只自己睇）=====
router.get("/my-rating", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const { coachComposite, coachAggregate } = require("../services/mutual-review");
    const comp = coachComposite(req.user.id);
    const agg = coachAggregate(req.user.id);
    const summary = {
      score: comp.student_rating !== null && comp.student_rating !== undefined ? comp.student_rating : 0,
      raw_avg: agg.student.raw_avg,
      count: agg.student_count,
    };

    const dist = db
      .prepare(
        `SELECT rating, COUNT(*) c FROM mutual_reviews
         WHERE target_type='coach' AND target_id=? AND rater_role='student'
         GROUP BY rating ORDER BY rating DESC`,
      )
      .all(req.user.id);

    const recent = db
      .prepare(
        `SELECT rating, comment, created_at FROM mutual_reviews
         WHERE target_type='coach' AND target_id=? AND rater_role='student' AND comment <> ''
         ORDER BY created_at DESC LIMIT 10`,
      )
      .all(req.user.id)
      .map((r) => ({ ...r, student: "匿名學員" }));

    res.json({
      success: true,
      data: {
        ...summary,
        composite_score: comp.score,
        student_rating: comp.student_rating,
        venue_rating: comp.venue_rating,
        venue_rating_count: comp.venue_count,
        distribution: dist,
        recent,
        note:
          summary.count < 10
            ? "累積 10 個真實評價後，評分才會公開顯示於課程頁。"
            : "評分已達公開門檻。",
      },
    });
  } catch (err) {
    console.error("coach/my-rating error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取評分" });
  }
});

// ===== POST /api/coach/refer — 推薦新教練 =====
router.post("/refer", authenticateToken, (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email)
      return res.status(400).json({ success: false, error: "請填寫教練姓名和電郵" });

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // Log the referral
    db.prepare(
      `
      INSERT INTO referral_codes (id, user_id, code)
      VALUES (?, ?, ?)
    `,
    ).run(
      uuidv4(),
      req.user.id,
      "COACH-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
    );

    // Notify admins（原本用 user_id，永遠發唔出）
    try {
      const admins = db
        .prepare("SELECT id FROM users WHERE role IN ('admin','super_admin','platform_manager')")
        .all();
      for (const a of admins) {
        sendNotification("coach.referral", {
          recipient: a.id,
          data: {
            name,
            email,
            phone,
            referred_by: req.user.name || req.user.email || req.user.id,
          },
        });
      }
    } catch (e) {
      console.error("⚠️ coach referral notify failed:", e.message);
    }

    res.json({ success: true, message: "✅ 推薦已提交！管理員會聯絡 " + name });
  } catch (err) {
    console.error("Coach refer error:", err.message);
    res.status(500).json({ success: false, error: "推薦失敗" });
  }
});

module.exports = router;

// ===== GET /api/coach/class-students — 查看課程學生名單 =====
router.get("/class-students", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const { schedule_id } = req.query;

    // Verify coach owns this schedule's class
    const schedule = db
      .prepare("SELECT class_id FROM class_schedules WHERE id = ?")
      .get(schedule_id);
    if (!schedule) {

      return res.status(404).json({ success: false, error: "時段不存在" });
    }

    const classInfo = db
      .prepare("SELECT coach_id FROM classes WHERE id = ?")
      .get(schedule.class_id);
    if (!classInfo) {

      return res.status(404).json({ success: false, error: "課程不存在" });
    }

    // 權限：只有該班教練或管理員可以查看學生名單
    const me = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    const { hasMinimumRole } = require("../middleware/auth");
    const isAdmin = me && hasMinimumRole(me.role, "admin");
    if (!isAdmin && classInfo.coach_id !== req.user.id) {
      return res
        .status(403)
        .json({ success: false, error: "無權限查看此課程嘅學生名單" });
    }

    // Get students
    const students = db
      .prepare(
        `
      SELECT b.id, b.user_id, u.name, u.email, u.phone, b.status as booking_status,
             b.payment_status, b.created_at as booking_date
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE b.schedule_id = ? AND b.class_id = ?
      ORDER BY b.created_at DESC
    `,
      )
      .all(schedule_id, schedule.class_id);

    // Get schedule info
    const schedInfo = db
      .prepare(
        `
      SELECT cs.id, cs.start_time, cs.end_time, cs.enrolled_count, cs.max_participants,
             c.title, c.venue_name, c.venue_address
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      WHERE cs.id = ?
    `,
      )
      .get(schedule_id);

    res.json({ schedule: schedInfo, students, total: students.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/coach/venues — 可加入嘅商戶 + 我嘅狀態 =====
router.get("/venues", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const venues = db
      .prepare(
        "SELECT id, name, category, district, logo_url FROM partner_venues WHERE status = 'active' ORDER BY name",
      )
      .all();
    const mine = db
      .prepare("SELECT id, partner_id, status FROM partner_members WHERE user_id = ?")
      .all(req.user.id);
    const map = {};
    for (const m of mine) map[m.partner_id] = m;
    const out = venues.map((v) => ({
      ...v,
      my_status: (map[v.id] && map[v.id].status) || null,
      member_id: (map[v.id] && map[v.id].id) || null,
    }));
    res.json({ venues: out });
  } catch (err) {
    console.error("coach venues error:", err);
    res.status(500).json({ success: false, error: "無法取得商戶列表" });
  }
});

// ===== POST /api/coach/join-venue — 教練申請加入商戶 =====
router.post("/join-venue", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db
      .prepare("SELECT is_coach, coach_verified, role, name FROM users WHERE id = ?")
      .get(req.user.id);
    const okCoach =
      me &&
      (me.is_coach ||
        me.coach_verified ||
        me.role === "coach" ||
        me.role === "admin" ||
        me.role === "super_admin");
    if (!okCoach) {
      return res.status(403).json({ success: false, error: "只有教練可以申請加入商戶" });
    }
    const partnerId = String(req.body.partner_id || "");
    const venue = db
      .prepare(
        "SELECT id, name, owner_id, user_id FROM partner_venues WHERE id = ? AND status = 'active'",
      )
      .get(partnerId);
    if (!venue) {
      return res.status(404).json({ success: false, error: "商戶不存在或未開通" });
    }
    const existing = db
      .prepare("SELECT id, status FROM partner_members WHERE user_id = ? AND partner_id = ?")
      .get(req.user.id, venue.id);
    if (existing) {
      if (existing.status === "active") {
        return res.status(400).json({ success: false, error: "你已經加入咗呢個商戶" });
      }
      if (existing.status === "pending") {
        return res.status(400).json({ success: false, error: "你嘅申請待審批中" });
      }
      db.prepare(
        "UPDATE partner_members SET status = 'pending', updated_at = datetime('now') WHERE id = ?",
      ).run(existing.id);
    } else {
      db.prepare(
        `INSERT INTO partner_members (id, user_id, partner_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, 'coach', 'pending', datetime('now'), datetime('now'))`,
      ).run(uuidv4(), req.user.id, venue.id);
    }
    try {
      const ownerId = venue.owner_id || venue.user_id;
      if (ownerId) {
        dbNotification(
          ownerId,
          "partner.coach_request",
          "🧑‍🏫 新教練申請加入",
          `${me.name || "教練"} 申請加入「${venue.name}」`,
          { partner_id: venue.id },
        );
      }
    } catch (e) {}
    res.json({ ok: true, message: "已提交申請，待商戶審批" });
  } catch (err) {
    console.error("join-venue error:", err);
    res.status(500).json({ success: false, error: "申請失敗" });
  }
});
