/**
 * Phase 2.4 — 教練極簡排班（範本、快速開班、防撞期）
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { resolveDistrict } = require("../services/district");

const router = express.Router();

const AUDIENCES = new Set(["elderly", "office_worker", "postnatal", "active_50plus", "general_fitness"]);

function ensureSchedulingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS venue_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      district TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      default_capacity INTEGER DEFAULT 8,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS course_templates (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      title TEXT NOT NULL,
      target_audience_enum TEXT NOT NULL DEFAULT 'general_fitness',
      target_audience_label TEXT,
      default_price_cents INTEGER DEFAULT 14000,
      default_duration_minutes INTEGER DEFAULT 60,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_course_templates_coach ON course_templates(coach_id);
  `);
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  if (!cols.includes("coach_id")) db.exec("ALTER TABLE class_schedules ADD COLUMN coach_id TEXT");
  if (!cols.includes("created_by_coach_id")) db.exec("ALTER TABLE class_schedules ADD COLUMN created_by_coach_id TEXT");
  try {
    db.exec("UPDATE class_schedules SET coach_id=(SELECT c.coach_id FROM classes c WHERE c.id=class_schedules.class_id) WHERE coach_id IS NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_schedules_coach_time ON class_schedules(coach_id,start_time,end_time,status)");
  } catch (e) {}
  try {
    db.exec(`
      INSERT OR IGNORE INTO venue_templates (id,name,district,address,default_capacity)
      SELECT 'vt_'||id, name, COALESCE(district,''), COALESCE(address,''), 8
        FROM partner_venues WHERE COALESCE(status,'active')='active'
    `);
  } catch (e) {}
}

function parseHkt(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "+08:00";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function toUtc(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

router.get("/schedule-presets", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchedulingSchema(db);
    const courses = db
      .prepare("SELECT * FROM course_templates WHERE coach_id=? ORDER BY datetime(created_at) DESC LIMIT 30")
      .all(req.user.id);
    const venues = db
      .prepare("SELECT * FROM venue_templates ORDER BY district,name LIMIT 200")
      .all();
    const recent = db
      .prepare(
        `SELECT s.id AS schedule_id, c.title AS course_title, c.target_audience_enum, c.target_audience_label,
                c.venue_name, COALESCE(s.district,c.district) AS district, s.max_participants AS capacity,
                CAST(ROUND(COALESCE(c.price_hkd,0)*100) AS INTEGER) AS price_cents,
                s.start_time, s.end_time
           FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE COALESCE(s.coach_override_id,s.coach_id,c.coach_id)=?
          ORDER BY datetime(s.start_time) DESC LIMIT 10`,
      )
      .all(req.user.id);
    res.json({ success: true, courses, venues, recent });
  } catch (e) {
    console.error("[SCHED] presets:", e.message);
    res.status(500).json({ success: false, error: "讀取範本失敗" });
  }
});

router.post("/schedules/create", authenticateToken, (req, res) => {
  let inTx = false;
  try {
    const db = getDb();
    ensureSchedulingSchema(db);
    const me = db.prepare("SELECT id,name,is_coach,coach_verified FROM users WHERE id=?").get(req.user.id);
    if (!me || !me.is_coach) return res.status(403).json({ success: false, error: "只限已批核教練開班" });
    if (me.coach_verified === 0) return res.status(403).json({ success: false, error: "教練資質尚未核實" });

    const b = req.body || {};
    const title = String(b.course_title || b.title || "").trim();
    if (title.length < 2) return res.status(400).json({ success: false, error: "請填課程名稱" });
    const audience = String(b.target_audience_enum || "general_fitness");
    if (!AUDIENCES.has(audience)) return res.status(400).json({ success: false, error: "受眾標籤無效" });
    const label = String(b.target_audience_label || "大眾體適能").slice(0, 60);
    const venueName = String(b.venue_name || "").trim();
    if (!venueName) return res.status(400).json({ success: false, error: "請選擇場地" });

    const start = parseHkt(b.start_time);
    const end = parseHkt(b.end_time);
    if (!start || !end) return res.status(400).json({ success: false, error: "時間格式錯誤" });
    if (end <= start) return res.status(400).json({ success: false, error: "完結時間必須遲過開始時間" });
    if (start.getTime() < Date.now() + 12 * 3600000) {
      return res.status(400).json({ success: false, error: "開班時間必須至少提前 12 小時" });
    }
    if (start.getTime() > Date.now() + 92 * 86400000) {
      return res.status(400).json({ success: false, error: "只可開未來 3 個月內的班" });
    }

    const capacity = Number(b.capacity || 8);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      return res.status(400).json({ success: false, error: "人數上限必須 1–50" });
    }
    const priceCents = Number(b.price_per_class_cents || b.price_cents || 0);
    if (!Number.isInteger(priceCents) || priceCents < 10000 || priceCents > 25000) {
      return res.status(400).json({ success: false, error: "單堂定價必須 HK$100–250" });
    }

    const st = toUtc(start);
    const et = toUtc(end);
    const district = resolveDistrict(String(b.district || "") + " " + venueName) || String(b.district || "");

    // 防撞期：同一教練重疊
    const clash = db
      .prepare(
        `SELECT s.id,c.title,s.start_time,s.end_time FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE COALESCE(s.coach_override_id,s.coach_id,c.coach_id)=?
            AND COALESCE(s.status,'') <> 'cancelled'
            AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?)
          LIMIT 1`,
      )
      .get(req.user.id, et, st);
    if (clash) {
      return res.status(409).json({
        success: false,
        code: "CONFLICT",
        error: `您在該時段已有其他課堂排程（${clash.title} ${clash.start_time}）`,
      });
    }
    // 同一場地重疊
    const venueClash = db
      .prepare(
        `SELECT s.id,c.title,s.start_time FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE COALESCE(s.status,'') <> 'cancelled' AND c.venue_name=?
            AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?)
          LIMIT 1`,
      )
      .get(venueName, et, st);
    if (venueClash) {
      return res.status(409).json({
        success: false,
        code: "VENUE_CONFLICT",
        error: `場地該時段已被佔用（${venueClash.title}）`,
      });
    }

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    let cls = db
      .prepare(
        `SELECT * FROM classes WHERE coach_id=? AND title=? AND COALESCE(venue_name,'')=? AND status='active' LIMIT 1`,
      )
      .get(req.user.id, title, venueName);
    let classId = cls ? cls.id : uuidv4();
    if (!cls) {
      const duration = Math.max(1, Math.round((end - start) / 60000));
      const credits = Math.max(1, Math.round(priceCents / 1000));
      db.prepare(
        `INSERT INTO classes
           (id,coach_id,title,description,category,duration,max_participants,price_hkd,price_hkd_cents,credits_cost,
            venue_name,venue_address,target_audience,target_audience_enum,target_audience_label,district,
            status,booking_open,min_participants,created_at,updated_at)
         VALUES (?,?,?,?, 'fitness', ?,?,?,?,?, ?,?,?,?,?,?, 'active',1,1,datetime('now'),datetime('now'))`,
      ).run(
        classId,
        req.user.id,
        title,
        String(b.description || "").slice(0, 1000),
        duration,
        capacity,
        priceCents / 100,
        priceCents,
        credits,
        venueName,
        String(b.venue_address || "").slice(0, 200),
        label,
        audience,
        label,
        district || null,
      );
    } else {
      db.prepare(
        "UPDATE classes SET booking_open=1, status='active', target_audience_enum=?, target_audience_label=?, max_participants=?, price_hkd=?, price_hkd_cents=? WHERE id=?",
      ).run(audience, label, capacity, priceCents / 100, priceCents, classId);
    }

    const scheduleId = uuidv4();
    db.prepare(
      `INSERT INTO class_schedules
         (id,class_id,coach_id,created_by_coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district,created_at)
       VALUES (?,?,?,?,?,?,?,0,'available',1,?,datetime('now'))`,
    ).run(scheduleId, classId, req.user.id, req.user.id, st, et, capacity, district || null);
    const tpl = db
      .prepare("SELECT id FROM course_templates WHERE coach_id=? AND title=? LIMIT 1")
      .get(req.user.id, title);
    if (!tpl) {
      db.prepare(
        `INSERT INTO course_templates
           (id,coach_id,title,target_audience_enum,target_audience_label,default_price_cents,default_duration_minutes,description)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        "ct_" + uuidv4().replace(/-/g, "").slice(0, 16),
        req.user.id,
        title,
        audience,
        label,
        priceCents,
        Math.max(1, Math.round((end - start) / 60000)),
        String(b.description || "").slice(0, 500),
      );
    }
    db.exec("COMMIT");
    inTx = false;
    try {
      require("../services/audit").audit({
        actionType: "coach.schedule_created",
        entityType: "class_schedule",
        entityId: scheduleId,
        userId: req.user.id,
        newValues: { class_id: classId, start_time: st, end_time: et, capacity, price_cents: priceCents, audience, district },
        description: `教練自助開班：${title}`,
      });
    } catch (e) {}
    res.status(201).json({
      success: true,
      class_id: classId,
      schedule_id: scheduleId,
      booking_open: 1,
      message: "已發布，並同步至探索大廳",
    });
  } catch (e) {
    if (inTx) { try { getDb().exec("ROLLBACK"); } catch (x) {} }
    console.error("[SCHED] create:", e.message);
    res.status(500).json({ success: false, error: "開班失敗" });
  }
});

module.exports = router;
module.exports.ensureSchedulingSchema = ensureSchedulingSchema;
