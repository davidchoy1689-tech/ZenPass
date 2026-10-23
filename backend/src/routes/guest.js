/**
 * ZenPass 禪流 - 訪客快速結賬（Guest Checkout）
 *
 * 目標：未登入用戶只需「姓名 + WhatsApp 電話」即可完成預約，
 * 唔需要設定密碼，減低結賬流失。
 *
 * 設計取捨（安全優先）：
 *  - 電話號碼已存在任何帳號 → 拒絕（409 PHONE_EXISTS），唔會自動登入任何人
 *    （否則知道電話號碼就可以接管他人帳號）
 *  - 訪客帳號 auth_provider='guest'，email 用 guest+xxx@guest.zenpass.local 佔位
 *  - 每位訪客獲發一次性 session token（guest_sessions），只可以存取自己嘅 booking
 *  - 訪客只可以用單次付款（FPS / PayMe），冇 credits 結餘
 */

const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const { getDb } = require("../services/database");
const bookingService = require("../services/booking-service");
const { publicFormLimiter } = require("../middleware/public-form-limit");

const router = express.Router();

const SESSION_DAYS = 30;
const bookLimiter = publicFormLimiter({
  max: 12,
  windowMs: 60 * 60 * 1000,
  message: "提交太頻繁，請稍後再試或聯絡我們",
});

// ============ helpers ============

function normPhone(raw) {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (d.startsWith("852") && d.length === 11) d = d.slice(3);
  if (d.startsWith("0") && d.length === 9) d = d.slice(1);
  return d;
}

function validPhone(p) {
  // 香港手機：8 位，4-7 / 8-9 開頭
  return /^[4-9]\d{7}$/.test(p);
}

