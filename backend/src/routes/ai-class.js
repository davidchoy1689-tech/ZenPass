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
const {
  parseClassText,
  ocrChannels,
  mergeDrafts,
  loadCorrections,
  applyCorrections,
} = require("../services/ai-class-parser");

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
    let channels = [];
    let preprocess = null;

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
        const out = await ocrChannels(buf, ext);
        channels = out.channels;
        preprocess = out.preprocess;
        ocrUsed = true;
      } catch (e) {
        console.error("ai-class OCR error:", e.message);
        return res.status(503).json({
          success: false,
          error: "圖片辨識暫時不可用，請改為貼上文字",
          code: "OCR_UNAVAILABLE",
        });
      }
    }

    const ocrText = channels.map((c) => c.text).join("\n");
    extracted = [extracted, ocrText].filter(Boolean).join("\n").trim();
    if (!extracted.trim()) {
      return res.status(422).json({ success: false, error: "辨識唔到文字，請影清楚啲或者直接貼上文字" });
    }

    // 每個通道各自解析 → 一致性投票
    const drafts = [];
    if (text) drafts.push(parseClassText(String(text)));
    for (const ch of channels) drafts.push(parseClassText(ch.text));
    const merged = drafts.length ? mergeDrafts(drafts) : { draft: parseClassText(extracted), field_confidence: {} };
    const draft = merged.draft;

    // 自學字典：相似嘅舊錯誤自動改正
    const db = getDb();
    const applied = [];
    for (const f of ["title", "venue_name", "category"]) {
      const rules = loadCorrections(db, f);
      const r = applyCorrections(draft[f], rules);
      if (r.learned) {
        draft[f] = r.value;
        applied.push(Object.assign({ field: f }, r.learned));
      }
    }

    res.json({
      success: true,
      data: {
        draft,
        field_confidence: merged.field_confidence,
        corrections_applied: applied,
        extracted_text: extracted.slice(0, 4000),
        ocr_used: ocrUsed,
        channels: channels.map((c) => ({ source: c.source, psm: c.psm, chars: c.text.length })),
        preprocess,
      },
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
           image_url, equipment, district, status, booking_open, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', 1, datetime('now'), datetime('now'))`,
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
        (d.venue_address && String(d.venue_address).trim() !== String(d.venue_name || "").trim()) ? d.venue_address : null,
        d.image_url || null,
        d.equipment || null,
        d.district || null,
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

    // 📚 自學字典：記錄人手修正，下次 OCR 自動套用（只限白名單欄位）
    try {
      const LEARNABLE = ["title", "venue_name", "category", "sport_slug"];
      const learned = Array.isArray(d.learned_corrections) ? d.learned_corrections : [];
      const up = db.prepare(
        `INSERT INTO ocr_corrections (field, from_text, to_text, hits)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(field, from_text) DO UPDATE SET
           to_text = excluded.to_text, hits = hits + 1, updated_at = datetime('now')`,
      );
      for (const c of learned) {
        const field = String((c && c.field) || "").trim();
        const from = String((c && (c.from_text || c.from)) || "").trim();
        const to = String((c && (c.to_text || c.to)) || "").trim();
        if (!LEARNABLE.includes(field) || !from || !to || from === to) continue;
        up.run(field, from.slice(0, 200), to.slice(0, 200));
      }
    } catch (e) {
      console.error("ocr_corrections learn failed:", e.message);
    }

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
