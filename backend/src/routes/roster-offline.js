/**
 * Phase 4.3 — 離線韌性點名與長者降級核銷
 *
 * GET  /api/coach/roster/offline-snapshot/:scheduleId
 * POST /api/coach/roster/sync-offline-checkins
 *
 * 原則：出席履約優先（Presence Wins）；重複同步冪等，不重複扣堂／計佣。
 */
const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const passes = require("../services/passes");

const router = express.Router();

function ensureSchema(db) {
  const add = (table, cols) => {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    cols.forEach(([n, t]) => { if (!have.includes(n)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${n} ${t}`); });
  };
  add("class_schedules", [["roster_sync_version", "INTEGER DEFAULT 1"]]);
  add("bookings", [
    ["offline_synced_at", "TEXT"],
    ["fallback_verified_by", "TEXT"],
    ["fallback_note", "TEXT"],
  ]);
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkin_sync_conflicts (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      conflict_type TEXT NOT NULL,
      resolved_status TEXT DEFAULT 'auto_resolved_presence_won',
      details TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_schedule ON checkin_sync_conflicts(schedule_id, created_at);
  `);
}

function sign(payload) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "zenpass").update(payload).digest("hex").slice(0, 32);
}

function isCoachOf(db, userId, sched) {
  const coachId = sched.coach_override_id || sched.coach_id || db.prepare("SELECT coach_id FROM classes WHERE id=?").get(sched.class_id)?.coach_id;
  const u = db.prepare("SELECT role,is_coach FROM users WHERE id=?").get(userId);
  if (u && ["admin", "super_admin"].includes(u.role)) return true;
  return coachId === userId;
}

function hktLast4(phone) {
  const p = String(phone || "").replace(/\D/g, "").replace(/^852/, "");
  return p.length >= 4 ? p.slice(-4) : "";
}

function loadRoster(db, scheduleId) {
  return db.prepare(
    `SELECT b.id AS booking_id, b.user_id, b.pass_id, b.status, b.payment_type, b.payment_status,
            b.attendance_status,
            u.name, u.phone,
            fg.group_name, ow.name AS owner_name, ow.phone AS owner_phone
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN user_passes p ON p.id = b.pass_id
       LEFT JOIN family_groups fg ON fg.id = p.family_group_id
       LEFT JOIN users ow ON ow.id = fg.owner_user_id
      WHERE b.schedule_id = ? AND b.status IN ('confirmed','attended','cancelled')
      ORDER BY u.name`,
  ).all(scheduleId).map((r) => ({
    booking_id: r.booking_id,
    name: r.name,
    phone_last4: hktLast4(r.phone),
    status: r.attendance_status === "present" || r.status === "attended" ? "present" : r.status,
    attendance_status: r.attendance_status || "registered",
    family_group_name: r.group_name || null,
    payer_name: r.owner_name || null,
    pass_remaining: r.pass_id
      ? (db.prepare("SELECT remaining_credits FROM user_passes WHERE id=?").get(r.pass_id)?.remaining_credits ?? null)
      : null,
    units: 1,
  }));
}

router.get("/coach/roster/offline-snapshot/:scheduleId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const sched = db.prepare("SELECT * FROM class_schedules WHERE id=?").get(req.params.scheduleId);
    if (!sched) return res.status(404).json({ success: false, error: "班次不存在" });
    if (!isCoachOf(db, req.user.id, sched)) return res.status(403).json({ success: false, error: "只限該班教練" });

    const roster = loadRoster(db, sched.id);
    const version = Number(sched.roster_sync_version || 1);
    const payload = JSON.stringify({ schedule_id: sched.id, version, roster });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      schedule_id: sched.id,
      class_title: db.prepare("SELECT title FROM classes WHERE id=?").get(sched.class_id)?.title || "",
      start_time: sched.start_time,
      end_time: sched.end_time,
      roster_sync_version: version,
      roster,
      signature: sign(payload),
      signed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[OFFLINE] snapshot:", e.message);
    res.status(500).json({ success: false, error: "讀取名冊失敗" });
  }
});

