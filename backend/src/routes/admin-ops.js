/**
 * ZenPass — 管理員營運總控 API（admin-ops）
 * 2026-10-25 新增
 * - GET  /api/admin/ops/overview?month=YYYY-MM   資金總覽
 * - GET  /api/admin/ops/leads                     B2B／教練線索池
 * - POST /api/admin/ops/weather-cancel           惡劣天氣取消（可退款）
 * - POST /api/admin/ops/batch-settle             批量封存已完結課堂
 * - GET  /api/admin/ops/payout-list?month=       出糧／場租清單（前端出 CSV）
 * 全部需要管理員權限；敏感操作寫 audit。
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin, hasMinimumRole } = require("../middleware/auth");

const router = express.Router();

// 🔒 營運總控台專用：排除 platform_staff（客服級唔應該見到教練電話／FPS 清單）
const OPS_ROLES = ["super_admin", "platform_manager", "admin"];
function requireOpsRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "需要登入認證" });
  if (!OPS_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "需要營運管理員權限" });
  }
  next();
}

function monthRange(month) {
  const m = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const start = `${m}-01 00:00:00`;
  const end = new Date(y, mo, 1).toISOString().slice(0, 10) + " 00:00:00";
  return { month: m, start, end };
}

function ensureCols(db, table, cols) {
  try {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    cols.forEach(([n, t]) => { if (!have.includes(n)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${n} ${t}`).run(); });
  } catch (e) { /* table 可能未存在 */ }
}

// ===== 資金總覽 =====
router.get("/overview", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const { month, start, end } = monthRange(req.query.month);
    ensureCols(db, "class_schedules", [["settled_at", "TEXT"], ["settle_summary", "TEXT"]]);

    const sess = db
      .prepare(
        `SELECT s.id, s.start_time, s.end_time, s.enrolled_count, s.settled_at,
                c.price_hkd, c.duration, c.partner_venue_id,
                pv.rental_price_per_hour,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status IN ('confirmed','attended')) AS booked,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status = 'attended') AS attended
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id
         WHERE s.start_time >= ? AND s.start_time < ? AND s.status <> 'cancelled'`,
      )
      .all(start, end);

    let gmv = 0, platformFee = 0, coachNet = 0, venueRent = 0;
    let pendingCoach = 0, pendingVenue = 0, pendingCount = 0, settledCount = 0;
    const now = Date.now();
    sess.forEach((s) => {
      const heads = Number(s.booked) || 0;
      const price = Number(s.price_hkd) || 0;
      const gross = heads * price;
      const ended = new Date(String(s.end_time).replace(" ", "T")).getTime() < now;
      const rate = 0.8;
      const net = Math.round(gross * rate);
      const rent = s.partner_venue_id && s.rental_price_per_hour
        ? Math.round((Number(s.duration) || 60) / 60 * Number(s.rental_price_per_hour)) : 0;
      gmv += gross; coachNet += net; platformFee += gross - net; venueRent += rent;
      if (ended && !s.settled_at) { pendingCoach += net; pendingVenue += rent; pendingCount++; }
      if (s.settled_at) settledCount++;
    });

    // 線索數
    const count = (sql) => { try { return db.prepare(sql).get().c; } catch (e) { return 0; } };
    res.json({
      success: true,
      month,
      finance: {
        gmv: Math.round(gmv), platform_fee: Math.round(platformFee), coach_net: Math.round(coachNet),
        venue_rent: Math.round(venueRent), pending_coach: Math.round(pendingCoach),
        pending_venue: Math.round(pendingVenue), pending_sessions: pendingCount,
        settled_sessions: settledCount, sessions: sess.length,
      },
      leads: {
        coach: count("SELECT COUNT(*) c FROM coach_leads WHERE status='new'"),
        school: count("SELECT COUNT(*) c FROM school_inquiries"),
        corporate: count("SELECT COUNT(*) c FROM corporate_inquiries"),
      },
    });
  } catch (err) {
    console.error("ops overview error:", err.message);
    res.status(500).json({ success: false, error: "讀取總覽失敗" });
  }
});

// ===== 線索池 =====
router.get("/leads", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const safe = (sql) => { try { return db.prepare(sql).all(); } catch (e) { return []; } };
    res.json({
      success: true,
      coaches: safe("SELECT id, reference, name, phone, email, specialties, regions, status, created_at FROM coach_leads ORDER BY created_at DESC LIMIT 100"),
      schools: safe("SELECT * FROM school_inquiries ORDER BY created_at DESC LIMIT 100"),
      corporates: safe("SELECT * FROM corporate_inquiries ORDER BY created_at DESC LIMIT 100"),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "讀取線索失敗" });
  }
});

