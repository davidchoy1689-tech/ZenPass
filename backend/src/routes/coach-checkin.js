/**
 * 教練免登入點名 API
 * GET  /api/coach/checkin/roster?token=...
 * POST /api/coach/checkin  { token, booking_id, action: 'checkin'|'no_show' }
 *
 * 安全：HMAC token（單班次 scope）、時間窗（課前 2h 至課後 3h）、
 *      同一 IP 5 次失敗鎖 15 分鐘、操作冪等。
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const tokens = require("../services/coach-checkin-token");

const router = express.Router();
const attempts = new Map(); // ip -> { fails, blockedUntil }
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000;

function ipOf(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
}

function blocked(ip) {
  const a = attempts.get(ip);
  return a && a.blockedUntil && a.blockedUntil > Date.now();
}

function fail(ip) {
  const a = attempts.get(ip) || { fails: 0, blockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) { a.blockedUntil = Date.now() + BLOCK_MS; a.fails = 0; }
  attempts.set(ip, a);
}

function reset(ip) { attempts.delete(ip); }

const parseUtc = (s) => {
  const str = String(s || "");
  return /[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? new Date(str) : new Date(str.replace(" ", "T") + "Z");
};
const maskPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 8) return "—";
  return `${d.slice(0, 4)} ****`;
};
const norm = (p) => String(p || "").replace(/\D/g, "").replace(/^852/, "");

function ensureParentCols(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
    [
      ["parent_name", "TEXT"],
      ["parent_phone", "TEXT"],
      ["notify_sponsor_on_checkin", "INTEGER DEFAULT 0"],
      ["attendee_type", "TEXT DEFAULT 'self'"],
    ].forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) { console.error("[COACH-CHECKIN] parent cols:", e.message); }
}

function loadContext(db, token) {
  const v = tokens.verify(token);
  if (!v.ok) return { error: v.code };
  const s = db
    .prepare(
      `SELECT cs.id, cs.start_time, cs.end_time, cs.enrolled_count, cs.max_participants,
              c.title, c.venue_name, c.venue_address, u.name AS coach_name
         FROM class_schedules cs JOIN classes c ON c.id=cs.class_id
         LEFT JOIN users u ON u.id=? WHERE cs.id=?`,
    )
    .get(v.coachId, v.scheduleId);
  if (!s) return { error: "SCHEDULE_NOT_FOUND" };
  const start = parseUtc(s.start_time);
  const end = parseUtc(s.end_time);
  const now = Date.now();
  if (now < start.getTime() - 2 * 3600e3) return { error: "TOO_EARLY" };
  if (now > end.getTime() + 3 * 3600e3) return { error: "TOKEN_EXPIRED" };
  return { v, schedule: s };
}

function groupByUser(rows) {
  const map = new Map();
  for (const r of rows) {
    const g = map.get(r.user_id) || {
      user_id: r.user_id, booking_ids: [], seats: 0, attended: 0, no_show: 0,
      attendee_name: r.parent_name || r.name, is_parent: r.attendee_type === "parent",
      sponsor_name: r.attendee_type === "parent" ? r.name : null,
      phone: r.attendee_type === "parent" ? r.parent_phone : r.phone,
      emergency_name: r.emergency_name, emergency_phone: r.emergency_phone,
      health_notes: r.medical_notes || "", status: r.status, payment_status: r.payment_status,
      booking_id: r.id,
    };
    g.booking_ids.push(r.id);
    g.seats += 1;
    if (r.status === "attended") g.attended += 1;
    if (r.status === "no_show") g.no_show += 1;
    map.set(r.user_id, g);
  }
  return [...map.values()].map((g) => ({
    ...g,
    phone_masked: maskPhone(g.phone),
    phone_tel: norm(g.phone) ? `tel:+852${norm(g.phone)}` : null,
    emergency_tel: g.emergency_phone ? `tel:+852${norm(g.emergency_phone)}` : null,
  }));
}

function rosterRows(db, scheduleId) {
  return db
    .prepare(
      `SELECT b.id, b.user_id, b.status, b.payment_status, b.attendee_type, b.parent_name, b.parent_phone,
              b.medical_notes, u.name, u.phone, u.emergency_name, u.emergency_phone
         FROM bookings b JOIN users u ON u.id=b.user_id
        WHERE b.schedule_id=? AND b.status IN ('confirmed','pending_payment','attended','no_show')
        ORDER BY u.name`,
    )
    .all(scheduleId);
}

function buildRoster(db, scheduleId) {
  const rows = rosterRows(db, scheduleId);
  return groupByUser(rows);
}

// ===== GET roster =====
router.get("/coach/checkin/roster", (req, res) => {
  const ip = ipOf(req);
  if (blocked(ip)) return res.status(429).json({ success: false, error: "嘗試次數過多，請 15 分鐘後再試" });
  try {
    const db = getDb();
    ensureParentCols(db);
    const ctx = loadContext(db, req.query.token);
    if (ctx.error) { fail(ip); return res.status(403).json({ success: false, code: ctx.error, error: "連結無效或已過期" }); }
    reset(ip);
    const roster = buildRoster(db, ctx.schedule.id);
    const seats = roster.reduce((s, g) => s + g.seats, 0);
    const attended = roster.reduce((s, g) => s + g.attended, 0);
    res.json({
      success: true,
      schedule: {
        id: ctx.schedule.id,
        title: ctx.schedule.title,
        venue: ctx.schedule.venue_name,
        address: ctx.schedule.venue_address,
        start_time: ctx.schedule.start_time,
        end_time: ctx.schedule.end_time,
        coach_name: ctx.schedule.coach_name,
        total_enrolled: seats,
        attended_count: attended,
      },
      roster,
    });
  } catch (e) {
    console.error("[COACH-CHECKIN] roster:", e.message);
    res.status(500).json({ success: false, error: "讀取名冊失敗" });
  }
});

// ===== POST checkin / no_show =====
router.post("/coach/checkin", express.json(), (req, res) => {
  const ip = ipOf(req);
  if (blocked(ip)) return res.status(429).json({ success: false, error: "嘗試次數過多，請 15 分鐘後再試" });
  const { token, booking_id, action } = req.body || {};
  if (!["checkin", "no_show"].includes(action)) return res.status(400).json({ success: false, error: "action 無效" });
  try {
    const db = getDb();
    ensureParentCols(db);
    const ctx = loadContext(db, token);
    if (ctx.error) { fail(ip); return res.status(403).json({ success: false, code: ctx.error, error: "連結無效或已過期" }); }
    reset(ip);

    const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(booking_id);
    if (!b || b.schedule_id !== ctx.schedule.id)
      return res.status(404).json({ success: false, error: "找不到此學員" });

    // 同一 user 同一班（2 人同行）一齊處理
    const group = db
      .prepare("SELECT * FROM bookings WHERE user_id=? AND schedule_id=? AND status IN ('confirmed','pending_payment','attended','no_show')")
      .all(b.user_id, b.schedule_id);

    let sponsor = null;
    const run = db.transaction(() => {
      if (action === "checkin") {
        for (const g of group) {
          if (g.status === "attended") continue;
          if (g.status !== "confirmed") throw Object.assign(new Error("此預約未確認或未付款，不能簽到"), { code: "NOT_CONFIRMED" });
          if (g.payment_status !== "paid") throw Object.assign(new Error("未付款，不能簽到"), { code: "NOT_PAID" });
          db.prepare("UPDATE bookings SET status='attended', checked_in_at=datetime('now'), checkin_method='coach_link' WHERE id=?").run(g.id);
          db.prepare(
            `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
             VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          ).run(uuidv4(), "booking.checked_in", "booking", g.id, null,
            JSON.stringify({ method: "coach_link", schedule_id: ctx.schedule.id }),
            `教練連結簽到：${g.booking_reference}`);
        }

        const parent = group.find((g) => g.attendee_type === "parent" && Number(g.notify_sponsor_on_checkin) === 1);
        if (parent) {
          const already = db.prepare("SELECT 1 FROM audit_log WHERE action_type='checkin.sponsor_notified' AND entity_id=?").get(parent.id);
          if (!already) {
            const booker = db.prepare("SELECT name, phone FROM users WHERE id=?").get(parent.user_id);
            const end = parseUtc(ctx.schedule.end_time);
            const endHKT = new Date(end.getTime() + 8 * 3600e3);
            const hhmm = `${String(endHKT.getUTCHours()).padStart(2, "0")}:${String(endHKT.getUTCMinutes()).padStart(2, "0")}`;
            const text = `【ZenPass 課堂報平安】您為 ${parent.parent_name} 預約的${ctx.schedule.title}班已順利簽到！目前精神良好，由${ctx.schedule.coach_name || "導師"}親自帶領，預計 ${hhmm} 下課，請放心 🌿`;
            const phone = norm(booker.phone);
            sponsor = { phone, message: text, wa_url: (/^[4-9]\d{7}$/.test(phone) ? `https://wa.me/852${phone}?text=${encodeURIComponent(text)}` : null) };
            db.prepare(
              `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
               VALUES (?,?,?,?,?,?,?,datetime('now'))`,
            ).run(uuidv4(), "checkin.sponsor_notified", "booking", parent.id, null,
              JSON.stringify({ sponsor_phone: phone, parent_name: parent.parent_name }),
              `簽到報平安（教練連結）：${parent.parent_name}`);
          }
        }
      } else {
        for (const g of group) {
          if (g.status === "attended") throw Object.assign(new Error("已簽到，不能標記缺席"), { code: "ALREADY_ATTENDED" });
          db.prepare("UPDATE bookings SET status='no_show', cancel_reason='coach_marked_no_show' WHERE id=?").run(g.id);
          db.prepare(
            `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
             VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          ).run(uuidv4(), "booking.no_show", "booking", g.id, null,
            JSON.stringify({ method: "coach_link", schedule_id: ctx.schedule.id }),
            `教練標記缺席：${g.booking_reference}`);
        }
      }
    });
    run();

    const roster = buildRoster(db, ctx.schedule.id);
    const seats = roster.reduce((s, x) => s + x.seats, 0);
    const attended = roster.reduce((s, x) => s + x.attended, 0);
    res.json({
      success: true,
      attended_count: attended,
      total_enrolled: seats,
      sponsor_notified: Boolean(sponsor),
      sponsor,
    });
  } catch (e) {
    if (e && e.code) return res.status(409).json({ success: false, code: e.code, error: e.message });
    console.error("[COACH-CHECKIN] action:", e.message);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

module.exports = router;
module.exports._internal = { buildRoster, maskPhone, loadContext };