router.post("/coach/roster/sync-offline-checkins", authenticateToken, (req, res) => {
  const db = getDb();
  ensureSchema(db);
  let inTx = false;
  try {
    const b = req.body || {};
    const scheduleId = String(b.schedule_id || "");
    const items = Array.isArray(b.checkins) ? b.checkins : [];
    if (!scheduleId) return res.status(400).json({ success: false, error: "缺少 schedule_id" });
    if (!items.length) return res.json({ success: true, applied: 0, skipped: 0, conflicts: [], note: "沒有待同步紀錄" });

    const sched = db.prepare("SELECT * FROM class_schedules WHERE id=?").get(scheduleId);
    if (!sched) return res.status(404).json({ success: false, error: "班次不存在" });
    if (!isCoachOf(db, req.user.id, sched)) return res.status(403).json({ success: false, error: "只限該班教練" });

    const results = [];
    let applied = 0, skipped = 0, conflicts = 0;

    db.exec("BEGIN IMMEDIATE");
    inTx = true;

    for (const item of items.slice(0, 200)) {
      const bookingId = String(item.booking_id || "");
      if (!bookingId) { results.push({ booking_id: null, result: "invalid" }); continue; }
      const bk = db.prepare("SELECT * FROM bookings WHERE id=? AND schedule_id=?").get(bookingId, scheduleId);
      if (!bk) { results.push({ booking_id: bookingId, result: "not_found" }); skipped++; continue; }

      if (bk.attendance_status === "present" || bk.status === "attended") {
        results.push({ booking_id: bookingId, result: "already_present" });
        skipped++;
        continue;
      }

      const wasCancelled = bk.status === "cancelled";
      if (bk.pass_id && !wasCancelled) {
        const hasRedemption = db.prepare("SELECT 1 FROM pass_redemptions WHERE pass_id=? AND booking_id=? AND status='used'").get(bk.pass_id, bk.id);
        if (!hasRedemption) {
          try {
            passes.redeemUnitsInTx(db, { passId: bk.pass_id, userId: bk.user_id, bookingId: bk.id, units: Number(bk.units_consumed || 1) });
          } catch (e) {
            db.prepare(
              "INSERT INTO checkin_sync_conflicts (id,schedule_id,booking_id,conflict_type,resolved_status,details) VALUES (?,?,?,?,?,?)",
            ).run(uuidv4(), scheduleId, bk.id, "pass_already_exhausted", "manual_review_required", JSON.stringify({ error: e.message }));
            conflicts++;
            results.push({ booking_id: bookingId, result: "conflict_manual_review", error: e.message });
            continue;
          }
        }
      }
      if (wasCancelled) {
        // Presence Wins：重新扣堂（若之前取消已回補）
        if (bk.pass_id) {
          try {
            passes.redeemUnitsInTx(db, { passId: bk.pass_id, userId: bk.user_id, bookingId: bk.id, units: Number(bk.units_consumed || 1) });
          } catch (e) {
            db.prepare(
              "INSERT INTO checkin_sync_conflicts (id,schedule_id,booking_id,conflict_type,resolved_status,details) VALUES (?,?,?,?,?,?)",
            ).run(uuidv4(), scheduleId, bk.id, "pass_already_exhausted", "manual_review_required",
              JSON.stringify({ error: e.message, note: item.fallback_note || null }));
            conflicts++;
            results.push({ booking_id: bookingId, result: "conflict_manual_review", error: e.message });
            continue;
          }
        }
      }

      const method = String(item.method || "dynamic_qr");
      const allowed = ["dynamic_qr", "coach_manual", "coach_manual_fallback", "door_iot", "pin_code"];
      const finalMethod = allowed.includes(method) ? method : "coach_manual_fallback";

      db.prepare(
        `UPDATE bookings SET status='attended', attendance_status='present', checkin_method=?,
                offline_synced_at=datetime('now'), fallback_verified_by=?, fallback_note=?,
                fraud_audit_status=COALESCE(fraud_audit_status,'clean')
          WHERE id=?`,
      ).run(finalMethod, finalMethod === "coach_manual_fallback" ? req.user.id : null, item.fallback_note || null, bk.id);

      if (wasCancelled) {
        db.prepare(
          "INSERT INTO checkin_sync_conflicts (id,schedule_id,booking_id,conflict_type,resolved_status,details) VALUES (?,?,?,?,?,?)",
        ).run(uuidv4(), scheduleId, bk.id, "offline_present_vs_cancelled", "auto_resolved_presence_won",
          JSON.stringify({ client_timestamp: item.client_timestamp || null, method: finalMethod, note: item.fallback_note || null }));
        conflicts++;
      }

      applied++;
      results.push({ booking_id: bookingId, result: wasCancelled ? "presence_won" : "present", method: finalMethod });
    }

    db.prepare("UPDATE class_schedules SET roster_sync_version=COALESCE(roster_sync_version,1)+1 WHERE id=?").run(scheduleId);
    db.exec("COMMIT");
    inTx = false;

    // 結算在交易外，避免結算失敗拖垮打卡
    let settled = false;
    try {
      const hasStudio = !!sched.studio_id;
      if (applied > 0) {
        if (hasStudio) require("../services/studio-ledger").settleStudioSchedule(scheduleId);
        else {
          require("./coach-earnings").syncCoachEarningsForSchedule(scheduleId);
          require("../services/coach-affiliate").settleSchedule(scheduleId);
        }
        settled = true;
      }
    } catch (e) {
      console.error("[OFFLINE] settle:", e.message);
    }

    try {
      audit({
        actionType: "checkin.offline_synced",
        entityType: "class_schedule",
        entityId: scheduleId,
        userId: req.user.id,
        newValues: { applied, skipped, conflicts, settled, client_version: b.sync_version ?? null },
        description: "離線點名同步",
      });
    } catch (e) {}

    res.json({
      success: true,
      applied,
      skipped,
      conflicts,
      settled,
      roster_sync_version: Number(db.prepare("SELECT roster_sync_version FROM class_schedules WHERE id=?").get(scheduleId).roster_sync_version),
      results,
    });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    console.error("[OFFLINE] sync:", e.message);
    res.status(500).json({ success: false, error: "同步失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
