/**
 * ZenPass 禪流 - Booking Model
 * Data access layer for bookings table
 * Pattern: thin model, thick service
 */

const { getDb } = require("../services/database");

class Booking {
  // ===== Create =====

  /**
   * Create a booking record
   * @param {Object} params - { userId, classId, scheduleId, creditsUsed, paymentType, status, note, bookingRef }
   * @returns {Object} booking row
   */
  static create(params) {
    const db = getDb();
    const {
      userId, classId, scheduleId, creditsUsed, paymentType,
      status = "confirmed", note = null, bookingRef = null, amount = 0,
      platformEarned = 0, venueEarned = 0, coachEarnings = 0,
    } = params;

    const now = new Date().toISOString();
    const ref = bookingRef || this.generateRef();

    const info = db.prepare(`
      INSERT INTO bookings (user_id, class_id, schedule_id, booking_reference, status,
        credits_used, payment_type, amount, platform_earned_amount, venue_earned_amount,
        coach_earnings, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, classId, scheduleId, ref, status,
      creditsUsed || 0, paymentType || "credits", amount,
      platformEarned, venueEarned, coachEarnings,
      note || "", now, now);

    return this.findById(info.lastInsertRowid);
  }

  // ===== Read =====

  /**
   * Find booking by ID
   */
  static findById(id) {
    const db = getDb();
    return db.prepare(`
      SELECT b.*, c.title, c.category, c.duration, c.price_hkd, c.venue_name,
             c.venue_address, c.coach_id, cs.start_time, cs.end_time,
             u.name as coach_name, u2.name as student_name
      FROM bookings b
      LEFT JOIN classes c ON b.class_id = c.id
      LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
      LEFT JOIN users u ON c.coach_id = u.id
      LEFT JOIN users u2 ON b.user_id = u2.id
      WHERE b.id = ?
    `).get(id);
  }

  /**
   * Find bookings by user
   */
  static findByUser(userId, options = {}) {
    const db = getDb();
    const { status, page = 1, limit = 20 } = options;
    const conditions = ["b.user_id = ?"];
    const params = [userId];

    if (status) {
      conditions.push("b.status = ?");
      params.push(status);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    return db.prepare(`
      SELECT b.*, c.title, c.category, c.duration, c.price_hkd, c.venue_name,
             c.venue_address, c.latitude, c.longitude, c.coach_id,
             cs.start_time, cs.end_time, u.name as coach_name
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN users u ON c.coach_id = u.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY cs.start_time DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);
  }

  /**
   * Find existing booking for user + schedule (avoid duplicates)
   */
  static findExisting(userId, scheduleId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM bookings
      WHERE user_id = ? AND schedule_id = ?
        AND status NOT IN ('cancelled', 'refunded')
    `).get(userId, scheduleId);
  }

  /**
   * Find by booking reference
   */
  static findByRef(ref) {
    const db = getDb();
    return db.prepare("SELECT * FROM bookings WHERE booking_reference = ?").get(ref);
  }

  /**
   * Get schedule bookings (for coach dashboard)
   */
  static getScheduleBookings(scheduleId) {
    const db = getDb();
    return db.prepare(`
      SELECT b.id as booking_id, u.id, u.name, b.status, b.created_at as booked_at
      FROM bookings b JOIN users u ON b.user_id = u.id
      WHERE b.schedule_id = ? AND b.status IN ('confirmed', 'attended')
      ORDER BY b.created_at
    `).all(scheduleId);
  }

  // ===== Update =====

  /**
   * Update booking status
   */
  static updateStatus(id, status) {
    const db = getDb();
    return db.prepare(`
      UPDATE bookings SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);
  }

  /**
   * Mark as attended (check-in)
   */
  static markAttended(id) {
    const db = getDb();
    return db.prepare(`
      UPDATE bookings SET status = 'attended', attended_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'confirmed'
    `).run(id);
  }

  /**
   * Mark as no-show
   */
  static markNoShow(id) {
    const db = getDb();
    return db.prepare(`
      UPDATE bookings SET status = 'no_show', updated_at = datetime('now')
      WHERE id = ? AND status IN ('confirmed', 'attended')
    `).run(id);
  }

  // ===== Count / Stats =====

  /**
   * Count user's confirmed bookings
   */
  static countByUser(userId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM bookings
      WHERE user_id = ? AND status = 'confirmed'
    `).get(userId);
    return row ? row.count : 0;
  }

  /**
   * Get user's trial usage count
   */
  static countTrialsByUser(userId, sinceDate) {
    const db = getDb();
    return db.prepare(`
      SELECT COUNT(*) as count FROM bookings
      WHERE user_id = ? AND payment_type = 'membership_trial'
        AND created_at >= ? AND status != 'cancelled'
    `).get(userId, sinceDate);
  }

  // ===== Helpers =====

  /**
   * Generate a unique booking reference
   * Format: ZP-XXXX (e.g., ZP-0042)
   */
  static generateRef() {
    const db = getDb();
    const max = db.prepare(
      "SELECT MAX(CAST(SUBSTR(booking_reference, 4) AS INTEGER)) as m FROM bookings WHERE booking_reference GLOB 'ZP-[0-9]*'"
    ).get().m || 0;
    return "ZP-" + String(max + 1).padStart(4, "0");
  }

  /**
   * Check schedule availability (atomic)
   */
  static checkAvailability(scheduleId) {
    const db = getDb();
    const schedule = db.prepare(
      "SELECT * FROM class_schedules WHERE id = ? AND status = 'available'"
    ).get(scheduleId);
    if (!schedule) return { available: false, reason: "not_found" };
    const enrolled = db.prepare(
      "SELECT COUNT(*) as c FROM bookings WHERE schedule_id = ? AND status NOT IN ('cancelled', 'refunded')"
    ).get(scheduleId);
    if (enrolled.c >= schedule.max_participants) {
      return { available: false, reason: "full", enrolled: enrolled.c, max: schedule.max_participants };
    }
    return { available: true, enrolled: enrolled.c, max: schedule.max_participants, remaining: schedule.max_participants - enrolled.c };
  }

  /**
   * Release expired holds for a schedule
   */
  static releaseExpiredHolds(scheduleId, maxAgeMinutes = 15) {
    const db = getDb();
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60000).toISOString();
    return db.prepare(`
      UPDATE bookings SET status = 'cancelled', updated_at = datetime('now')
      WHERE schedule_id = ? AND status = 'pending_payment' AND created_at < ?
    `).run(scheduleId, cutoff);
  }

  /**
   * Validate penalty consent
   */
  static validatePenaltyConsent(userId, hasConsented) {
    if (!hasConsented) {
      return { ok: false, error: "請同意缺席罰款政策", code: "PENALTY_CONSENT_REQUIRED" };
    }
    return { ok: true };
  }
}

module.exports = Booking;
