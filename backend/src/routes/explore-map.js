/**
 * Phase 4.1 — LBS 地圖聚合＋臨期 Flash 價格
 * GET /api/public/explore/map-pins
 */
const express = require("express");
const { getDb } = require("../services/database");
const router = express.Router();

function ensureSchema(db) {
  const add = (table, cols) => {
    let have = [];
    try { have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); } catch (e) { return; }
    cols.forEach(([n, t]) => { if (!have.includes(n)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${n} ${t}`); });
  };
  add("merchant_studios", [["latitude", "REAL DEFAULT 22.2800"], ["longitude", "REAL DEFAULT 114.1700"], ["mtr_station", "TEXT"]]);
  add("venue_templates", [["latitude", "REAL DEFAULT 22.3500"], ["longitude", "REAL DEFAULT 114.1000"], ["mtr_station", "TEXT"]]);
  add("class_schedules", [["is_flash_sale_enabled", "INTEGER DEFAULT 1"], ["flash_price_cents", "INTEGER"]]);
  add("classes", [["latitude", "REAL"], ["longitude", "REAL"]]);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_studios_geo ON merchant_studios(status,latitude,longitude)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_schedules_flash ON class_schedules(start_time,booking_open,is_flash_sale_enabled)");
  } catch (e) {}
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getMapPins(db, opts) {
  ensureSchema(db);
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  const radiusKm = Number(opts.radius_km) || 3;
  const audience = String(opts.audience || "all");
  const where = [
    "datetime(s.start_time) > datetime('now')",
    "datetime(s.start_time) <= datetime('now','+12 hours')",
    "COALESCE(s.booking_open,c.booking_open,1)=1",
    "COALESCE(s.status,'') NOT IN ('cancelled','completed')",
    "s.id NOT LIKE 'prodtest-%'",
    "COALESCE(c.class_reference,'') NOT LIKE 'VERIFIED_TEST%'",
    "COALESCE(c.partner_venue_id,'') <> 'seed-sandbox-venue'",
    "COALESCE(s.enrolled_count,0) < COALESCE(s.max_participants,c.max_participants,20)",
  ];
  const params = [];
  if (["elderly", "office_worker", "postnatal", "active_50plus", "general_fitness"].includes(audience)) {
    where.push("c.target_audience_enum=?");
    params.push(audience);
  }
  const rows = db.prepare(
    `SELECT s.id AS schedule_id, s.start_time, s.end_time,
            COALESCE(s.max_participants,c.max_participants,20) AS capacity,
            COALESCE(s.enrolled_count,0) AS enrolled,
            COALESCE(s.max_participants,c.max_participants,20)-COALESCE(s.enrolled_count,0) AS remaining_seats,
            COALESCE(s.is_flash_sale_enabled,1) AS flash_enabled, s.flash_price_cents,
            c.title AS course_title, c.target_audience_enum, c.target_audience_label,
            COALESCE(c.price_hkd_cents,CAST(ROUND(COALESCE(c.price_hkd,0)*100) AS INTEGER)) AS price_cents,
            COALESCE(c.venue_name,'') AS venue_name, c.latitude AS class_lat, c.longitude AS class_lng,
            ms.id AS studio_id, ms.studio_name, ms.latitude AS studio_lat, ms.longitude AS studio_lng,
            ms.mtr_station, ms.facilities AS studio_facilities
       FROM class_schedules s JOIN classes c ON c.id=s.class_id
       LEFT JOIN merchant_studios ms ON ms.id=s.studio_id
      WHERE ${where.join(" AND ")}
      ORDER BY datetime(s.start_time) ASC LIMIT 300`,
  ).all(...params);

  const now = Date.now();
  const groups = new Map();
  for (const r of rows) {
    const useStudio = r.studio_id && r.studio_lat != null && r.studio_lng != null;
    const rlat = Number(useStudio ? r.studio_lat : r.class_lat);
    const rlng = Number(useStudio ? r.studio_lng : r.class_lng);
    if (!Number.isFinite(rlat) || !Number.isFinite(rlng) || (rlat === 0 && rlng === 0)) continue;
    const distKm = Number.isFinite(lat) && Number.isFinite(lng) ? haversineKm(lat, lng, rlat, rlng) : null;
    if (distKm != null && distKm > radiusKm) continue;
    const minutes = Math.max(0, Math.round((new Date(r.start_time.replace(" ", "T") + "Z").getTime() - now) / 60000));
    const flash = Number(r.flash_enabled) === 1 && minutes <= 180 && Number(r.remaining_seats) > 0;
    const effective = flash ? Number(r.flash_price_cents) || Math.round(Number(r.price_cents) * 0.8) : Number(r.price_cents);
    const key = r.studio_id || r.venue_name || r.schedule_id;
    if (!groups.has(key)) {
      groups.set(key, {
        studio_id: r.studio_id || null,
        studio_name: r.studio_name || r.venue_name || "運動場地",
        latitude: rlat,
        longitude: rlng,
        mtr_station: r.mtr_station || "",
        facilities: (() => { try { return JSON.parse(r.studio_facilities || "[]"); } catch (e) { return []; } })(),
        distance_meters: distKm == null ? null : Math.round(distKm * 1000),
        active_classes_count: 0,
        classes: [],
      });
    }
    const g = groups.get(key);
    g.classes.push({
      schedule_id: r.schedule_id,
      course_title: r.course_title,
      target_audience_enum: r.target_audience_enum,
      target_audience_label: r.target_audience_label,
      start_time: r.start_time,
      end_time: r.end_time,
      remaining_seats: Number(r.remaining_seats),
      capacity: Number(r.capacity),
      original_price_cents: Number(r.price_cents),
      effective_price_cents: effective,
      is_flash_sale: flash,
      time_to_start_minutes: minutes,
      can_use_pass: true,
    });
    g.active_classes_count++;
  }
  const out = [...groups.values()].sort((a, b) => (a.distance_meters ?? 1e12) - (b.distance_meters ?? 1e12));
  return { studios_with_classes: out, count: out.length };
}

router.get("/map-pins", (req, res) => {
  try {
    const r = getMapPins(getDb(), req.query || {});
    res.json({ success: true, ...r });
  } catch (e) {
    console.error("[MAP] pins:", e.message);
    res.status(500).json({ success: false, error: "地圖資料載入失敗" });
  }
});
module.exports = router;
module.exports.ensureSchema = ensureSchema;
module.exports.getMapPins = getMapPins;
module.exports.haversineKm = haversineKm;
