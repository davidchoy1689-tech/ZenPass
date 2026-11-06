/**
 * 長者隨身簽到卡（90mm × 54mm 雙面）資料組裝
 * 2026-11-06
 *
 * 設計原則：
 * - 只讀，唔改任何狀態
 * - 個資最小化：只輸出打印卡需要嘅欄位（唔出 HKID、唔出 email）
 * - QR = zenpass:checkin:{booking_id}:{hmac10}（同教練掃碼一致）
 */
const QRCode = require("qrcode");
const { getDb } = require("./database");
const bookingQr = require("./booking-qr");

function setting(db, key, fallback) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key=?").get(key);
    return (r && r.value) || fallback;
  } catch (e) {
    return fallback;
  }
}

function hktParts(iso) {
  const d = new Date(String(iso || "").replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(String(iso || "")) ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return { date: "", time: "", weekday: "" };
  const hk = new Date(d.getTime() + 8 * 3600 * 1000);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][hk.getUTCDay()];
  return {
    date: `${hk.getUTCFullYear()}-${String(hk.getUTCMonth() + 1).padStart(2, "0")}-${String(hk.getUTCDate()).padStart(2, "0")}`,
    time: `${String(hk.getUTCHours()).padStart(2, "0")}:${String(hk.getUTCMinutes()).padStart(2, "0")}`,
    weekday: "星期" + wd,
  };
}

function honorific(gender, birthYear) {
  const g = String(gender || "").toLowerCase();
  if (["male", "m", "男"].includes(g)) return "伯伯";
  if (["female", "f", "女"].includes(g)) return "婆婆";
  const y = Number(birthYear);
  if (y && y <= 1966) return "先生／女士";
  return "";
}

function loadBookingCard(db, bookingId) {
  const b = db
    .prepare(
      `SELECT b.id, b.booking_reference, b.status, b.payment_status, b.attendee_type,
              b.child_name, b.medical_notes, b.emergency_phone,
              COALESCE(NULLIF(b.parent_name,''), u.name) AS student_name,
              COALESCE(NULLIF(b.parent_phone,''), u.phone) AS student_phone,
              u.name AS account_name, u.gender, u.birth_year,
              u.emergency_name AS user_emergency_name, u.emergency_phone AS user_emergency_phone,
              c.title AS class_title, c.venue_name, c.venue_address, c.latitude, c.longitude,
              cs.start_time, cs.end_time
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         JOIN classes c ON c.id = b.class_id
         LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
        WHERE b.id = ?`,
    )
    .get(String(bookingId || ""));
  if (!b) return null;

  const isChild = String(b.attendee_type || "") === "parent" && b.child_name;
  const studentName = (isChild ? b.child_name : b.student_name) || b.account_name || "學員";
  const suffix = honorific(b.gender, b.birth_year);
  const displayName = suffix ? `${studentName} ${suffix}` : studentName;
  const when = hktParts(b.start_time);
  const ends = hktParts(b.end_time);

  const emergencyName = b.user_emergency_name || b.emergency_name || (isChild ? b.account_name : "") || "家人";
  const emergencyPhone = b.user_emergency_phone || b.emergency_phone || b.student_phone || "";

  return {
    booking_id: b.id,
    booking_reference: b.booking_reference || "",
    student_name: studentName,
    display_name: displayName,
    salute: suffix,
    health_notes: String(b.medical_notes || "").trim().slice(0, 60),
    class_title: b.class_title || "樂齡體適能",
    date: when.date,
    weekday: when.weekday,
    time: when.time,
    end_time: ends.time,
    venue_name: b.venue_name || "",
    venue_address: b.venue_address || "",
    venue_lat: b.latitude || null,
    venue_lng: b.longitude || null,
    route_hint: setting(db, "card.route_hint", "請預留 10 分鐘步行時間，提前 15 分鐘到達場地"),
    emergency_name: emergencyName,
    emergency_phone: emergencyPhone,
    support_phone: setting(db, "card.support_phone", "9033 5538"),
    status: b.status,
    payment_status: b.payment_status,
  };
}

async function qrFor(bookingId) {
  const payload = bookingQr.make(bookingId);
  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 600, errorCorrectionLevel: "M" });
  return { payload, data_url: dataUrl };
}

async function buildCard(bookingId) {
  const db = getDb();
  const card = loadBookingCard(db, bookingId);
  if (!card) return null;
  const qr = await qrFor(card.booking_id);
  return { ...card, qr };
}

module.exports = { buildCard, loadBookingCard, honorific, hktParts };
