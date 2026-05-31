/**
 * ZenPass 禪流 — 場地租賃系統（教練租場）
 * 教練搜尋場地 → 預約時段 → 付款俾場地 → 開班收學生
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");
const {
  calcRentalCommission,
  getVenuePlan,
} = require("../services/commission");
const { recordPayment } = require("../services/accounting");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== 1. GET /api/venue-rentals/available — 教練搜尋可租場地 =====
router.get("/available", (req, res) => {
  try {
    const { date, category, district, page = 1, limit = 20 } = req.query;
    const db = new Database(DB_PATH);

    // Get active venues with their info
    let sql = `SELECT v.id, v.name, v.description, v.category, v.district, 
               v.address, v.logo_url, v.facilities, v.commission_plan,
               v.commission_rate
              FROM partner_venues v 
              WHERE v.status = 'active'`;
    let params = [];

    if (category) {
      sql += ` AND v.category = ?`;
      params.push(category);
    }
    if (district) {
      sql += ` AND v.district = ?`;
      params.push(district);
    }

    sql += ` ORDER BY v.name LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);

    const venues = db.prepare(sql).all(...params);

    // For each venue, get available time slots (NOT already rented)
    for (const v of venues) {
      // Get all future rentals for this venue
      const rentals = db
        .prepare(
          `
        SELECT start_time, end_time, status FROM venue_rentals 
        WHERE venue_id = ? AND status IN ('confirmed','pending')
        AND start_time > datetime('now')
      `,
        )
        .all(v.id);

      v.rented_slots = rentals;
      v.facilities = JSON.parse(v.facilities || "[]");

      // Suggest available hours (for display)
      v.suggested_hours = {
        open: "09:00",
        close: "22:00",
        price_per_hour: Math.round(v.commission_rate * 100 * 600) / 100 || 200,
      };
    }

    const total = db
      .prepare(
        `SELECT COUNT(*) as c FROM partner_venues WHERE status = 'active'`,
      )
      .get().c;
    db.close();

    res.json({ success: true, data: venues, total, page: parseInt(page) });
  } catch (err) {
    console.error("venue-rentals/available error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 2. POST /api/venue-rentals/book — 教練預約場地 =====
router.post("/book", authenticateToken, (req, res) => {
  try {
    if (req.user.role !== "coach") {
      return res
        .status(403)
        .json({ success: false, error: "只限教練預約場地" });
    }

    const { venue_id, start_time, end_time, price_hkd } = req.body;
    if (!venue_id || !start_time || !end_time) {
      return res
        .status(400)
        .json({ success: false, error: "請填寫場地、開始同結束時間" });
    }

    const db = new Database(DB_PATH);

    // Check venue exists and is active
    const venue = db
      .prepare(
        "SELECT * FROM partner_venues WHERE id = ? AND status = 'active'",
      )
      .get(venue_id);
    if (!venue) {
      db.close();
      return res
        .status(404)
        .json({ success: false, error: "場地不存在或未啟用" });
    }

    // Check for time conflicts
    const conflict = db
      .prepare(
        `
      SELECT id FROM venue_rentals 
      WHERE venue_id = ? AND status IN ('confirmed','pending')
      AND start_time < ? AND end_time > ?
    `,
      )
      .get(venue_id, end_time, start_time);

    if (conflict) {
      db.close();
      return res.status(409).json({ success: false, error: "該時段已被預約" });
    }

    const id = uuidv4();
    const price = price_hkd || Math.round(venue.commission_rate * 600);

    db.prepare(
      `
      INSERT INTO venue_rentals (id, venue_id, coach_id, start_time, end_time, price_hkd, status)
      VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
    `,
    ).run(id, venue_id, req.user.id, start_time, end_time, price);

    db.close();

    res.json({
      success: true,
      rental_id: id,
      venue: venue.name,
      start_time,
      end_time,
      price_hkd: price,
      message: `已預約 ${venue.name} ${start_time} - ${end_time}`,
    });
  } catch (err) {
    console.error("venue-rentals/book error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 3. GET /api/venue-rentals/my — 教練睇自己租場記錄 =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const rentals = db
      .prepare(
        `
      SELECT r.*, v.name as venue_name, v.address, v.category, v.district
      FROM venue_rentals r
      JOIN partner_venues v ON r.venue_id = v.id
      WHERE r.coach_id = ?
      ORDER BY r.start_time DESC
    `,
      )
      .all(req.user.id);
    db.close();
    res.json({ success: true, data: rentals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 4. GET /api/venue-rentals/venue/:venueId — 場地睇自己嘅租賃記錄 =====
router.get("/venue/:venueId", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const rentals = db
      .prepare(
        `
      SELECT r.*, u.name as coach_name, u.email as coach_email
      FROM venue_rentals r
      LEFT JOIN users u ON r.coach_id = u.id
      WHERE r.venue_id = ?
      ORDER BY r.start_time DESC LIMIT 50
    `,
      )
      .all(req.params.venueId);
    db.close();
    res.json({ success: true, data: rentals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 5. DELETE /api/venue-rentals/:id/cancel — 取消預約 =====
router.delete("/:id/cancel", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const rental = db
      .prepare("SELECT * FROM venue_rentals WHERE id = ?")
      .get(req.params.id);
    if (!rental) {
      db.close();
      return res.status(404).json({ success: false, error: "租賃記錄不存在" });
    }
    if (rental.coach_id !== req.user.id && req.user.role !== "admin") {
      db.close();
      return res.status(403).json({ success: false, error: "無權限取消" });
    }
    db.prepare(
      "UPDATE venue_rentals SET status = 'cancelled' WHERE id = ?",
    ).run(req.params.id);
    db.close();
    res.json({ success: true, message: "已取消預約" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
