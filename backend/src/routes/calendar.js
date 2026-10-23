/**
 * ZenPass 禪流 - 公開 iCalendar (.ics) 產生器
 *
 * 用途：成功預約後「加到手機行事曆」真正可用（iOS/Android 直接開日曆）
 * 只包含公開課堂資訊（標題／時間／地點），唔會有任何用戶或付款資料。
 *
 * GET /api/calendar/schedule.ics?ids=<scheduleId>,<scheduleId>
 */

const express = require("express");
const { getDb } = require("../services/database");

const router = express.Router();

function icsEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

function parseDate(raw) {
  const s = String(raw || "");
  if (!s) return null;
  const iso = /Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

// RFC 5545: 每行最多 75 octets，長行要摺行
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const size = first ? 75 : 74;
    let end = Math.min(start + size, bytes.length);
    // 唔好切斷 multi-byte 字元
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((first ? "" : " ") + bytes.slice(start, end).toString("utf8"));
    start = end;
    first = false;
  }
  return out.join("\r\n");
}

router.get("/schedule.ics", (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);
    if (!ids.length) return res.status(400).send("missing ids");

    const db = getDb();
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT s.id, s.start_time, s.end_time, s.notes,
                c.title, COALESCE(v.name, c.venue_name) AS venue_name,
                COALESCE(v.address, c.venue_address) AS venue_address,
                c.duration
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN partner_venues v ON v.id = c.partner_venue_id
         WHERE s.id IN (${placeholders})`,
      )
      .all(...ids);

    if (!rows.length) return res.status(404).send("not found");

    const now = toUtc(new Date());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ZenPass//ZenPass Booking//ZH-HK",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:ZenPass 課堂",
      "X-WR-TIMEZONE:Asia/Hong_Kong",
    ];

    for (const r of rows) {
      const st = parseDate(r.start_time);
      if (!st) continue;
      const en = parseDate(r.end_time) || new Date(st.getTime() + (Number(r.duration) || 60) * 60000);
      const loc = [r.venue_name, r.venue_address].filter(Boolean).join(" ");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${r.id}@zenpass.hk`,
        `DTSTAMP:${now}`,
        `DTSTART:${toUtc(st)}`,
        `DTEND:${toUtc(en)}`,
        fold(`SUMMARY:${icsEscape("ZenPass｜" + (r.title || "課堂"))}`),
        fold(`LOCATION:${icsEscape(loc)}`),
        fold(`DESCRIPTION:${icsEscape("請提前 10 分鐘到達。如需改期或取消，請於開課前 24 小時喺 zenpass.hk 辦理。")}`),
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        // 上課前 60 分鐘提醒
        "BEGIN:VALARM",
        "TRIGGER:-PT60M",
        "ACTION:DISPLAY",
        fold("DESCRIPTION:ZenPass 課堂提醒"),
        "END:VALARM",
        "END:VEVENT",
      );
    }

    lines.push("END:VCALENDAR");
    const ics = lines.join("\r\n") + "\r\n";

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="zenpass-class.ics"');
    res.setHeader("Cache-Control", "no-store");
    return res.send(ics);
  } catch (err) {
    console.error("ics generate failed:", err.message);
    return res.status(500).send("ics error");
  }
});

module.exports = router;
