/**
 * 公開只讀端點（免登入，需簽章）
 * GET /api/public/bookings/:id?share=<16hex>
 *
 * 只回傳入場必需欄位；不含付款、金額、audit、其他訂單。
 * 簽章不符 → 403（統一訊息，避免遍歷探測）
 */
const express = require("express");
const QRCode = require("qrcode");
const { getDb } = require("../services/database");
const shareToken = require("../services/share-token");
const bookingQr = require("../services/booking-qr");

const router = express.Router();

function hkt(iso) {
  const s = String(iso || "");
  const d = new Date(s.replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return { date: "", time: "", weekday: "" };
  const h = new Date(d.getTime() + 8 * 3600 * 1000);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][h.getUTCDay()];
  return {
    date: `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}-${String(h.getUTCDate()).padStart(2, "0")}`,
    time: `${String(h.getUTCHours()).padStart(2, "0")}:${String(h.getUTCMinutes()).padStart(2, "0")}`,
    weekday: "星期" + wd,
  };
}

router.get("/bookings/:id", async (req, res) => {
  try {
    const db = getDb();
    const b = db
      .prepare(
        `SELECT b.id, b.booking_reference, b.created_at, b.schedule_id, b.attendee_type,
                b.child_name, b.parent_name, b.parent_phone, b.medical_notes, b.coach_tags,
                b.status,
                u.name AS account_name, u.phone, u.emergency_name, u.emergency_phone,
                c.title, c.venue_name, c.venue_address, c.latitude, c.longitude,
                cs.start_time, cs.end_time, cu.name AS coach_name
           FROM bookings b
           JOIN users u ON u.id = b.user_id
           JOIN classes c ON c.id = b.class_id
           LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
           LEFT JOIN users cu ON cu.id = c.coach_id
          WHERE b.id = ?`,
      )
      .get(String(req.params.id || ""));

    // 統一錯誤：唔會透露 booking 是否存在
    if (!b || !shareToken.verify({ ...b, phone: b.parent_phone || b.phone }, req.query.share)) {
      return res.status(403).json({ success: false, error: "連結已失效或無效" });
    }

    const start = hkt(b.start_time);
    const end = hkt(b.end_time);
    const studentName = b.parent_name || b.child_name || b.account_name || "學員";
    const isSenior = String(b.attendee_type || "") === "parent";
    let tags = [];
    try { tags = b.coach_tags ? JSON.parse(b.coach_tags) : []; } catch (e) {}

    const emergencyName = b.emergency_name || (isSenior ? b.account_name : "") || "";
    const emergencyPhone = shareToken.maskedPhone(b.emergency_phone || b.parent_phone || b.phone);

    const qrPayload = bookingQr.make(b.id);
    let qrDataUrl = "";
    try { qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 600, errorCorrectionLevel: "M" }); } catch (e) {}

    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      card: {
        booking_id: b.id,
        booking_reference: b.booking_reference || "",
        student_name: studentName,
        student_type: isSenior ? "senior" : "adult",
        salute: "",
        health_notes: String(b.medical_notes || "").trim().slice(0, 60),
        class_title: b.title || "",
        date: start.date,
        weekday: start.weekday,
        time: start.time,
        end_time: end.time,
        venue_name: b.venue_name || "",
        venue_address: b.venue_address || "",
        venue_lat: b.latitude || null,
        venue_lng: b.longitude || null,
        coach_name: b.coach_name || "",
        emergency_contact: { name: emergencyName, phone_masked: emergencyPhone },
        qr: { payload: qrPayload, data_url: qrDataUrl },
        coach_tags: tags,
        status: b.status,
        read_only: true,
      },
    });
  } catch (err) {
    console.error("[PUBLIC] booking share:", err.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

module.exports = router;
