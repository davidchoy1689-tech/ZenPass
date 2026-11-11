/**
 * Phase 3.1 — Studio 商戶入駐、空位拋售
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { resolveDistrict } = require("../services/district");
const { audit } = require("../services/audit");
const studioLedger = require("../services/studio-ledger");
const coachScheduling = require("../routes/coach-scheduling");

const router = express.Router();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchant_studios (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      studio_name TEXT NOT NULL,
      business_reg_no TEXT,
      district TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      category_tags TEXT NOT NULL DEFAULT '[]',
      facilities TEXT NOT NULL DEFAULT '[]',
      payout_fps_id TEXT NOT NULL DEFAULT '',
      payout_bank_account TEXT,
      platform_commission_rate REAL DEFAULT 0.15,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS studio_coaches (
      id TEXT PRIMARY KEY,
      studio_id TEXT NOT NULL,
      coach_user_id TEXT NOT NULL,
      role_title TEXT DEFAULT 'Instructor',
      coach_payout_rate REAL DEFAULT 0.50,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(studio_id, coach_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_merchant_district ON merchant_studios(district,status);
  `);
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  if (!cols.includes("studio_id")) db.exec("ALTER TABLE class_schedules ADD COLUMN studio_id TEXT");
  if (!cols.includes("is_dropin_enabled")) db.exec("ALTER TABLE class_schedules ADD COLUMN is_dropin_enabled INTEGER DEFAULT 0");
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_schedules_studio ON class_schedules(studio_id,is_dropin_enabled,start_time)");
  } catch (e) {}
  coachScheduling.ensureSchedulingSchema(db);
  studioLedger.ensureSchema(db);
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  if (!bcols.includes("attendee_type")) db.exec("ALTER TABLE bookings ADD COLUMN attendee_type TEXT");
}

function ownerOf(db, studioId, userId) {
  return db.prepare("SELECT * FROM merchant_studios WHERE id=? AND owner_user_id=? AND status='active'").get(studioId, userId);
}

router.post("/merchant/studios/register", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = req.body || {};
    const name = String(b.studio_name || "").trim();
    if (name.length < 2) return res.status(400).json({ success: false, error: "請填門店名稱" });
    const phone = String(b.contact_phone || "").replace(/\D/g, "");
    if (!/^[4-9]\d{7}$/.test(phone)) return res.status(400).json({ success: false, error: "請填有效香港電話" });
    const address = String(b.address || "").trim();
    if (address.length < 5) return res.status(400).json({ success: false, error: "請填門店地址" });
    const district = resolveDistrict(String(b.district || "") + " " + address) || String(b.district || "");
    const tags = Array.isArray(b.category_tags) ? b.category_tags : [];
    const id = "std_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO merchant_studios
         (id,owner_user_id,studio_name,business_reg_no,district,address,contact_phone,category_tags,facilities,payout_fps_id,payout_bank_account,platform_commission_rate,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
    ).run(
      id,
      req.user.id,
      name,
      String(b.business_reg_no || "").slice(0, 40),
      district,
      address,
      phone,
      JSON.stringify(tags.slice(0, 12)),
      JSON.stringify(Array.isArray(b.facilities) ? b.facilities.slice(0, 12) : []),
      String(b.payout_fps_id || "").slice(0, 80),
      String(b.payout_bank_account || "").slice(0, 80),
      Number(b.platform_commission_rate) > 0 ? Math.min(0.3, Number(b.platform_commission_rate)) : 0.15,
    );
    db.prepare(
      `INSERT OR IGNORE INTO studio_coaches (id,studio_id,coach_user_id,role_title,coach_payout_rate,status)
       VALUES (?,?,?, 'Admin', 0.5, 'active')`,
    ).run("sc_" + crypto.randomBytes(8).toString("hex"), id, req.user.id);
    try {
      audit({
        actionType: "studio.registered",
        entityType: "merchant_studio",
        entityId: id,
        userId: req.user.id,
        newValues: { studio_name: name, district, tags },
        description: "商戶門店入駐",
      });
    } catch (e) {}
    res.status(201).json({ success: true, studio_id: id, studio: db.prepare("SELECT * FROM merchant_studios WHERE id=?").get(id) });
  } catch (e) {
    console.error("[STUDIO] register:", e.message);
    res.status(500).json({ success: false, error: "入駐失敗" });
  }
});

router.get("/merchant/my-studios", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const rows = db.prepare("SELECT * FROM merchant_studios WHERE owner_user_id=? ORDER BY datetime(created_at) DESC").all(req.user.id);
    const month = new Date().toISOString().slice(0, 7);
    const data = rows.map((s) => {
      const today = db
        .prepare(
          `SELECT COUNT(*) pushed, COALESCE(SUM(CASE WHEN booked > 0 THEN 1 ELSE 0 END),0) classes_booked
             FROM (SELECT s.id, (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status<>'cancelled') booked
                     FROM class_schedules s WHERE s.studio_id=? AND date(s.start_time,'+8 hours')=date('now','+8 hours'))`,
        )
        .get(s.id);
      const sum = studioLedger.monthSummary(s.id, month);
      return { ...s, category_tags: JSON.parse(s.category_tags || "[]"), facilities: JSON.parse(s.facilities || "[]"), today, month };
    });
    res.json({ success: true, studios: data });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取門店失敗" });
  }
});

router.post("/merchant/schedules/push-capacity", authenticateToken, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    ensureSchema(db);
    const b = req.body || {};
    const studio = ownerOf(db, String(b.studio_id || ""), req.user.id);
    if (!studio) return res.status(403).json({ success: false, error: "無權操作此門店", code: "FORBIDDEN" });
    const title = String(b.course_title || "").trim();
    if (title.length < 2) return res.status(400).json({ success: false, error: "請填課程名稱" });
    const capacity = Number(b.dropin_capacity || 0);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) return res.status(400).json({ success: false, error: "拋售名額 1–50" });
    const price = Number(b.price_per_class_cents || 0);
    if (!Number.isInteger(price) || price < 10000 || price > 50000) return res.status(400).json({ success: false, error: "單堂定價 HK$100–500" });
    const start = new Date(String(b.start_time || "").replace(" ", "T"));
    const end = new Date(String(b.end_time || "").replace(" ", "T"));
    if (isNaN(start) || isNaN(end) || end <= start) return res.status(400).json({ success: false, error: "時間格式錯誤" });
    if (start.getTime() < Date.now() + 3 * 3600000) return res.status(400).json({ success: false, error: "需至少提前 3 小時拋售" });
    const coachId = String(b.coach_user_id || req.user.id);
    const rel = db.prepare("SELECT * FROM studio_coaches WHERE studio_id=? AND coach_user_id=? AND status='active'").get(studio.id, coachId);
    if (!rel) return res.status(403).json({ success: false, error: "此教練未掛靠門店", code: "COACH_NOT_IN_STUDIO" });

    const st = start.toISOString().slice(0, 19).replace("T", " ");
    const et = end.toISOString().slice(0, 19).replace("T", " ");
    const clash = db
      .prepare(
        `SELECT s.id,c.title FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE COALESCE(s.coach_override_id,s.coach_id,c.coach_id)=? AND COALESCE(s.status,'')<>'cancelled'
            AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?) LIMIT 1`,
      )
      .get(coachId, et, st);
    if (clash) return res.status(409).json({ success: false, code: "CONFLICT", error: `教練時段重疊（${clash.title}）` });
    const venueClash = db
      .prepare(
        `SELECT s.id,c.title FROM class_schedules s JOIN classes c ON c.id=s.class_id
          WHERE s.studio_id=? AND COALESCE(s.status,'')<>'cancelled'
            AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?) LIMIT 1`,
      )
      .get(studio.id, et, st);
    if (venueClash) return res.status(409).json({ success: false, code: "VENUE_CONFLICT", error: `場地時段重疊（${venueClash.title}）` });

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    const classId = crypto.randomUUID();
    const scheduleId = crypto.randomUUID();
    const duration = Math.round((end - start) / 60000);
    db.prepare(
      `INSERT INTO classes
         (id,coach_id,title,category,duration,max_participants,price_hkd,price_hkd_cents,credits_cost,
          venue_name,venue_address,district,target_audience,target_audience_enum,target_audience_label,
          status,booking_open,created_at,updated_at)
       VALUES (?,?,?, 'studio', ?,?,?,?,?, ?,?,?,?,?,?, 'active',1,datetime('now'),datetime('now'))`,
    ).run(
      classId, coachId, title, duration, capacity, price / 100, price, Math.max(1, Math.round(price / 1000)),
      studio.studio_name, studio.address, studio.district,
      String(b.target_audience_label || "大眾體適能"),
      String(b.target_audience_enum || "general_fitness"),
      String(b.target_audience_label || "大眾體適能"),
    );
    db.prepare(
      `INSERT INTO class_schedules
         (id,class_id,coach_id,created_by_coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district,studio_id,is_dropin_enabled,created_at)
       VALUES (?,?,?,?,?,?,?,0,'available',1,?,?,1,datetime('now'))`,
    ).run(scheduleId, classId, coachId, req.user.id, st, et, capacity, studio.district, studio.id);
    db.exec("COMMIT");
    inTx = false;
    try {
      audit({
        actionType: "studio.capacity_pushed",
        entityType: "class_schedule",
        entityId: scheduleId,
        userId: req.user.id,
        newValues: { studio_id: studio.id, capacity, price_cents: price, coach_id: coachId },
        description: "商戶拋售剩餘名額",
      });
    } catch (e) {}
    res.status(201).json({ success: true, class_id: classId, schedule_id: scheduleId, dropin_capacity: capacity });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    console.error("[STUDIO] push:", e.message);
    res.status(500).json({ success: false, error: "拋售失敗" });
  }
});

router.get("/merchant/studios/:id/statement.csv", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const studio = ownerOf(db, req.params.id, req.user.id);
    if (!studio) return res.status(403).json({ success: false, error: "無權查看此門店報表" });
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    const rows = db
      .prepare(
        `SELECT l.*, s.id AS sid, c.class_reference, c.title
           FROM studio_earnings_ledger l
           JOIN class_schedules s ON s.id=l.schedule_id
           JOIN classes c ON c.id=s.class_id
          WHERE l.studio_id=? AND l.payout_month=?
            AND s.id NOT LIKE 'prodtest-%'
            AND COALESCE(c.class_reference,'') NOT LIKE 'VERIFIED_TEST%'
          ORDER BY datetime(l.created_at)`,
      )
      .all(studio.id, month);
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [
      ["Studio Name", "Month", "Date", "Class", "Gross HK$", "Platform Fee HK$", "Coach Payout HK$", "Studio Payout HK$"].map(q).join(","),
      ...rows.map((r) => [studio.studio_name, month, String(r.created_at || "").slice(0, 10), r.title,
        (r.gross_cents / 100).toFixed(2), (r.platform_fee_cents / 100).toFixed(2),
        (r.coach_payout_cents / 100).toFixed(2), (r.studio_payout_cents / 100).toFixed(2)].map(q).join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="studio-${studio.id}-${month}.csv"`);
    res.send("\uFEFF" + lines.join("\r\n"));
  } catch (e) {
    res.status(500).json({ success: false, error: "報表產生失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
