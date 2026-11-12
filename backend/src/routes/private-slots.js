/**
 * Phase 2.5 — 大眾化私人專屬時段（Slot Yield）
 * 每個 slot 背後有獨立 private class + class_schedule，
 * 令點名、收益、對賬完全沿用既有 80/20 引擎。
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { resolveDistrict } = require("../services/district");
const passes = require("../services/passes");
const passDeduction = require("../services/pass-deduction");
const familyWallet = require("../services/family-wallet");
const { audit } = require("../services/audit");
const { resolvePrivateUnits } = require("../utils/private-units");
const { creditsForPrice } = require("../utils/credits-cost");

const router = express.Router();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_availability_slots (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      district TEXT NOT NULL DEFAULT '',
      venue_template_id TEXT,
      venue_custom_name TEXT NOT NULL DEFAULT '',
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      price_cents INTEGER DEFAULT 28000,
      pass_units_required INTEGER DEFAULT 2,
      max_attendees INTEGER DEFAULT 1,
      class_id TEXT,
      schedule_id TEXT,
      status TEXT DEFAULT 'available',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_slots_explore ON coach_availability_slots(status,district,slot_start,coach_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_schedule ON coach_availability_slots(schedule_id);
  `);
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  if (!bcols.includes("slot_id")) db.exec("ALTER TABLE bookings ADD COLUMN slot_id TEXT");
  if (!bcols.includes("units_consumed")) db.exec("ALTER TABLE bookings ADD COLUMN units_consumed INTEGER DEFAULT 1");
  if (!bcols.includes("health_focus")) db.exec("ALTER TABLE bookings ADD COLUMN health_focus TEXT");
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  if (!ccols.includes("is_private")) db.exec("ALTER TABLE classes ADD COLUMN is_private INTEGER DEFAULT 0");
  const scols = db.prepare("PRAGMA table_info(coach_availability_slots)").all().map((c) => c.name);
  if (!scols.includes("class_id")) db.exec("ALTER TABLE coach_availability_slots ADD COLUMN class_id TEXT");
  if (!scols.includes("schedule_id")) db.exec("ALTER TABLE coach_availability_slots ADD COLUMN schedule_id TEXT");
}

function parseHktDate(date, time) {
  const d = String(date || "").trim();
  const t = String(time || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const x = new Date(d + "T" + t + ":00+08:00");
  return isNaN(x.getTime()) ? null : x;
}
const toUtc = (d) => d.toISOString().slice(0, 19).replace("T", " ");

function canAccessAttendee(db, requesterId, attendeeId) {
  if (requesterId === attendeeId) return true;
  return !!db
    .prepare(
      `SELECT 1 FROM family_members fm JOIN family_groups fg ON fg.id=fm.family_group_id
        WHERE fm.member_user_id=? AND fg.owner_user_id=? AND COALESCE(fm.can_consume_pass,1)=1 LIMIT 1`,
    )
    .get(attendeeId, requesterId);
}

function findPrivatePass(db, requesterId, attendeeId) {
  if (attendeeId === requesterId) return familyWallet.findApplicablePass(db, attendeeId);
  const p = db
    .prepare(
      `SELECT up.*, fg.owner_user_id, u.name AS owner_name
         FROM family_members fm
         JOIN family_groups fg ON fg.id=fm.family_group_id
         JOIN user_passes up ON up.family_group_id=fg.id
         JOIN users u ON u.id=fg.owner_user_id
        WHERE fm.member_user_id=? AND fg.owner_user_id=?
          AND COALESCE(fm.can_consume_pass,1)=1
          AND up.status='active' AND up.remaining_credits>0
          AND datetime(up.expires_at)>datetime('now')
        ORDER BY datetime(up.expires_at) ASC LIMIT 1`,
    )
    .get(attendeeId, requesterId);
  return p ? { pass: p, source: "family" } : null;
}

router.post("/coach/slots/batch-create", authenticateToken, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    ensureSchema(db);
    const me = db.prepare("SELECT id,is_coach,coach_verified FROM users WHERE id=?").get(req.user.id);
    if (!me || !me.is_coach) return res.status(403).json({ success: false, error: "只限已批核教練" });
    if (me.coach_verified === 0) return res.status(403).json({ success: false, error: "教練資質尚未核實" });

    const b = req.body || {};
    const venueName = String(b.venue_name || "").trim();
    if (!venueName) return res.status(400).json({ success: false, error: "請選擇場地" });
    const date = String(b.date || "");
    const ranges = Array.isArray(b.time_ranges) ? b.time_ranges : [];
    if (!ranges.length || ranges.length > 20) return res.status(400).json({ success: false, error: "時段數量 1–20" });
    const price = Number(b.price_cents || 28000);
    if (!Number.isInteger(price) || price < 26000 || price > 32000) {
      return res.status(400).json({ success: false, error: "私人時段定價必須 HK$260–320" });
    }
    const maxAttendees = Number(b.max_attendees || 1);
    if (![1, 2].includes(maxAttendees)) return res.status(400).json({ success: false, error: "私人時段只支援 1 對 1 或 1 對 2" });
    // 🔒 扣堂數由伺服器規則決定（一對一 3 堂／一對二 2 堂／位），唔信前端
    const units = resolvePrivateUnits(maxAttendees, b.pass_units_required);
    const district = resolveDistrict(String(b.district || "") + " " + venueName) || String(b.district || "");
    const title = String(b.course_title || "一對一專屬痛症／體適能指導").slice(0, 60);

    const prepared = [];
    for (const r of ranges) {
      const start = parseHktDate(date, r.start);
      const end = parseHktDate(date, r.end);
      if (!start || !end || end <= start) return res.status(400).json({ success: false, error: "時段格式錯誤" });
      if (start.getTime() < Date.now() + 6 * 3600000) return res.status(400).json({ success: false, error: "私人時段需至少提前 6 小時" });
      prepared.push({ start, end, st: toUtc(start), et: toUtc(end) });
    }
    // 教練所有排程（含私人 slot 對應 schedule）防撞
    for (const p of prepared) {
      const clash = db
        .prepare(
          `SELECT s.id,c.title,s.start_time FROM class_schedules s JOIN classes c ON c.id=s.class_id
            WHERE COALESCE(s.coach_override_id,s.coach_id,c.coach_id)=?
              AND COALESCE(s.status,'') <> 'cancelled'
              AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?)
            LIMIT 1`,
        )
        .get(req.user.id, p.et, p.st);
      if (clash) {
        return res.status(409).json({
          success: false,
          code: "CONFLICT",
          error: `此時段與現有排程重疊（${clash.title} ${clash.start_time}）`,
        });
      }
      const venueClash = db
        .prepare(
          `SELECT s.id,c.title FROM class_schedules s JOIN classes c ON c.id=s.class_id
            WHERE COALESCE(s.status,'') <> 'cancelled' AND c.venue_name=?
              AND datetime(s.start_time) < datetime(?) AND datetime(s.end_time) > datetime(?)
            LIMIT 1`,
        )
        .get(venueName, p.et, p.st);
      if (venueClash) {
        return res.status(409).json({ success: false, code: "VENUE_CONFLICT", error: `場地該時段已被佔用（${venueClash.title}）` });
      }
    }

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    const created = [];
    for (const p of prepared) {
      const classId = crypto.randomUUID();
      const scheduleId = crypto.randomUUID();
      const slotId = "slot_" + crypto.randomBytes(8).toString("hex");
      const duration = Math.max(1, Math.round((p.end - p.start) / 60000));
      db.prepare(
        `INSERT INTO classes
           (id,coach_id,title,description,category,duration,max_participants,price_hkd,price_hkd_cents,credits_cost,
            venue_name,district,status,booking_open,is_private,created_at,updated_at)
         VALUES (?,?,?,?, 'private', ?,?,?,?,?, ?,?, 'active',1,1,datetime('now'),datetime('now'))`,
      ).run(classId, req.user.id, title, "私人專屬時段", duration, maxAttendees, price / 100, price, creditsForPrice(price / 100), venueName, district || null);
      db.prepare(
        `INSERT INTO class_schedules
           (id,class_id,coach_id,created_by_coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district,created_at)
         VALUES (?,?,?,?,?,?,?,0,'available',1,?,datetime('now'))`,
      ).run(scheduleId, classId, req.user.id, req.user.id, p.st, p.et, maxAttendees, district || null);
      db.prepare(
        `INSERT INTO coach_availability_slots
           (id,coach_id,district,venue_custom_name,slot_start,slot_end,duration_minutes,price_cents,pass_units_required,max_attendees,class_id,schedule_id,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'available')`,
      ).run(slotId, req.user.id, district || "", venueName, p.st, p.et, duration, price, units, maxAttendees, classId, scheduleId);
      created.push({ slot_id: slotId, start_time: p.st, end_time: p.et });
    }
    db.exec("COMMIT");
    inTx = false;
    try {
      audit({
        actionType: "coach.private_slots_created",
        entityType: "coach_availability_slots",
        entityId: created.map((x) => x.slot_id).join(","),
        userId: req.user.id,
        newValues: { count: created.length, price_cents: price, units, venue: venueName },
        description: "批次開放私人專屬時段",
      });
    } catch (e) {}
    res.status(201).json({ success: true, created, count: created.length });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    console.error("[PRIVATE] batch:", e.message);
    res.status(500).json({ success: false, error: "發布時段失敗" });
  }
});

function listSlots(db, opts) {
  ensureSchema(db);
  const where = [
    "s.status='available'",
    "datetime(s.slot_start) > datetime('now','+6 hours')",
    "COALESCE(c.class_reference,'') NOT LIKE 'VERIFIED_TEST%'",
    "s.coach_id NOT LIKE 'prodtest-%'",
  ];
  const params = [];
  if (opts.district && opts.district !== "all") {
    where.push("s.district = ?");
    params.push(resolveDistrict(opts.district) || opts.district);
  }
  if (opts.date) {
    where.push("date(s.slot_start,'+8 hours') = date(?)");
    params.push(opts.date);
  }
  if (opts.coachId) {
    where.push("s.coach_id = ?");
    params.push(opts.coachId);
  }
  return db
    .prepare(
      `SELECT s.id AS slot_id, s.coach_id, s.district, s.venue_custom_name AS venue_name,
              s.slot_start, s.slot_end, s.duration_minutes, s.price_cents, s.pass_units_required,
              s.max_attendees, c.id AS class_id, c.title AS course_title,
              u.name AS coach_name
         FROM coach_availability_slots s
         JOIN classes c ON c.id=s.class_id
         LEFT JOIN users u ON u.id=s.coach_id
        WHERE ${where.join(" AND ")}
        ORDER BY datetime(s.slot_start) ASC LIMIT 100`,
    )
    .all(...params);
}

router.get("/public/explore/private-slots", (req, res) => {
  try {
    const rows = listSlots(getDb(), {
      district: req.query.district,
      date: req.query.date,
      coachId: req.query.coach_id,
    });
    res.json({ success: true, slots: rows });
  } catch (e) {
    console.error("[PRIVATE] list:", e.message);
    res.status(500).json({ success: false, error: "讀取私人時段失敗" });
  }
});

router.post("/bookings/book-private-slot", authenticateToken, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    ensureSchema(db);
    passes.ensureSchema(db);
    passDeduction.ensureSchema(db);
    const b = req.body || {};
    const slotId = String(b.slot_id || "");
    const attendeeId = String(b.attendee_user_id || req.user.id);
    const slot = db
      .prepare("SELECT s.*, c.title, c.price_hkd FROM coach_availability_slots s JOIN classes c ON c.id=s.class_id WHERE s.id=?")
      .get(slotId);
    if (!slot) return res.status(404).json({ success: false, error: "時段不存在", code: "SLOT_NOT_FOUND" });
    if (slot.status !== "available") return res.status(409).json({ success: false, error: "此時段已被預約", code: "SLOT_ALREADY_BOOKED" });
    if (new Date(slot.slot_start.replace(" ", "T") + "Z").getTime() < Date.now() + 6 * 3600000) {
      return res.status(409).json({ success: false, error: "私人時段需至少提前 6 小時", code: "SLOT_TOO_SOON" });
    }
    const attendee = db.prepare("SELECT id,name FROM users WHERE id=?").get(attendeeId);
    if (!attendee) return res.status(404).json({ success: false, error: "找不到學員" });
    if (!canAccessAttendee(db, req.user.id, attendeeId)) {
      return res.status(403).json({ success: false, error: "只可為自己或家庭成員預約", code: "FAMILY_MEMBER_REQUIRED" });
    }
    const duplicate = db
      .prepare("SELECT id FROM bookings WHERE slot_id=? AND user_id=? AND status<>'cancelled' LIMIT 1")
      .get(slotId, attendeeId);
    if (duplicate) return res.status(409).json({ success: false, error: "已預約此時段", code: "ALREADY_BOOKED" });

    const applicable = findPrivatePass(db, req.user.id, attendeeId);
    // 🔒 一對一每節扣 3 堂（舊 slot 設 2 堂會自動升級，唔會少收）
    const need = resolvePrivateUnits(slot.max_attendees, slot.pass_units_required);

    // Phase 4.5：FIFO 跨卡扣堂 —— 舊卡（快到期）先用盡，自動接第二張卡
    const fam = db
      .prepare(
        `SELECT fm.family_group_id FROM family_members fm
           JOIN family_groups fg ON fg.id = fm.family_group_id
          WHERE fm.member_user_id = ? AND fg.owner_user_id = ? AND COALESCE(fm.can_consume_pass,1)=1
          LIMIT 1`,
      )
      .get(attendeeId, req.user.id);
    const familyGroupId = attendeeId === req.user.id ? null : fam && fam.family_group_id ? fam.family_group_id : null;

    let planned = null;
    try {
      planned = passDeduction.planPassDeduction(db, { userId: attendeeId, familyGroupId, units: need });
    } catch (e) {
      if (e.code !== "INSUFFICIENT_CREDITS") throw e;
      return res.status(400).json({
        success: false,
        error: `此私人時段需 ${need} 堂 Pass，目前餘額不足`,
        code: "INSUFFICIENT_PASS_UNITS",
        remaining_credits: e.available,
        required: need,
      });
    }
    if (!applicable && !planned.plan.length) {
      return res.status(400).json({ success: false, error: "沒有有效 Pass", code: "NO_PASS", has_pass: false });
    }

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    const lock = db.prepare("UPDATE coach_availability_slots SET status='booked' WHERE id=? AND status='available'").run(slotId);
    if (lock.changes !== 1) {
      db.exec("ROLLBACK"); inTx = false;
      return res.status(409).json({ success: false, error: "此時段已被預約", code: "SLOT_ALREADY_BOOKED" });
    }
    const cap = db
      .prepare(
        `UPDATE class_schedules SET enrolled_count=COALESCE(enrolled_count,0)+1
          WHERE id=? AND COALESCE(enrolled_count,0) < COALESCE(max_participants,1)`,
      )
      .run(slot.schedule_id);
    if (cap.changes !== 1) {
      db.exec("ROLLBACK"); inTx = false;
      return res.status(409).json({ success: false, error: "此時段已額滿", code: "CLASS_FULL" });
    }
    const max = db
      .prepare("SELECT MAX(CAST(SUBSTR(booking_reference,4) AS INTEGER)) m FROM bookings WHERE booking_reference GLOB 'ZP-[0-9]*'")
      .get().m || 0;
    const bookingRef = "ZP-" + String(max + 1).padStart(4, "0");
    const bookingId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO bookings
         (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,
          group_size,pass_id,slot_id,units_consumed,health_focus,created_at)
       VALUES (?,?,?,?,?, 'pass','paid','confirmed',?,?,1,?,?,?,?,datetime('now'))`,
    ).run(
      bookingId, bookingRef, attendeeId, slot.schedule_id, slot.class_id,
      Number(slot.price_cents) / 100, Number(slot.price_cents),
      planned.plan[0].passId, slotId, need, String(b.health_focus || "").slice(0, 1000),
    );
    passDeduction.applyPlanInTx(db, { plan: planned.plan, bookingId, userId: attendeeId });
    passDeduction.recordPlanOnBooking(db, bookingId, planned.plan);
    db.exec("COMMIT");
    inTx = false;
    try {
      audit({
        actionType: "booking.private_slot_confirmed",
        entityType: "booking",
        entityId: bookingId,
        userId: req.user.id,
        newValues: {
          slot_id: slotId,
          attendee_user_id: attendeeId,
          pass_id: planned.plan[0].passId,
          units_consumed: need,
          pass_plan: planned.plan.map((p) => ({ pass_id: p.passId, units: p.units })),
        },
        description: `私人時段預約：${slot.title}`,
      });
    } catch (e) {}
    const after = db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(planned.plan[0].passId);
    res.status(201).json({
      success: true,
      booking_id: bookingId,
      booking_reference: bookingRef,
      slot_id: slotId,
      units_consumed: need,
      pass: {
        id: planned.plan[0].passId,
        source: planned.source,
        remaining_credits: after ? after.remaining_credits : 0,
      },
      pass_plan: planned.plan.map((p) => ({ pass_id: p.passId, units: p.units })),
    });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    console.error("[PRIVATE] book:", e.message);
    res.status(500).json({ success: false, error: "私人時段預約失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
module.exports.listSlots = listSlots;