function cleanName(n) {
  return String(n || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_guest_sessions_user ON guest_sessions(user_id);
  `);
}

function findUserByPhone(db, phone) {
  const rows = db.prepare("SELECT id, name, phone FROM users WHERE phone IS NOT NULL AND phone != ''").all();
  return rows.find((r) => normPhone(r.phone) === phone) || null;
}

function createGuestUser(db, name, phone) {
  const id = uuidv4();
  const email = `guest+${id.slice(0, 8)}@guest.zenpass.local`;
  // 隨機密碼（冇人知）→ 帳號唔可以被登入；訪客只透過 guest token 存取
  const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10);
  const ref = "G" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
  db.prepare(
    `INSERT INTO users (id, user_reference, email, password_hash, name, phone, auth_provider, email_verified, agree_terms, penalty_consent, role, lead_source, tags)
     VALUES (?, ?, ?, ?, ?, ?, 'email', 1, 1, 1, 'user', 'guest_checkout', 'guest')`,
  ).run(id, ref, email, randomHash, name, phone);
  return id;
}

function issueToken(db, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO guest_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, exp);
  return { token, expires_at: exp };
}

function sessionUser(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.name, u.phone
       FROM guest_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(String(token));
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  try {
    db.prepare("UPDATE guest_sessions SET last_seen_at = datetime('now') WHERE token = ?").run(row.token);
  } catch (e) {}
  return row;
}

function guestBookings(db, userId) {
  return db
    .prepare(
      `SELECT b.id, b.booking_reference, b.status, b.payment_status, b.payment_method,
              b.amount, b.fps_reference, b.payme_reference, b.created_at,
              s.start_time, s.end_time, c.title AS class_title,
              COALESCE(v.name, c.venue_name) AS venue_name,
              COALESCE(v.address, c.venue_address) AS venue_address
       FROM bookings b
       JOIN class_schedules s ON s.id = b.schedule_id
       JOIN classes c ON c.id = b.class_id
       LEFT JOIN partner_venues v ON v.id = c.partner_venue_id
       WHERE b.user_id = ?
       ORDER BY s.start_time ASC`,
    )
    .all(userId);
}

// ============ POST /api/guest/book ============
router.post("/book", bookLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const name = cleanName(body.name);
    const phone = normPhone(body.phone);
    const classId = String(body.classId || body.class_id || "").trim();
    const scheduleIds = (Array.isArray(body.scheduleIds) ? body.scheduleIds : [body.scheduleId])
      .filter(Boolean)
      .map((x) => String(x));
    const groupSize = Number(body.groupSize) === 3 ? 3 : 1;
    const promoCode = body.promoCode ? String(body.promoCode).trim() : undefined;

    if (name.length < 2) return res.status(400).json({ success: false, error: "請填寫姓名（最少 2 個字）" });
    if (!validPhone(phone)) return res.status(400).json({ success: false, error: "請填寫有效嘅香港手機號碼（8 位）" });
    if (!classId || !scheduleIds.length) return res.status(400).json({ success: false, error: "缺少課程或時段" });
    if (scheduleIds.length > 40) return res.status(400).json({ success: false, error: "一次最多 40 個時段" });

    const db = getDb();
    db.pragma("foreign_keys = ON");
    ensureSchema(db);

    // 已有帳號 → 唔可以代佢預約（防止帳號接管）
    const existing = findUserByPhone(db, phone);
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "PHONE_EXISTS",
        error: "此電話已有 ZenPass 帳號，請登入後預約（可用「忘記密碼」重設）",
        login_url: "login.html",
      });
    }

    const userId = createGuestUser(db, name, phone);
    const results = [];
    let created = 0;

    for (const sid of scheduleIds) {
      const fakeReq = {
        body: {
          schedule_id: sid,
          class_id: classId,
          payment_type: "single",
          penalty_consent: true,
          group_size: groupSize,
          promo_code: promoCode,
        },
        user: { id: userId, name, phone },
        headers: req.headers,
        ip: req.ip,
      };
      let out;
      try {
        out = await bookingService.createBooking(fakeReq, {});
      } catch (err) {
        console.error("guest booking error:", err.message);
        out = { status: 500, body: { success: false, error: "預約失敗" } };
      }
      if (out && out.status === 201) created++;
      results.push({
        status: out ? out.status : 500,
        schedule_id: sid,
        booking_id: out && out.body && out.body.booking_id,
        booking_reference: out && out.body && out.body.booking_reference,
        amount: out && out.body && out.body.amount,
        error: out && out.body && out.body.error,
      });
    }

    if (!created) {
      // 全部失敗 → 唔好留低空帳號
      try {
        db.prepare("DELETE FROM users WHERE id = ? AND lead_source = 'guest_checkout'").run(userId);
      } catch (e) {}
      return res.status(400).json({
        success: false,
        error: (results.find((r) => r.error) || {}).error || "預約失敗，請重試",
        results,
      });
    }

    const { token, expires_at } = issueToken(db, userId);
    const rows = guestBookings(db, userId);
    const createdIds = results.filter((r) => r.booking_id).map((r) => r.booking_id);
    const total = rows
      .filter((b) => createdIds.includes(b.id))
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);

    return res.status(201).json({
      success: true,
      guest: true,
      token,
      token_expires_at: expires_at,
      user: { name, phone },
      created,
      total,
      bookings: rows,
      results,
    });
  } catch (err) {
    console.error("guest book failed:", err);
    return res.status(500).json({ success: false, error: "預約失敗，請稍後再試" });
  }
});

// ============ GET /api/guest/session?token= ============
router.get("/session", (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const s = sessionUser(db, req.query.token);
    if (!s) return res.status(401).json({ success: false, error: "連結已失效，請重新預約或聯絡我們" });
    return res.json({
      success: true,
      user: { name: s.name, phone: s.phone },
      bookings: guestBookings(db, s.id),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

// ============ POST /api/guest/payment ============
router.post("/payment", bookLimiter, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const { token, booking_id, method, reference } = req.body || {};
    const s = sessionUser(db, token);
    if (!s) return res.status(401).json({ success: false, error: "連結已失效，請重新預約" });
    if (!booking_id) return res.status(400).json({ success: false, error: "缺少 booking_id" });
    const m = method === "payme" ? "payme" : "fps";
    const ref = String(reference || "").trim();
    if (!ref) return res.status(400).json({ success: false, error: "請提供付款參考編號" });

    const booking = db
      .prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?")
      .get(booking_id, s.id);
    if (!booking) return res.status(404).json({ success: false, error: "預約不存在" });

    const amount = Number(booking.amount) || 0;
    if (m === "fps") {
      db.prepare(
        `UPDATE bookings SET fps_reference = ?, payment_method = 'fps',
           status = 'pending_payment', payment_status = 'pending' WHERE id = ?`,
      ).run(ref, booking_id);
    } else {
      db.prepare(
        `UPDATE bookings SET payme_reference = ?, payment_method = 'payme',
           status = 'pending_payment', payment_status = 'pending' WHERE id = ?`,
      ).run(ref, booking_id);
    }

    db.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, payment_method, ${m === "fps" ? "fps_reference" : "payme_reference"}, status, description)
       VALUES (?, ?, 'single_booking', ?, ?, ?, 'pending', ?)`,
    ).run(
      uuidv4(),
      s.id,
      amount,
      m,
      ref,
      (m === "fps" ? "FPS" : "PayMe") + " 付款（訪客）— 待管理員確認",
    );

    return res.json({ success: true, message: "付款資料已提交，管理員核實後會確認預約" });
  } catch (err) {
    console.error("guest payment failed:", err);
    return res.status(500).json({ success: false, error: "提交失敗，請重試" });
  }
});

// ============ POST /api/guest/relock — 重新鎖定名額（延長 hold） ============
router.post("/relock", bookLimiter, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const s = sessionUser(db, (req.body || {}).token);
    if (!s) return res.status(401).json({ success: false, error: "連結已失效，請重新預約" });

    const pending = db
      .prepare("SELECT id FROM bookings WHERE user_id = ? AND status = 'pending_payment'")
      .all(s.id);
    if (!pending.length) {
      return res.status(409).json({ success: false, code: "NO_HOLD", error: "名額已釋放，請重新預約" });
    }
    db.prepare("UPDATE bookings SET created_at = datetime('now') WHERE user_id = ? AND status = 'pending_payment'").run(s.id);
    return res.json({ success: true, bookings: guestBookings(db, s.id) });
  } catch (err) {
    console.error("guest relock failed:", err);
    return res.status(500).json({ success: false, error: "重新鎖定失敗，請重試" });
  }
});

module.exports = router;
