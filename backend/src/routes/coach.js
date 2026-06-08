/**
 * ZenPass 禪流 - 教練路由
 * 教練申請、管理課程
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const { getSupabase } = require("../services/supabase");
const { sendNotification } = require("../services/notification");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

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
    } = req.body;

    if (!name || !phone || !email || !venue_address) {
      return res.status(400).json({ error: "請填寫姓名、電話、電郵和住址" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 檢查是否已有申請
    const existing = db
      .prepare(
        "SELECT id FROM coach_applications WHERE user_id = ? AND status = 'pending'",
      )
      .get(req.user.id);

    if (existing) {
      db.close();
      return res.status(409).json({ error: "你已經有進行中的申請" });
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
    const dbCA = new Database(DB_PATH);
    const maxCA =
      dbCA
        .prepare(
          "SELECT MAX(CAST(SUBSTR(application_reference, 4) AS INTEGER)) as m FROM coach_applications WHERE application_reference GLOB 'CA-[0-9]*'",
        )
        .get().m || 0;
    const appRef = "CA-" + String(maxCA + 1).padStart(4, "0");
    dbCA.close();

    db.prepare(
      `
      INSERT INTO coach_applications 
        (id, user_id, name, phone, email, years_experience, specialties, 
         certificates, bio, venue_name, venue_address, venue_photos, facilities,
         application_reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );

    db.close();

    res.status(201).json({
      message: "申請已提交，我們將在 3 個工作日內完成審批",
      application_id: id,
    });
  } catch (err) {
    console.error("教練申請錯誤:", err);
    res.status(500).json({ error: "提交申請失敗" });
  }
});

// ===== GET /api/coach/application — 查詢申請狀態 =====
router.get("/application", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const application = db
      .prepare(
        `
      SELECT * FROM coach_applications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(req.user.id);

    db.close();

    if (!application) {
      return res.json({ application: null });
    }

    res.json({ application });
  } catch (err) {
    console.error("查詢申請錯誤:", err);
    res.status(500).json({ error: "無法查詢申請狀態" });
  }
});

// ===== GET /api/coach/my-classes — 我的課程 =====
router.get("/my-classes", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const classes = db
      .prepare(
        `
      SELECT c.*, 
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'confirmed') as upcoming_bookings,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'attended') as total_attended
      FROM classes c
      WHERE c.coach_id = ?
      ORDER BY c.created_at DESC
    `,
      )
      .all(req.user.id);

    db.close();

    res.json({ classes });
  } catch (err) {
    console.error("獲取課程錯誤:", err);
    res.status(500).json({ error: "無法獲取課程列表" });
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
      return res.status(400).json({ error: "請填寫課程、開始時間和結束時間" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Verify ownership
    const classData = db
      .prepare("SELECT * FROM classes WHERE id = ? AND coach_id = ?")
      .get(class_id, req.user.id);
    if (!classData) {
      db.close();
      return res.status(403).json({ error: "你無權限操作此課程" });
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

    db.close();

    res.status(201).json({
      message: `時間已新增（共 ${scheduleIds.length} 個時段）`,
      schedule_ids: scheduleIds,
      count: scheduleIds.length,
    });
  } catch (err) {
    console.error("新增時間錯誤:", err);
    res.status(500).json({ error: "無法新增時間" });
  }
});

// ===== POST /api/coach/profile — 更新教練個人資料 =====
router.post("/profile", authenticateToken, async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: "資料庫連接失敗" });
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
    res.status(500).json({ error: "更新失敗：" + err.message });
  }
});

// ===== GET /api/coach/profile — 獲取教練個人資料 =====
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: "資料庫連接失敗" });
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
    res.status(500).json({ error: "無法獲取資料" });
  }
});

// ===== POST /api/coach/refer — 推薦新教練 =====
router.post("/refer", authenticateToken, (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email)
      return res.status(400).json({ error: "請填寫教練姓名和電郵" });

    const db = new Database(DB_PATH);
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

    // Notify admin
    sendNotification("coach.referral", {
      user_id: req.user.id,
      data: { name, email, phone, referred_by: req.user.name },
    });

    db.close();
    res.json({ success: true, message: "✅ 推薦已提交！管理員會聯絡 " + name });
  } catch (err) {
    console.error("Coach refer error:", err.message);
    res.status(500).json({ error: "推薦失敗" });
  }
});

module.exports = router;

// ===== GET /api/coach/class-students — 查看課程學生名單 =====
router.get("/class-students", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const { schedule_id } = req.query;

    // Verify coach owns this schedule's class
    const schedule = db
      .prepare("SELECT class_id FROM class_schedules WHERE id = ?")
      .get(schedule_id);
    if (!schedule) {
      db.close();
      return res.status(404).json({ error: "時段不存在" });
    }

    const classInfo = db
      .prepare("SELECT coach_id FROM classes WHERE id = ?")
      .get(schedule.class_id);
    if (!classInfo) {
      db.close();
      return res.status(404).json({ error: "課程不存在" });
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

    db.close();
    res.json({ schedule: schedInfo, students, total: students.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
