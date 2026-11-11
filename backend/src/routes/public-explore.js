/**
 * Phase 2.2 — 零售課堂探索大廳（公開）
 * GET /api/public/explore/classes
 */
const express = require("express");
const { getDb } = require("../services/database");

const router = express.Router();

const DISTRICTS = {
  cw: "中西區", wc: "灣仔", east: "東區", south: "南區",
  ytm: "油尖旺", ssp: "深水埗", kc: "九龍城", wts: "黃大仙",
  kt: "觀塘", kts: "葵青", tw: "荃灣", tm: "屯門",
  yl: "元朗", north: "北區", tp: "大埔", st: "沙田",
  sk: "西貢", islands: "離島",
};

const AUDIENCES = new Set(["elderly", "office_worker", "postnatal", "active_50plus", "general_fitness"]);

function ensureExploreSchema(db) {
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  if (!ccols.includes("target_audience_enum")) db.exec("ALTER TABLE classes ADD COLUMN target_audience_enum TEXT");
  if (!ccols.includes("target_audience_label")) db.exec("ALTER TABLE classes ADD COLUMN target_audience_label TEXT");
  if (!ccols.includes("class_reference")) db.exec("ALTER TABLE classes ADD COLUMN class_reference TEXT");
  if (!ccols.includes("price_hkd_cents")) db.exec("ALTER TABLE classes ADD COLUMN price_hkd_cents INTEGER");
  if (!ccols.includes("district")) db.exec("ALTER TABLE classes ADD COLUMN district TEXT");
  if (!ccols.includes("booking_open")) db.exec("ALTER TABLE classes ADD COLUMN booking_open INTEGER DEFAULT 1");
  if (!ccols.includes("is_private")) db.exec("ALTER TABLE classes ADD COLUMN is_private INTEGER DEFAULT 0");
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  if (!cols.includes("district")) db.exec("ALTER TABLE class_schedules ADD COLUMN district TEXT");
  if (!cols.includes("booking_open")) db.exec("ALTER TABLE class_schedules ADD COLUMN booking_open INTEGER");
  try {
    db.exec(`
      UPDATE class_schedules
         SET district = (SELECT c.district FROM classes c WHERE c.id = class_schedules.class_id)
       WHERE district IS NULL OR district = '';
    `);
    db.exec(`
      UPDATE class_schedules
         SET booking_open = (SELECT COALESCE(c.booking_open,1) FROM classes c WHERE c.id = class_schedules.class_id)
       WHERE booking_open IS NULL;
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_schedules_explore ON class_schedules(booking_open, start_time)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_schedules_district_time ON class_schedules(district, start_time)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_classes_audience_district ON classes(target_audience_enum, district, booking_open)");
  } catch (e) {
    console.error("[EXPLORE] index:", e.message);
  }
}

function normalizeDistrict(raw) {
  const v = String(raw || "").trim();
  if (!v || v === "all") return null;
  if (DISTRICTS[v]) return DISTRICTS[v];
  const found = Object.values(DISTRICTS).find((d) => d === v);
  return found || v;
}

function listExplore(db, opts) {
    const audience = String((opts && opts.audience) || "all");
    const district = normalizeDistrict(opts && opts.district);
    const date = String((opts && opts.date) || "all");
    const limit = Math.min(Math.max(Number(opts && opts.limit) || 60, 1), 100);

    const where = [
      "COALESCE(s.status,'scheduled') NOT IN ('cancelled','completed')",
      "COALESCE(c.status,'active') = 'active'",
      "COALESCE(c.is_private,0) = 0",
      "COALESCE(s.booking_open, c.booking_open, 1) = 1",
      "datetime(s.start_time) > datetime('now','+2 hours')",
      "s.id NOT LIKE 'prodtest-%'",
      "COALESCE(c.class_reference,'') NOT LIKE 'VERIFIED_TEST%'",
    ];
    const params = [];
    if (AUDIENCES.has(audience)) {
      where.push("c.target_audience_enum = ?");
      params.push(audience);
    }
    if (district) {
      where.push("COALESCE(s.district, c.district) = ?");
      params.push(district);
    }
    if (date === "today") {
      where.push("date(s.start_time,'+8 hours') = date('now','+8 hours')");
    } else if (date === "this_week") {
      where.push("datetime(s.start_time) <= datetime('now','+7 days')");
    }

    const rows = db
      .prepare(
        `SELECT
           s.id AS schedule_id,
           c.id AS class_id,
           c.title AS course_title,
           COALESCE(c.target_audience_enum,'general_fitness') AS target_audience_enum,
           COALESCE(NULLIF(c.target_audience_label,''), NULLIF(c.target_audience,''), '大眾體適能') AS target_audience_label,
           COALESCE(s.district, c.district, '') AS district,
           COALESCE(c.venue_name, '') AS venue_name,
           s.start_time,
           s.end_time,
           COALESCE(u.name, '') AS coach_name,
           COALESCE(c.price_hkd_cents, CAST(ROUND(COALESCE(c.price_hkd,0)*100) AS INTEGER)) AS price_cents,
           COALESCE(s.max_participants, c.max_participants, 20) AS capacity,
           COALESCE(s.enrolled_count, 0) AS enrolled_count,
           COALESCE(s.max_participants, c.max_participants, 20) - COALESCE(s.enrolled_count, 0) AS remaining_seats,
           c.sport_slug,
           c.image_url
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN users u ON u.id = COALESCE(s.coach_override_id, c.coach_id)
         WHERE ${where.join(" AND ")}
           AND COALESCE(s.max_participants, c.max_participants, 20) > COALESCE(s.enrolled_count, 0)
         ORDER BY datetime(s.start_time) ASC
         LIMIT ?`,
      )
      .all(...params, limit);

    return {
      success: true,
      classes: rows.map((r) => ({ ...r, can_use_pass: true })),
      filters: { audience, district: district || "all", date },
    };
}

router.get("/classes", (req, res) => {
  try {
    const db = getDb();
    ensureExploreSchema(db);
    res.json(listExplore(db, req.query));
  } catch (e) {
    console.error("[EXPLORE] classes:", e.message);
    res.status(500).json({ success: false, error: "探索列表載入失敗" });
  }
});

module.exports = router;
module.exports.ensureExploreSchema = ensureExploreSchema;
module.exports.DISTRICTS = DISTRICTS;
module.exports.listExplore = listExplore;