// ===== 惡劣天氣／緊急取消 =====
router.post("/weather-cancel", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const date = String((req.body || {}).date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: "日期格式要 YYYY-MM-DD" });
    const reason = String((req.body || {}).reason || "惡劣天氣取消").slice(0, 80);
    const doRefund = req.body && req.body.refund === true;

    const sess = db
      .prepare("SELECT id, class_id FROM class_schedules WHERE date(start_time) = ? AND status <> 'cancelled'")
      .all(date);
    if (!sess.length) return res.json({ success: true, message: "該日沒有可取消的課堂", cancelled: 0 });

    let cancelled = 0, refundedBookings = 0, refundedCredits = 0;
    const tx = db.transaction(() => {
      sess.forEach((s) => {
        db.prepare("UPDATE class_schedules SET status = 'cancelled' WHERE id = ?").run(s.id);
        cancelled++;
        const bks = db.prepare("SELECT * FROM bookings WHERE schedule_id = ? AND status IN ('confirmed','attended','pending_payment')").all(s.id);
        bks.forEach((b) => {
          db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
          if (doRefund) {
            try {
              const { creditWallet } = require("../services/wallet-service");
              const amt = Number(b.amount) || 0;
              const credits = Math.round((amt / 10) * 10) / 10;
              if (credits > 0) {
                creditWallet({
                  userId: b.user_id, amount: credits, type: "refund",
                  description: `退款：${reason}（${date}）`, reference: b.booking_reference || b.id,
                  sourceType: "weather_cancel", sourceId: s.id,
                });
                refundedCredits += credits;
              }
            } catch (e) { console.error("weather refund error:", e.message); }
            refundedBookings++;
          }
        });
      });
    });
    tx();
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "weather_cancel", entityId: date, data: { date, reason, cancelled, refund: doRefund, refundedBookings, refundedCredits, by: req.user.id } });
    } catch (e) {}
    res.json({
      success: true,
      message: `已取消 ${cancelled} 個時段${doRefund ? `，退款 ${refundedBookings} 筆（${refundedCredits} credits）` : ""}`,
      cancelled, refunded_bookings: refundedBookings, refunded_credits: refundedCredits,
    });
  } catch (err) {
    console.error("weather-cancel error:", err.message);
    res.status(500).json({ success: false, error: "取消失敗" });
  }
});

// ===== 批量封存結算 =====
router.post("/batch-settle", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    ensureCols(db, "class_schedules", [["settled_at", "TEXT"], ["settle_summary", "TEXT"]]);
    const { month, start, end } = monthRange((req.body || {}).month);
    const rows = db
      .prepare(
        `SELECT s.id, s.start_time, s.end_time, c.price_hkd, c.partner_venue_id, pv.rental_price_per_hour,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status='attended') AS attended
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id
         WHERE s.start_time >= ? AND s.start_time < ? AND s.status <> 'cancelled'
           AND s.start_time < datetime('now') AND (s.settled_at IS NULL OR s.settled_at = '')`,
      )
      .all(start, end);
    let n = 0, gross = 0, net = 0, rent = 0;
    const tx = db.transaction(() => {
      rows.forEach((r) => {
        const heads = Number(r.attended) || 0;
        const price = Number(r.price_hkd) || 0;
        const g = heads * price;
        const netAmt = Math.round(g * 0.8);
        const rentAmt = r.partner_venue_id && r.rental_price_per_hour
          ? Math.round((Number(r.duration) || 60) / 60 * Number(r.rental_price_per_hour)) : 0;
        const summary = {
          settled_at: new Date().toISOString(), by_admin: req.user.id, batch: true,
          attended_heads: heads, gross: g, platform_fee: g - netAmt, net: netAmt, venue_fee: rentAmt,
        };
        db.prepare("UPDATE class_schedules SET settled_at = datetime('now'), settle_summary = ? WHERE id = ?").run(JSON.stringify(summary), r.id);
        n++; gross += g; net += netAmt; rent += rentAmt;
      });
    });
    tx();
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({ entityType: "batch_settle", entityId: month, data: { month, count: n, gross, net, venue_rent: rent, by: req.user.id } });
    } catch (e) {}
    res.json({ success: true, message: `已封存 ${n} 堂`, month, count: n, gross, net, venue_rent: rent });
  } catch (err) {
    console.error("batch-settle error:", err.message);
    res.status(500).json({ success: false, error: "批量結算失敗" });
  }
});

// ===== 出糧／場租清單（前端轉 CSV）=====
router.get("/payout-list", authenticateToken, requireAdmin, requireOpsRole, (req, res) => {
  try {
    const db = getDb();
    const { month, start, end } = monthRange(req.query.month);
    ensureCols(db, "class_schedules", [["settled_at", "TEXT"]]);
    const rows = db
      .prepare(
        `SELECT s.id, s.start_time, c.title, c.price_hkd, c.partner_venue_id, pv.name AS venue_name, pv.phone AS venue_phone,
                u.name AS coach_name, u.phone AS coach_phone, u.email AS coach_email,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = s.id AND b.status='attended') AS attended,
                s.settled_at
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN users u ON u.id = c.coach_id
         LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id
         WHERE s.start_time >= ? AND s.start_time < ? AND s.status <> 'cancelled'
           AND s.start_time < datetime('now')
         ORDER BY s.start_time`,
      )
      .all(start, end);
    const out = rows.map((r) => {
      const heads = Number(r.attended) || 0;
      const gross = heads * (Number(r.price_hkd) || 0);
      return {
        schedule_id: r.id, date: String(r.start_time).slice(0, 10), title: r.title,
        coach_name: r.coach_name || "", coach_phone: r.coach_phone || "", coach_email: r.coach_email || "",
        attended: heads, gross, coach_net: Math.round(gross * 0.8), platform_fee: gross - Math.round(gross * 0.8),
        venue_name: r.venue_name || "", venue_phone: r.venue_phone || "",
        settled: !!r.settled_at,
      };
    });
    res.json({ success: true, month, rows: out });
  } catch (err) {
    console.error("payout-list error:", err.message);
    res.status(500).json({ success: false, error: "讀取出糧清單失敗" });
  }
});

module.exports = router;
