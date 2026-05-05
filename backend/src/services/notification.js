// @ts-check
const Database = require("better-sqlite3");

/**
 * ZenPass Notification Service
 * 支援：站內通知（DB）、Telegram Bot、Email (SMTP)
 *
 * 配置：透過 .env 設定
 * - NOTIFICATION_TYPES=db,telegram,email （啟用邊啲 channel）
 * - TELEGRAM_BOT_TOKEN=xxx
 * - TELEGRAM_CHAT_ID=xxx
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== 1. 站內通知（持久化到 DB）=====
function dbNotification(recipientId, type, title, message, data = {}) {
  try {
    const db = new Database(DB_PATH);
    const { v4: uuidv4 } = require("uuid");

    db.prepare(
      `
      INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `,
    ).run(uuidv4(), recipientId, type, title, message, JSON.stringify(data));

    db.close();
    return true;
  } catch (err) {
    console.error("DB notification error:", err.message);
    return false;
  }
}

// ===== 2. Telegram 通知 =====
async function telegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log(
      "⚠️ Telegram not configured - set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    );
    return false;
  }

  try {
    const fetch = require("node-fetch");
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      },
    );
    const data = await res.json();
    if (!data.ok) {
      console.error("Telegram send error:", data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram notification error:", err.message);
    return false;
  }
}

// ===== 3. Email 通知 (SMTP) =====
async function emailNotification(to, subject, html) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log("⚠️ SMTP not configured - set SMTP_HOST, SMTP_USER, SMTP_PASS");
    return false;
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: user,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error("Email notification error:", err.message);
    return false;
  }
}

// ===== 4. 統一發送介面 =====
async function sendNotification(type, payload) {
  const types = (process.env.NOTIFICATION_TYPES || "db").split(",");
  const results = {};

  const { recipient, data } = payload;

  // 決定通知內容
  let title, message, html;
  switch (type) {
    case "booking.confirmed":
      title = "預約確認";
      message = `✅ 預約成功！\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"} ${data?.time || "—"}\n場地：${data?.venue || "—"}\n教練：${data?.coach_name || "—"}`;
      html = `<h2>✅ 預約確認</h2><p><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"} ${data?.time || "—"}<br><b>場地：</b>${data?.venue || "—"}<br><b>教練：</b>${data?.coach_name || "—"}</p>`;
      break;
    case "booking.cancelled":
      title = "預約取消";
      message = `❌ 預約已取消\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"}`;
      html = `<h2>❌ 預約取消</h2><p><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"}</p>`;
      break;
    case "coach.new_booking":
      title = "新預約通知";
      message = `📅 有新預約！\n學生：${data?.student_name || "—"}\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"} ${data?.time || "—"}\n金額：$${data?.amount || "—"}`;
      html = `<h2>📅 新預約通知</h2><p><b>學生：</b>${data?.student_name || "—"}<br><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"} ${data?.time || "—"}<br><b>金額：</b>$${data?.amount || "—"}</p>`;
      break;
    case "payment.received":
      title = "付款成功";
      message = `💰 付款成功！\n金額：$${data?.amount || "—"}\n方式：${data?.method || "—"}\n參考：${data?.reference || "—"}`;
      html = `<h2>💰 付款成功</h2><p><b>金額：</b>$${data?.amount || "—"}<br><b>方式：</b>${data?.method || "—"}<br><b>參考：</b>${data?.reference || "—"}</p>`;
      break;
    default:
      title = type;
      message = data?.message || "你有一則新通知";
      html = `<p>${data?.message || "你有一則新通知"}</p>`;
  }

  // Send to each enabled channel
  for (const t of types) {
    switch (t.trim()) {
      case "db":
        if (recipient) {
          results.db = dbNotification(recipient, type, title, message, data);
        }
        break;
      case "telegram":
        results.telegram = await telegramNotification(message);
        break;
      case "email":
        if (data?.email) {
          results.email = await emailNotification(
            data.email,
            `[ZenPass] ${title}`,
            html,
          );
        }
        break;
    }
  }

  return results;
}

// ===== 5. 通知列表查詢（供 routes/notifications.js 使用）=====

function getNotifications(
  userId,
  { page = 1, limit = 50, unreadOnly = false } = {},
) {
  try {
    const db = new Database(DB_PATH);
    const offset = (page - 1) * limit;

    let whereClause = "WHERE user_id = ?";
    const params = [userId];
    if (unreadOnly) {
      whereClause += " AND is_read = 0";
    }

    const total = db
      .prepare(`SELECT COUNT(*) as count FROM notifications ${whereClause}`)
      .get(...params);
    const rows = db
      .prepare(
        `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    db.close();

    return {
      notifications: rows,
      total: total.count,
      page,
      limit,
      totalPages: Math.ceil(total.count / limit),
    };
  } catch (err) {
    console.error("getNotifications error:", err.message);
    return { notifications: [], total: 0, page, limit, totalPages: 0 };
  }
}

function getUnreadCount(userId) {
  try {
    const db = new Database(DB_PATH);
    const row = db
      .prepare(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
      )
      .get(userId);
    db.close();
    return row.count;
  } catch (err) {
    console.error("getUnreadCount error:", err.message);
    return 0;
  }
}

function markAsRead(id, userId) {
  try {
    const db = new Database(DB_PATH);
    const result = db
      .prepare(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      )
      .run(id, userId);
    db.close();
    return result.changes > 0;
  } catch (err) {
    console.error("markAsRead error:", err.message);
    return false;
  }
}

function markAllAsRead(userId) {
  try {
    const db = new Database(DB_PATH);
    const result = db
      .prepare(
        "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      )
      .run(userId);
    db.close();
    return result.changes;
  } catch (err) {
    console.error("markAllAsRead error:", err.message);
    return 0;
  }
}

module.exports = {
  sendNotification,
  dbNotification,
  telegramNotification,
  emailNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
