/**
 * ZenPass 禪流 — 場地租賃系統（教練租場）
 * 教練搜尋場地 → 預約時段 → 付款俾場地 → 開班收學生
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { computeVenueRating } = require("../services/venue-rating");
const { authenticateToken, requireAdmin, requireOwnInstitution } = require("../middleware/auth");
const { sendNotification } = require("../services/notification");
const {
  calcRentalCommission,
  getVenuePlan,
} = require("../services/commission");
const { recordPayment } = require("../services/accounting");

const router = express.Router();

// ===== 1. GET /api/venue-rentals/available — 教練搜尋可租場地 =====
router.get("/available", (req, res) => {
  try {
    const { date, category, district, page = 1, limit = 20 } = req.query;
    const db = getDb();

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

    sql += ` ORDER BY v.name`;

    let venues = db.prepare(sql).all(...params);

    // 場地評分（代替保證金）：低分 → 排到最後／停止曝光
    venues = venues
      .map((v) => {
        const rt = computeVenueRating(v.id);
        const { venueComposite } = require("../services/mutual-review");
        const comp = venueComposite(v.id, rt.score);
        v.fulfillment_score = rt.score;
        v.rating = comp.score;
        v.rating_parts = comp.parts;
        v.rating_band = rt.band;
        v.visibility = rt.visibility;
        return v;
      })
      .filter((v) => v.visibility !== "hidden")
      .sort((a, b) => b.rating - a.rating || String(a.name).localeCompare(String(b.name)))
      .slice((page - 1) * limit, page * limit);

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

    const db = getDb();

    // 預約期：只接受未來 3 個月內、且未開始嘅時段
    {
      const st = new Date(start_time);
      const en = new Date(end_time);
      if (isNaN(st) || isNaN(en)) {
        return res.status(400).json({ success: false, error: "時間格式有誤" });
      }
      if (en <= st) {
        return res.status(400).json({ success: false, error: "結束時間要遲過開始時間" });
      }
      if (st <= new Date()) {
        return res.status(400).json({ success: false, error: "不可預約過去嘅時段" });
      }
      const max = new Date();
      max.setMonth(max.getMonth() + 3);
      if (st > max) {
        return res.status(400).json({ success: false, error: "場地只開放未來 3 個月內預約" });
      }
    }

    // Check venue exists and is active
    const venue = db
      .prepare(
        "SELECT * FROM partner_venues WHERE id = ? AND status = 'active'",
      )
      .get(venue_id);
    if (!venue) {

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

      return res.status(409).json({ success: false, error: "該時段已被預約" });
    }

    const id = uuidv4();
    const price = price_hkd || Math.round(venue.commission_rate * 600);

    // 場地若開咗「自動接受」→ 直接 confirmed；否則 pending 待場地確認
    const autoCfg = _getAuto(venue_id);
    const bookingStatus = _matchesAuto(autoCfg, start_time, end_time) ? "confirmed" : "pending";

    db.prepare(
      `
      INSERT INTO venue_rentals (id, venue_id, coach_id, start_time, end_time, price_hkd, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(id, venue_id, req.user.id, start_time, end_time, price, bookingStatus);

    res.json({
      success: true,
      rental_id: id,
      status: bookingStatus,
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
    const db = getDb();
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

    res.json({ success: true, data: rentals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 3.5 GET /api/venue-rentals/frequent — 常用場地記憶 =====
router.get("/frequent", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.venue_id, v.name AS venue_name, v.district, v.category, v.address,
                COUNT(*) AS times,
                MAX(r.start_time) AS last_start,
                (SELECT r2.end_time FROM venue_rentals r2
                  WHERE r2.venue_id = r.venue_id AND r2.coach_id = r.coach_id AND r2.status != 'cancelled'
                  ORDER BY r2.start_time DESC LIMIT 1) AS last_end,
                (SELECT r2.price_hkd FROM venue_rentals r2
                  WHERE r2.venue_id = r.venue_id AND r2.coach_id = r.coach_id AND r2.status != 'cancelled'
                  ORDER BY r2.start_time DESC LIMIT 1) AS last_price
         FROM venue_rentals r
         JOIN partner_venues v ON r.venue_id = v.id
         WHERE r.coach_id = ? AND r.status != 'cancelled'
         GROUP BY r.venue_id
         ORDER BY times DESC, last_start DESC
         LIMIT 6`,
      )
      .all(req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("venue-rentals/frequent error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 4. GET /api/venue-rentals/venue/:venueId — 場地睇自己嘅租賃記錄 =====
router.get("/venue/:venueId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

    res.json({ success: true, data: rentals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 5. DELETE /api/venue-rentals/:id/cancel — 取消預約 =====
router.delete("/:id/cancel", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rental = db
      .prepare("SELECT * FROM venue_rentals WHERE id = ?")
      .get(req.params.id);
    if (!rental) {

      return res.status(404).json({ success: false, error: "租賃記錄不存在" });
    }
    if (rental.coach_id !== req.user.id && req.user.role !== "admin") {

      return res.status(403).json({ success: false, error: "無權限取消" });
    }

    // 政策（2026-10-17）：確認／付款後雙方不能更改；租客取消 → 租金全數不退
    const wasConfirmed = rental.status === "confirmed";

    db.prepare(
      "UPDATE venue_rentals SET status = 'cancelled' WHERE id = ?",
    ).run(req.params.id);

    if (wasConfirmed) {
      try {
        const db2 = getDb();
        db2.prepare(
          "CREATE TABLE IF NOT EXISTS venue_penalties (id TEXT PRIMARY KEY, rental_id TEXT, venue_id TEXT, coach_id TEXT, type TEXT, amount_hkd REAL, status TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now')))",
        ).run();
        db2.prepare(
          "INSERT INTO venue_penalties (id, rental_id, venue_id, coach_id, type, amount_hkd, status, note) VALUES (?,?,?,?,?,?,?,?)",
        ).run(uuidv4(), rental.id, rental.venue_id, rental.coach_id, "tenant_cancel_forfeit", rental.price_hkd || 0, "applied", "已確認後租客取消，租金全數不退");
      } catch (e) {
        console.error("venue penalty log error:", e.message);
      }
    }

    res.json({
      success: true,
      message: wasConfirmed
        ? "已取消。由於確認後取消，租金全數不退還。"
        : "已取消預約",
      forfeited: wasConfirmed,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

// ==================== 場地端：審批 + 自動接受（2026-10-17）====================

function _venueOf(userId) {
  const db = getDb();
  return (
    db.prepare("SELECT * FROM partner_venues WHERE (owner_id = ? OR user_id = ?) AND status = 'active'").get(userId, userId) ||
    db.prepare("SELECT * FROM partner_venues WHERE owner_id = ? OR user_id = ?").get(userId, userId) ||
    null
  );
}

const AUTO_KEY = (vid) => `venue.${vid}.rental_auto`;

function _getAuto(venueId) {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(AUTO_KEY(venueId));
    if (row && row.value) {
      const c = JSON.parse(row.value);
      return { enabled: !!c.enabled, days: Array.isArray(c.days) ? c.days : [1, 2, 3, 4, 5], from: c.from || "09:00", to: c.to || "22:00", maxHours: Number(c.maxHours || 4) };
    }
  } catch (e) { /* ignore */ }
  return { enabled: false, days: [1, 2, 3, 4, 5], from: "09:00", to: "22:00", maxHours: 4 };
}

