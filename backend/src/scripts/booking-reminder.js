/**
 * ZenPass 課前提醒腳本
 * 掃描未來 1-2 小時內開始、未發送提醒的 booking，發送通知並標記
 *
 * 用法:
 *   node backend/src/scripts/booking-reminder.js
 *
 * PM2 排程: 每 15 分鐘執行一次（由 scheduler.js 或 PM2 cron 控制）
 */

const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "zenpass.db");

function sendBookingReminders() {
  const db = new Database(DB_PATH);
  const ts = new Date().toISOString();
  let sent = 0;

  try {
    // 啟用 WAL 模式避免 lock
    db.pragma("journal_mode = WAL");

    // 掃描 1-2 小時內開始且未提醒的 confirmed booking
    const due = db
      .prepare(
        `
      SELECT b.id, b.user_id, b.class_id, b.schedule_id,
             c.title as class_title, c.venue_name,
             cs.start_time, cs.end_time,
             u.name as user_name, u.email as user_email
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN users u ON b.user_id = u.id
      WHERE b.status = 'confirmed'
        AND (b.reminder_sent_1h IS NULL OR b.reminder_sent_1h = 0)
        AND cs.start_time > datetime('now', '+60 minutes')
        AND cs.start_time < datetime('now', '+120 minutes')
    `
      )
      .all();

    if (due.length === 0) {
      console.log(`[${ts}] ✅ 沒有待提醒的 booking`);
      return { sent: 0, checked: 0 };
    }

    console.log(`[${ts}] 🔔 發現 ${due.length} 個待提醒 booking`);

    for (const booking of due) {
      try {
        const startTime = booking.start_time;
        const date = startTime ? startTime.split("T")[0] : "—";
        const time = startTime ? startTime.split("T")[1]?.slice(0, 5) : "—";

        // Insert notification record
        db.prepare(
          `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`
        ).run(
          `rem-${booking.id}-${Date.now()}`,
          booking.user_id,
          "booking.reminder_1h",
          `⏰ 課前提醒：${booking.class_title}`,
          `你的課程「${booking.class_title}」將於 ${date} ${time} 開始！\n地點：${booking.venue_name || "—"}`,
          JSON.stringify({
            class_title: booking.class_title,
            date,
            time,
            venue: booking.venue_name || "—",
            booking_id: booking.id,
          })
        );

        // Mark as reminded
        db.prepare(
          `UPDATE bookings SET reminder_sent_1h = 1 WHERE id = ?`
        ).run(booking.id);

        console.log(
          `   ✅ ${booking.user_name} → ${booking.class_title} (${date} ${time})`
        );
        sent++;
      } catch (e) {
        console.error(
          `   ❌ 提醒發送失敗 (booking=${booking.id}): ${e.message}`
        );
      }
    }

    console.log(`[${ts}] 📊 已發送 ${sent}/${due.length} 個提醒`);
    return { sent, checked: due.length };
  } catch (err) {
    console.error(`[${ts}] ❌ 課前提醒腳本錯誤:`, err.message);
    return { sent: 0, checked: 0, error: err.message };
  } finally {
    db.close();
  }
}

// 直接執行
if (require.main === module) {
  sendBookingReminders();
}

module.exports = { sendBookingReminders };
