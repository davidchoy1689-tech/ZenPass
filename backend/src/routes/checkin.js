/**
 * Phase 4.2 — 動態 QR 核銷、地理圍欄、門禁 PIN、防刷審計
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const studioLedger = require("../services/studio-ledger");
const checkinAccessToken = require("../services/checkin-access-token");

const router = express.Router();
const WINDOW_MS = 30000;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_access_configs (
      id TEXT PRIMARY KEY,
      studio_id TEXT NOT NULL,
      access_type TEXT DEFAULT 'qr_scanner',
      totp_secret TEXT NOT NULL,
      geo_fence_radius_meters INTEGER DEFAULT 150,
      lock_webhook_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_access_studio ON studio_access_configs(studio_id);
    CREATE TABLE IF NOT EXISTS checkin_audit_incidents (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      coach_id TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      incident_type TEXT NOT NULL,
      details TEXT NOT NULL,
      is_resolved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_checkin_incident_booking ON checkin_audit_incidents(booking_id);
  `);
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const add = [["checkin_method", "TEXT"], ["checkin_lat", "REAL"], ["checkin_lng", "REAL"], ["checkin_device_hash", "TEXT"], ["fraud_audit_status", "TEXT DEFAULT 'clean'"], ["attendance_status", "TEXT"]];
  add.forEach(([n, t]) => { if (!cols.includes(n)) db.exec(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`); });
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_bookings_audit ON bookings(fraud_audit_status,attendance_status)"); } catch (e) {}
}

function secret() {
  return process.env.CHECKIN_HMAC_SECRET || process.env.JWT_SECRET || "zenpass-checkin-dev";
}
function windowNow() { return Math.floor(Date.now() / WINDOW_MS); }
function sign(payload) { return crypto.createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32); }

function makeToken(bookingId, studentId, win) {
  const w = win == null ? windowNow() : Number(win);
  const payload = `${bookingId}|${studentId}|${w}`;
  return "zk_" + Buffer.from(payload, "utf8").toString("base64url") + "." + sign(payload);
}

function verifyToken(token) {
  const s = String(token || "");
  if (!s.startsWith("zk_")) return { ok: false, code: "TOKEN_INVALID" };
  const idx = s.indexOf(".");
  if (idx < 0) return { ok: false, code: "TOKEN_INVALID" };
  let payload;
  try { payload = Buffer.from(s.slice(3, idx), "base64url").toString("utf8"); } catch (e) { return { ok: false, code: "TOKEN_INVALID" }; }
  const sig = s.slice(idx + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, code: "TOKEN_INVALID" };
  }
  const [bookingId, studentId, w] = payload.split("|");
  if (Number(w) !== windowNow()) return { ok: false, code: "TOKEN_EXPIRED" };
  return { ok: true, bookingId, studentId, window: Number(w) };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function canAccess(db, requesterId, booking) {
  if (booking.user_id === requesterId) return true;
  return !!db.prepare(
    `SELECT 1 FROM family_members fm JOIN family_groups fg ON fg.id=fm.family_group_id
      WHERE fm.member_user_id=? AND fg.owner_user_id=? LIMIT 1`,
  ).get(booking.user_id, requesterId);
}

function loadBooking(db, id) {
  return db.prepare(
    `SELECT b.*, s.start_time, s.end_time, s.studio_id, c.title, c.latitude AS class_lat, c.longitude AS class_lng,
            m.latitude AS studio_lat, m.longitude AS studio_lng, m.studio_name
       FROM bookings b JOIN class_schedules s ON s.id=b.schedule_id JOIN classes c ON c.id=b.class_id
       LEFT JOIN merchant_studios m ON m.id=s.studio_id WHERE b.id=?`,
  ).get(id);
}

function inCheckinWindow(startTime) {
  const raw = String(startTime || "");
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z").getTime();
  const diff = Date.now() - d;
  return diff >= -30 * 60000 && diff <= 45 * 60000;
}

router.get("/student/checkin-token/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = loadBooking(db, req.params.bookingId);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });
    if (!canAccess(db, req.user.id, b)) return res.status(403).json({ success: false, error: "無權取得此憑證" });
    if (b.status !== "confirmed") return res.status(400).json({ success: false, error: "此預約不是確認狀態", code: "BOOKING_NOT_CONFIRMED" });
    if (!inCheckinWindow(b.start_time)) return res.status(400).json({ success: false, error: "未到可入場時間", code: "CHECKIN_WINDOW_CLOSED" });
    const token = makeToken(b.id, b.user_id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, token, qr_data: token, expires_in_seconds: Math.max(1, Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 1000)), booking_id: b.id });
  } catch (e) {
    console.error("[CHECKIN] token:", e.message);
    res.status(500).json({ success: false, error: "生成憑證失敗" });
  }
});

router.get("/student/door-pin/:bookingId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = loadBooking(db, req.params.bookingId);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });
    if (!canAccess(db, req.user.id, b)) return res.status(403).json({ success: false, error: "無權取得門禁碼" });
    if (!inCheckinWindow(b.start_time)) return res.status(400).json({ success: false, error: "未到可入場時間", code: "CHECKIN_WINDOW_CLOSED" });
    const cfg = b.studio_id ? db.prepare("SELECT * FROM studio_access_configs WHERE studio_id=?").get(b.studio_id) : null;
    const base = cfg ? cfg.totp_secret : secret();
    const pin = String(Number("0x" + crypto.createHmac("sha256", base).update(`pin|${b.id}|${windowNow()}`).digest("hex").slice(0, 8)) % 1000000).padStart(6, "0");
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, pin, expires_in_seconds: Math.max(1, Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 1000)), access_type: cfg ? cfg.access_type : "qr_scanner" });
  } catch (e) {
    res.status(500).json({ success: false, error: "生成門禁碼失敗" });
  }
});

router.post("/student/door-unlock", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = loadBooking(db, (req.body || {}).booking_id);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });
    if (!canAccess(db, req.user.id, b)) return res.status(403).json({ success: false, error: "無權解鎖" });
    const cfg = b.studio_id ? db.prepare("SELECT * FROM studio_access_configs WHERE studio_id=?").get(b.studio_id) : null;
    const base = cfg ? cfg.totp_secret : secret();
    const pin = String((req.body || {}).pin || "");
    const expected = String(Number("0x" + crypto.createHmac("sha256", base).update(`pin|${b.id}|${windowNow()}`).digest("hex").slice(0, 8)) % 1000000).padStart(6, "0");
    if (pin !== expected) return res.status(400).json({ success: false, code: "PIN_INVALID", error: "門禁碼錯誤或已過期" });
    res.json({ success: true, unlocked: true, door: b.studio_name || "場地", expires_in_seconds: 27 });
  } catch (e) {
    res.status(500).json({ success: false, error: "解鎖失敗" });
  }
});

router.post("/bookings/:id/access-token", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    checkinAccessToken.ensureSchema(db);
    const b = db
      .prepare(
        `SELECT b.id, b.user_id, b.status, b.schedule_id, s.start_time
           FROM bookings b LEFT JOIN class_schedules s ON s.id = b.schedule_id
          WHERE b.id = ?`,
      )
      .get(String(req.params.id));
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });
    if (b.user_id !== req.user.id) {
      const fam = db
        .prepare(
          `SELECT 1 FROM family_members fm JOIN family_groups fg ON fg.id=fm.family_group_id
            WHERE fm.member_user_id=? AND fg.owner_user_id=? AND COALESCE(fm.can_consume_pass,1)=1 LIMIT 1`,
        )
        .get(b.user_id, req.user.id);
      if (!fam) return res.status(403).json({ success: false, error: "無權取得此憑證" });
    }
    if (String(b.status) !== "confirmed") {
      return res.status(409).json({ success: false, code: "BOOKING_NOT_CONFIRMED", error: "此預約未生效，無法發出憑證" });
    }
    const startRaw = String(b.start_time || "");
    const start = startRaw
      ? new Date(/Z|[+-]\d\d:?\d\d$/.test(startRaw) ? startRaw : startRaw.replace(" ", "T") + "Z")
      : null;
    const hardEnd = start && !Number.isNaN(start.getTime()) ? start.getTime() + 2 * 3600000 : Date.now() + 2 * 3600000;
    if (hardEnd < Date.now()) return res.status(400).json({ success: false, code: "CLASS_ENDED", error: "課堂已結束" });
    const ttlHours = Math.max(0.25, (hardEnd - Date.now()) / 3600000);

    const t = checkinAccessToken.issue(db, b.id, { ttlHours: Math.min(ttlHours, 168) });
    res.json({ success: true, token: t.token, url: t.url, expires_at: t.expires_at, booking_id: b.id });
  } catch (e) {
    console.error("[CHECKIN] access-token:", e.message);
    res.status(500).json({ success: false, error: "憑證簽發失敗" });
  }
});

router.post("/coach/verify-checkin", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    checkinAccessToken.ensureSchema(db);
    const b0 = req.body || {};

    let bookingId = null;
    let tokenRowId = null;
    let tokenMode = "dynamic";
    let studentId = null;
    if (b0.access_token) {
      // Phase 4.5：一次性入場憑證（2 小時有效，核銷即失效）
      const r = checkinAccessToken.validate(db, b0.access_token);
      if (!r.ok) {
        const map = {
          TOKEN_ALREADY_USED: [403, "此憑證已使用，請重新開啟你的預約"],
          TOKEN_EXPIRED: [400, "憑證已過期，請在課堂前重新開啟"],
          TOKEN_INVALID: [400, "憑證無效"],
          TOKEN_REQUIRED: [400, "缺少憑證"],
        };
        const [code, msg] = map[r.code] || [400, "憑證無效"];
        return res.status(code).json({ success: false, code: r.code, error: msg });
      }
      bookingId = r.booking_id;
      tokenRowId = r.id;
      tokenMode = "one_time";
    } else {
      const v = verifyToken(b0.checkin_token);
      if (!v.ok) return res.status(400).json({ success: false, code: v.code, error: v.code === "TOKEN_EXPIRED" ? "動態碼已過期，請重新整理" : "動態碼無效" });
      bookingId = v.bookingId;
      studentId = v.studentId;
    }

    const b = loadBooking(db, bookingId);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });

    // 🚨 Phase 4.5 硬防線：已取消／流標訂單一律不可核銷（杜絕幽靈扣堂）
    if (String(b.status || "") === "cancelled") {
      return res.status(409).json({
        success: false,
        code: "BOOKING_ALREADY_CANCELLED",
        error: "該預約已被學員取消或流標，嚴禁核銷扣款",
        booking_id: b.id,
      });
    }

    if (tokenMode === "dynamic" && b.user_id !== studentId) {
      // 動態碼與學員綁定（一次性憑證本身已綁 booking，不需再比對）
      return res.status(400).json({ success: false, code: "TOKEN_MISMATCH", error: "憑證與學員不符" });
    }
    if (b.attendance_status === "present" || b.status === "attended") {
      return res.status(409).json({ success: false, code: "ALREADY_CHECKED_IN", error: "已核銷，請勿重複掃碼" });
    }
    const lat = Number(b0.scanner_lat), lng = Number(b0.scanner_lng);
    const tLat = Number(b.studio_lat ?? b.class_lat), tLng = Number(b.studio_lng ?? b.class_lng);
    let dist = null;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(tLat) && Number.isFinite(tLng) && !(tLat === 0 && tLng === 0)) {
      dist = Math.round(haversineMeters(lat, lng, tLat, tLng));
    }
    const flagged = dist != null && dist > 300;
    const fraudStatus = flagged ? "flagged_distance" : "clean";
    const method = b0.method || "dynamic_qr";
    db.prepare(
      `UPDATE bookings SET status='attended', attendance_status='present', checkin_method=?, checkin_lat=?, checkin_lng=?,
              checkin_device_hash=?, fraud_audit_status=? WHERE id=?`,
    ).run(method, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, String(b0.device_hash || "").slice(0, 120), fraudStatus, b.id);
    // ✅ 核銷成功才消耗一次性憑證（避免失敗時白白燒掉 token）
    if (tokenRowId) {
      try { checkinAccessToken.markUsed(db, tokenRowId); } catch (e) {}
    }

    if (flagged) {
      db.prepare(
        `INSERT INTO checkin_audit_incidents (id,booking_id,coach_id,student_user_id,incident_type,details)
         VALUES (?,?,?,?, 'excessive_distance', ?)`,
      ).run("cai_" + crypto.randomBytes(8).toString("hex"), b.id, req.user.id, b.user_id, JSON.stringify({ distance_m: dist, scanner_lat: lat, scanner_lng: lng }));
    }
    let settled = false;
    if (!flagged) {
      try {
        if (b.studio_id) {
          studioLedger.settleStudioSchedule(b.schedule_id);
        } else {
          require("./coach-earnings").syncCoachEarningsForSchedule(b.schedule_id);
          require("../services/coach-affiliate").settleSchedule(b.schedule_id);
        }
        settled = true;
      } catch (e) {
        console.error("[CHECKIN] settle:", e.message);
      }
    }
    try {
      audit({
        actionType: flagged ? "checkin.flagged_distance" : "checkin.verified",
        entityType: "booking",
        entityId: b.id,
        userId: req.user.id,
        newValues: { distance_m: dist, fraud_audit_status: fraudStatus, settled, method, token_mode: tokenMode },
        description: flagged ? "掃碼距離異常，暫緩結算" : "動態 QR 核銷成功",
      });
    } catch (e) {}
    res.json({
      success: true,
      booking_id: b.id,
      student_name: b.student_name || b.user_id,
      attendance_status: "present",
      fraud_audit_status: fraudStatus,
      distance_meters: dist,
      settled,
      message: flagged ? "已記錄出席，但距離異常，收益暫緩結算" : "核銷成功",
    });
  } catch (e) {
    console.error("[CHECKIN] verify:", e.message);
    res.status(500).json({ success: false, error: "核銷失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
module.exports.makeToken = makeToken;
module.exports.verifyToken = verifyToken;
module.exports.haversineMeters = haversineMeters;
module.exports.windowNow = windowNow;
