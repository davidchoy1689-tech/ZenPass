/**
 * ZenPass - School ECA Pass (學校課外活動合作查詢)
 *
 * 功能：
 * - 學校查詢 ECA 合作（POST /api/school/inquiry）
 * - 存入 school_inquiries table
 * - 通知 admin
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { sendTelegramAlert, sendNotification } = require("../services/notification");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");
const { publicFormLimiter } = require("../middleware/public-form-limit");
const formLimiter = publicFormLimiter();

const router = express.Router();

// ===== POST /api/school/inquiry — 學校查詢 ECA 合作 =====
router.post("/inquiry", formLimiter, async (req, res) => {
  try {
    const { school_name, contact_name, contact_email, contact_phone, sports_of_interest, message } = req.body;

    if (!school_name || !contact_name || !contact_email) {
      return res.status(400).json({ success: false, error: "請填寫學校名稱、聯絡人姓名及電郵" });
    }

    const db = getDb();

    // Create table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS school_inquiries (
        id TEXT PRIMARY KEY,
        school_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        contact_phone TEXT DEFAULT '',
        sports_of_interest TEXT DEFAULT '',
        message TEXT DEFAULT '',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','contacted','converted','closed')),
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    const id = uuidv4();
    db.prepare(`
      INSERT INTO school_inquiries (id, school_name, contact_name, contact_email, contact_phone, sports_of_interest, message, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, school_name, contact_name, contact_email, contact_phone || "", sports_of_interest || "", message || "");

    // Record in blockchain audit trail
    try {
      writeBlock({
        entityType: "school_inquiry",
        entityId: id,
        data: {
          school_name,
          contact_name,
          contact_email,
          contact_phone: contact_phone || "",
          sports_of_interest: sports_of_interest || "",
          message: message || "",
          status: "pending",
          created_at: new Date().toISOString(),
        },
      });
    } catch (be) {
      console.error("[BLOCKCHAIN] writeBlock error:", be.message);
    }

    // Notify admin（站內，避免 Telegram 未設定就漏單）
    try {
      const { notifyAdmins } = require("../services/notify-admins");
      notifyAdmins("school.inquiry", {
        school_name,
        contact_name,
        contact_email,
        contact_phone: contact_phone || "",
        sports_of_interest: sports_of_interest || "",
        message: message || "",
      });
    } catch (e) {}

    // Notify admin
    try {
      await sendTelegramAlert(
        `🏫 <b>新學校 ECA 查詢</b>\n` +
        `學校：${school_name}\n` +
        `聯絡人：${contact_name} (${contact_email})\n` +
        `電話：${contact_phone || "—"}\n` +
        `有興趣項目：${sports_of_interest || "未指定"}\n` +
        `備註：${message || "—"}\n` +
        `⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`
      );
    } catch (notifErr) {
      console.error("[SCHOOL] Notification error:", notifErr.message);
    }

    res.json({
      id,
      message: "✅ 查詢已收到！我哋嘅學校團隊會儘快同你聯絡。"
    });
  } catch (err) {
    console.error("[SCHOOL] Inquiry error:", err);
    res.status(500).json({ success: false, error: "提交查詢失敗，請稍後再試" });
  }
});

// ===== GET /api/school/inquiries — 查詢列表（Admin only）=====
router.get("/inquiries", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const inquiries = db.prepare("SELECT * FROM school_inquiries ORDER BY created_at DESC LIMIT 200").all();
    res.json({ inquiries });
  } catch (err) {
    console.error("[SCHOOL] List error:", err);
    res.status(500).json({ success: false, error: "讀取查詢列表失敗" });
  }
});

module.exports = router;
