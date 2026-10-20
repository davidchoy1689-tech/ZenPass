/**
 * ZenPass — AI 開班 API
 *
 * POST /api/ai-class/parse   文字或圖片 → 課堂草稿（唔會寫 DB）
 * POST /api/ai-class/create  確認草稿 → 一次過建立課堂 + 場次
 *
 * 權限：教練 / 管理員（草稿唔會公開；建立後課堂跟一般課程狀態處理）
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken } = require("../middleware/auth");
const { getDb } = require("../services/database");
const { parseClassText, ocrImage } = require("../services/ai-class-parser");

const router = express.Router();

const COACH_ROLES = ["coach", "admin", "super_admin", "platform_manager", "partner_owner", "partner_staff"];

function requireCoachOrAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: "需要登入認證" });
  const db = getDb();
  const u = db.prepare("SELECT role, is_coach, coach_verified FROM users WHERE id = ?").get(req.user.id);
  if (!u) return res.status(403).json({ success: false, error: "用戶不存在" });
  const ok = u.is_coach === 1 || COACH_ROLES.includes(u.role);
  if (!ok) return res.status(403).json({ success: false, error: "只有教練或管理員可以使用 AI 開班" });
  next();
}

// ===== POST /api/ai-class/parse =====
router.post("/parse", authenticateToken, requireCoachOrAdmin, async (req, res) => {
  try {
    const { text, image_base64, image_mime } = req.body || {};
    if (!text && !image_base64) {
      return res.status(400).json({ success: false, error: "請提供文字或圖片" });
    }

    let extracted = String(text || "");
    let ocrUsed = false;

    if (image_base64) {
      const b64 = String(image_base64).replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      if (!buf.length) return res.status(400).json({ success: false, error: "圖片格式無效" });
      if (buf.length > 8 * 1024 * 1024) {
        return res.status(413).json({ success: false, error: "圖片太大（上限 8MB）" });
      }
      const mime = String(image_mime || "").toLowerCase();
      const ext = /png/.test(mime) ? "png" : /webp/.test(mime) ? "webp" : /jpe?g/.test(mime) ? "jpg" : "png";
      try {
        const ocrText = await ocrImage(buf, ext);
        ocrUsed = true;
        extracted = [extracted, ocrText].filter(Boolean).join("\n").trim();
      } catch (e) {
        console.error("ai-class OCR error:", e.message);
        return res.status(503).json({
          success: false,
          error: "圖片辨識暫時不可用，請改為貼上文字",
          code: "OCR_UNAVAILABLE",
        });
      }
    }

    if (!extracted.trim()) {
      return res.status(422).json({ success: false, error: "辨識唔到文字，請影清楚啲或者直接貼上文字" });
    }

    const draft = parseClassText(extracted);
    res.json({
      success: true,
      data: { draft, extracted_text: extracted.slice(0, 4000), ocr_used: ocrUsed },
    });
  } catch (err) {
    console.error("ai-class/parse error:", err.message);
    res.status(500).json({ success: false, error: "解析失敗" });
  }
});

// ===== POST /api/ai-class/create =====
router.post("/create", authenticateToken, requireCoachOrAdmin, (req, res) => {
  try {
    const d = req.body || {};
    const title = String(d.title || "").trim();
    const category = String(d.category || "").trim();
    const duration = Number(d.duration) || 0;
    const price = Number(d.price_hkd);
    const schedules = Array.isArray(d.schedules) ? d.schedules : [];

    const missing = [];
    if (!title) missing.push("課程名稱");
    if (!category) missing.push("分類");
    if (!(duration > 0)) missing.push("時長");
    if (!(price >= 0) || Number.isNaN(price)) missing.push("價格");
    if (!schedules.length) missing.push("至少一個場次");
    if (missing.length) {
      return res.status(400).json({ success: false, error: "缺少：" + missing.join("、") });
    }

    for (const s of schedules) {
      const st = new Date(s.start_time);
      if (isNaN(st.getTime())) return res.status(400).json({ success: false, error: "場次時間格式有誤" });
      if (s.end_time && new Date(s.end_time) <= st) {
        return res.status(400).json({ success: false, error: "場次結束時間必須遲過開始時間" });
      }
    }

    const db = getDb();
    const id = uuidv4();
    const maxRef =
      db
        .prepare(
          "SELECT MAX(CAST(SUBSTR(class_reference, 4) AS INTEGER)) as m FROM classes WHERE class_reference GLOB 'CL-[0-9]*'",
        )
        .get().m || 0;
    const clRef = "CL-" + String(maxRef + 1).padStart(4, "0");
    const maxP = Number(d.max_participants) || 15;
    const creditsCost = Number(d.credits_cost) || Math.round(price / 10);

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO classes (id, class_reference, coach_id, title, title_en, description, category, sport_slug,
           difficulty, duration, max_participants, price_hkd, credits_cost, venue_name, venue_address,
           image_url, status, booking_open, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', 1, datetime('now'), datetime('now'))`,
      ).run(
        id,
        clRef,
        req.user.id,
        title,
        d.title_en || null,
        d.description || null,
        category,
        d.sport_slug || null,
        d.difficulty || "beginner",
        duration,
        maxP,
        price,
        creditsCost,
        d.venue_name || null,
        d.venue_address || null,
        d.image_url || null,
      );

      const insSched = db.prepare(
        `INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants, enrolled_count, status, created_at)
         VALUES (?,?,?,?,?,?,0,'available',datetime('now'))`,
      );
      for (const s of schedules) {
        insSched.run(
          uuidv4(),
          id,
          new Date(s.start_time).toISOString(),
          s.end_time ? new Date(s.end_time).toISOString() : null,
          s.recurring || "none",
          maxP,
        );
      }
    });
    tx();

    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "class",
        entityId: id,
        data: { source: "ai-open-class", title, schedules: schedules.length, created_by: req.user.id },
      });
    } catch (e) {}

    res.status(201).json({
      success: true,
      message: `✅ 已開班：${title}（${schedules.length} 個場次）`,
      data: { class_id: id, class_reference: clRef, schedules: schedules.length },
    });
  } catch (err) {
    console.error("ai-class/create error:", err.message);
    res.status(500).json({ success: false, error: "建立課堂失敗：" + err.message });
  }
});

module.exports = router;