function _setAuto(venueId, cfg) {
  const db = getDb();
  db.prepare("CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))").run();
  const clean = {
    enabled: !!cfg.enabled,
    days: (Array.isArray(cfg.days) ? cfg.days : []).map(Number).filter((d) => d >= 0 && d <= 6),
    from: cfg.from || "09:00",
    to: cfg.to || "22:00",
    maxHours: Math.min(Math.max(Number(cfg.maxHours || 4), 1), 12),
  };
  const exists = db.prepare("SELECT key FROM platform_settings WHERE key = ?").get(AUTO_KEY(venueId));
  if (exists) db.prepare("UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(JSON.stringify(clean), AUTO_KEY(venueId));
  else db.prepare("INSERT INTO platform_settings (key, value, description) VALUES (?, ?, ?)").run(AUTO_KEY(venueId), JSON.stringify(clean), "場地租場自動接受規則");
  return clean;
}

function _matchesAuto(cfg, startIso, endIso) {
  if (!cfg.enabled) return false;
  const st = new Date(startIso), en = new Date(endIso);
  if (isNaN(st) || isNaN(en) || en <= st) return false;
  const hk = new Date(st.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
  if (cfg.days.length && cfg.days.indexOf(hk.getDay()) < 0) return false;
  const hours = (en - st) / 3600000;
  if (hours > cfg.maxHours) return false;
  const f = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" });
  return f(st) >= cfg.from && f(en) <= cfg.to;
}

// ===== GET /api/venue-rentals/incoming — 場地睇自己嘅租場（含教練資料）=====
router.get("/incoming", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const db = getDb();
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const rows = db.prepare(
      `SELECT r.*, u.name AS coach_name, u.email AS coach_email, u.phone AS coach_phone
       FROM venue_rentals r LEFT JOIN users u ON r.coach_id = u.id
       WHERE r.venue_id = ?
       ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.start_time DESC LIMIT 200`,
    ).all(venue.id);
    res.json({ success: true, venue: venue.name, auto: _getAuto(venue.id), rentals: rows });
  } catch (err) {
    console.error("venue-rentals/incoming error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/:id/confirm — 場地確認（pending → confirmed）=====
router.post("/:id/confirm", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const db = getDb();
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const r = db.prepare("SELECT * FROM venue_rentals WHERE id = ? AND venue_id = ?").get(req.params.id, venue.id);
    if (!r) return res.status(404).json({ success: false, error: "租場紀錄不存在" });
    if (r.status !== "pending") return res.status(400).json({ success: false, error: "只有待確認嘅租場可以確認" });
    db.prepare("UPDATE venue_rentals SET status = 'confirmed' WHERE id = ?").run(req.params.id);
    const coach = db.prepare("SELECT name, email FROM users WHERE id = ?").get(r.coach_id);
    if (coach && coach.email) {
      require("../services/notification").emailNotification(coach.email, "【ZenPass】租場已確認 ✅",
        `<p>你嘅租場已獲場地確認：<b>${venue.name}</b><br>${r.start_time} — ${r.end_time}</p>`).catch(() => {});
    }
    res.json({ success: true, status: "confirmed" });
  } catch (err) {
    console.error("venue-rentals/confirm error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/:id/reject — 場地拒絕（→ cancelled）=====
router.post("/:id/reject", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const db = getDb();
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const r = db.prepare("SELECT * FROM venue_rentals WHERE id = ? AND venue_id = ?").get(req.params.id, venue.id);
    if (!r) return res.status(404).json({ success: false, error: "租場紀錄不存在" });
    if (r.status !== "pending") return res.status(400).json({ success: false, error: "已確認嘅租場不可更改（如需取消，請用場地方取消）" });
    db.prepare("UPDATE venue_rentals SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    const coach = db.prepare("SELECT email FROM users WHERE id = ?").get(r.coach_id);
    if (coach && coach.email) {
      require("../services/notification").emailNotification(coach.email, "【ZenPass】租場未獲接受",
        `<p>你嘅租場申請未獲 <b>${venue.name}</b> 接受。<br>${r.start_time} — ${r.end_time}<br>${(req.body && req.body.note) || ""}</p>`).catch(() => {});
    }
    res.json({ success: true, status: "cancelled" });
  } catch (err) {
    console.error("venue-rentals/reject error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/:id/pay — 教練用錢包付款（平台代收）=====
router.post("/:id/pay", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const r = db.prepare("SELECT * FROM venue_rentals WHERE id = ?").get(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: "租場紀錄不存在" });
    if (r.coach_id !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "無權限付款" });
    }
    if (r.status === "cancelled") return res.status(400).json({ success: false, error: "租場已取消" });
    if (r.payment_status === "paid") return res.json({ success: true, already_paid: true, message: "此租場已付款" });

    const walletService = require("../services/wallet-service");
    const w = walletService.debitWallet({
      userId: r.coach_id,
      amount: Number(r.price_hkd) || 0,
      type: "venue_rental",
      description: `租場費用 ${r.start_time} - ${r.end_time}`,
      reference: r.id,
      sourceType: "venue_rental",
      sourceId: r.id,
    });
    if (!w || !w.success) {
      return res.status(400).json({ success: false, error: (w && w.error) || "付款失敗", need_topup: true });
    }

    db.prepare("UPDATE venue_rentals SET payment_status='paid', paid_at=datetime('now'), payment_method=COALESCE(payment_method,'wallet') WHERE id=?").run(r.id);
    res.json({ success: true, payment_status: "paid", amount: Number(r.price_hkd) || 0, message: "已付款，款項由平台代收，完成後月結過數給場地" });
  } catch (err) {
    console.error("venue-rentals/pay error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/:id/mark-paid — 管理員確認收款（FPS/PayMe 人手）=====
router.post("/:id/mark-paid", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const r = db.prepare("SELECT * FROM venue_rentals WHERE id = ?").get(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: "租場紀錄不存在" });
    const method = (req.body && req.body.method) || "fps";
    db.prepare("UPDATE venue_rentals SET payment_status='paid', paid_at=datetime('now'), payment_method=? WHERE id=?").run(method, r.id);
    res.json({ success: true, payment_status: "paid", method });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/venue-rentals/settlements?month= — 場地結算預覽 =====
router.get("/settlements", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const { computeSettlement, monthKey } = require("../services/venue-settlement");
    const month = req.query.month || monthKey();
    res.json({
      success: true,
      data: { ...computeSettlement(venue.id, month), rating: computeVenueRating(venue.id) },
    });
  } catch (err) {
    console.error("venue-rentals/settlements error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/settlements/run — 管理員跑月度結算 =====
router.post("/settlements/run", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { runMonth, monthKey } = require("../services/venue-settlement");
    const month = (req.body && req.body.month) || monthKey();
    res.json({ success: true, ...runMonth(month) });
  } catch (err) {
    console.error("venue-rentals/settlements/run error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/settlements/:id/pay — 管理員標記已過數 =====
router.post("/settlements/:id/pay", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { markPaid } = require("../services/venue-settlement");
    const r = markPaid(req.params.id, req.body && req.body.note);
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.json({ success: true, message: "已標記過數" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/venue-rentals/:id/venue-cancel — 場地方未能提供場地（手續費 200%）=====
router.post("/:id/venue-cancel", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const db = getDb();
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const r = db.prepare("SELECT * FROM venue_rentals WHERE id = ? AND venue_id = ?").get(req.params.id, venue.id);
    if (!r) return res.status(404).json({ success: false, error: "租場紀錄不存在" });
    if (r.status !== "confirmed") return res.status(400).json({ success: false, error: "只適用於已確認嘅租場" });

    const fee = Math.round((Number(r.price_hkd) || 0) * 2 * 100) / 100; // 200%
    db.prepare("CREATE TABLE IF NOT EXISTS venue_penalties (id TEXT PRIMARY KEY, rental_id TEXT, venue_id TEXT, coach_id TEXT, type TEXT, amount_hkd REAL, status TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now')))").run();

    // 已付款 → 全額退回教練（錢包）
    let refunded = false;
    if (r.payment_status === "paid" && Number(r.price_hkd) > 0) {
      try {
        const walletService = require("../services/wallet-service");
        const w = walletService.creditWallet({
          userId: r.coach_id,
          amount: Number(r.price_hkd),
          type: "venue_rental_refund",
          description: `場地未能提供，全額退款（${r.start_time} - ${r.end_time}）`,
          reference: r.id,
          sourceType: "venue_rental",
          sourceId: r.id,
        });
        if (w && w.success) {
          refunded = true;
          db.prepare("UPDATE venue_rentals SET payment_status='refunded' WHERE id=?").run(r.id);
        }
      } catch (e) {
        console.error("venue-cancel refund error:", e.message);
      }
    }

    db.prepare("UPDATE venue_rentals SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    db.prepare(
      "INSERT INTO venue_penalties (id, rental_id, venue_id, coach_id, type, amount_hkd, status, note) VALUES (?,?,?,?,?,?,?,?)",
    ).run(uuidv4(), r.id, venue.id, r.coach_id, "venue_failure_200pct", fee, "pending_charge", (req.body && req.body.note) || "場地方未能提供場地，收取租金 200% 手續費");

    const coach = db.prepare("SELECT name, email FROM users WHERE id = ?").get(r.coach_id);
    if (coach && coach.email) {
      require("../services/notification").emailNotification(
        coach.email,
        "【ZenPass】場地取消通知 — 全額退款",
        `<p>抱歉，<b>${venue.name}</b> 未能提供你已預約嘅場地：<br>${r.start_time} — ${r.end_time}<br>租金 HK$${Number(r.price_hkd || 0).toFixed(2)} 將全額退回，平台會向場地收取手續費。</p>`,
      ).catch(() => {});
    }

    res.json({ success: true, status: "cancelled", refund_full: refunded, venue_fee_hkd: fee, message: "已取消" + (refunded ? "並已全額退款" : "") + "；場地手續費 HK$" + fee.toFixed(2) + " 已記錄" });
  } catch (err) {
    console.error("venue-rentals/venue-cancel error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/venue-rentals/statement — 場地月結單（JSON）=====
router.get("/statement", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const { buildStatement } = require("../services/venue-statement");
    const stmt = buildStatement(venue.id, req.query.month);
    res.json({ success: true, data: stmt });
  } catch (err) {
    console.error("venue-rentals/statement error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/venue-rentals/statement.html — 可列印／儲存 PDF =====
router.get("/statement.html", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).send("只有場地負責人可以使用");
    const { buildStatement, renderStatementHtml } = require("../services/venue-statement");
    const stmt = buildStatement(venue.id, req.query.month);
    res.type("html").send(renderStatementHtml(stmt));
  } catch (err) {
    console.error("venue-rentals/statement.html error:", err.message);
    res.status(500).send("產生月結單失敗：" + err.message);
  }
});

// ===== POST /api/venue-rentals/statement/email — 電郵上月／指定月月結單 =====
router.post("/statement/email", authenticateToken, requireOwnInstitution, async (req, res) => {
  try {
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以使用" });
    const { emailStatement, prevMonthKey } = require("../services/venue-statement");
    const month = req.body && req.body.month ? req.body.month : prevMonthKey();
    const r = await emailStatement(venue.id, month);
    if (r && r.sent) return res.json({ success: true, sent: true, to: venue.email || "", month });
    return res.status(400).json({ success: false, error: (r && r.error) || "發送失敗（可能未設定 SMTP 或場地電郵）" });
  } catch (err) {
    console.error("venue-rentals/statement/email error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET/POST /api/venue-rentals/auto — 自動接受設定 =====
router.get("/auto", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _venueOf(req.user.id);
    res.json({ success: true, auto: venue ? _getAuto(venue.id) : null });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post("/auto", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const venue = _venueOf(req.user.id);
    if (!venue) return res.status(403).json({ success: false, error: "只有場地負責人可以設定" });
    res.json({ success: true, auto: _setAuto(venue.id, req.body || {}) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
