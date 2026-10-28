/**
 * ZenPass 禪流 — 完課證書路由
 * GET  /api/certificates/my              （登入）我的證書 + 累計時數
 * GET  /api/certificates/verify/:code    （公開）真偽驗證（學校／面試官掃 QR 用）
 * POST /api/certificates/:bookingId/issue （教練／管理員）補發
 * 2026-10-27
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const svc = require("../services/certificate-service");

const router = express.Router();

// ===== 我的證書 =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const list = svc.listForUser(req.user.id);
    const summary = svc.summaryForUser(req.user.id);
    const terms = svc.termProgressForUser(req.user.id);
    const students = svc.studentSummariesForUser(req.user.id);
    res.json({ success: true, certificates: list, summary, terms, students });
  } catch (err) {
    console.error("取證書失敗:", err);
    res.status(500).json({ success: false, error: "無法取得證書" });
  }
});

// ===== 公開驗證（無需登入）=====
// ===== 示範證書（管理員預覽，隔離真實訂單）=====
router.post("/demo", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id) || {};
    if (!["admin", "super_admin", "platform_manager"].includes(me.role)) {
      return res.status(403).json({ success: false, error: "只限管理員預覽" });
    }
    const cert = svc.createDemo(req.body || {});
    res.json({ success: true, demo: true, certificate: cert });
  } catch (err) {
    console.error("示範證書失敗:", err);
    res.status(500).json({ success: false, error: "示範證書生成失敗" });
  }
});

// 🔒 公開驗證端點限流：防暴力枚舉證書編號（30 次／分鐘／IP）
const rateLimit = require("express-rate-limit");
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 30,
  message: { success: false, valid: false, error: "查詢太頻繁，請 1 分鐘後再試" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || "unknown",
});

// 🎭 公開頁姓名脫敏：唔好將全港學童全名俾爬蟲抄走
function maskStudentName(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (/\s/.test(s)) {
    // 英文／拼音：每個字只保留首字母
    return s.split(" ").map((w) => (w ? w[0].toUpperCase() + "**" : "")).filter(Boolean).join(" ");
  }
  // 中文：只保留姓氏
  if (s.length <= 2) return s[0] + "*";
  return s[0] + "*".repeat(Math.min(3, s.length - 1));
}

router.get("/verify/:code", verifyLimiter, (req, res) => {
  try {
    const c = svc.getByCode(req.params.code);
    if (!c) {
      return res.status(404).json({ success: false, valid: false, error: "查無此證書編號" });
    }
    if (Number(c.revoked) === 1) {
      return res.json({ success: true, valid: false, revoked: true, reason: c.revoked_reason || "證書已作廢" });
    }
    // 🔐 存證雜湊比對：資料庫欄位若被改動，重算結果會對唔上
    let sealed = false;
    try {
      sealed = !!c.verify_hash && svc.certHash(c) === c.verify_hash;
    } catch (e) {}
    res.json({
      success: true,
      valid: true,
      sealed,
      certificate: {
        code: c.code,
        is_demo: Number(c.is_demo) === 1,
        // 公開驗證只顯示脫敏姓名（完整姓名只喺證書 PDF／學員本人 portfolio 出現）
        student_name: maskStudentName(c.student_name),
        student_name_masked: true,
        class_title: c.class_title,
        level: c.level,
        level_label: c.level_label,
        cert_type: c.cert_type || "session",
        hours: c.hours,
        coach_name: c.coach_name,
        coach_starred: Number(c.coach_starred) || 0,
        issued_at: c.issued_at,
        sport: c.sport,
        verify_hash: c.verify_hash || "",
        student_ref: c.student_ref_hash ? String(c.student_ref_hash).slice(0, 8).toUpperCase() : "",
        coach_license: c.coach_license_masked || "",
        technical_score: c.technical_score == null ? null : Number(c.technical_score),
        tactical_score: c.tactical_score == null ? null : Number(c.tactical_score),
        teamwork_score: c.teamwork_score == null ? null : Number(c.teamwork_score),
        sportsmanship_score: c.sportsmanship_score == null ? null : Number(c.sportsmanship_score),
        overall_grade: c.overall_grade || "",
        coach_comment: c.coach_comment || "",
        assessment_tags: (() => {
          try { return JSON.parse(c.assessment_tags || "[]"); } catch (e) { return []; }
        })(),
      },
      issuer: "Hong Kong Leisure and Fitness Company Limited",
    });
  } catch (err) {
    console.error("驗證證書失敗:", err);
    res.status(500).json({ success: false, valid: false, error: "驗證失敗" });
  }
});

// ===== 教練發證資格狀態（教練工作台用）=====
router.get("/issuer-status", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT COALESCE(c.sport_slug, c.category, '') AS sport, c.title
         FROM classes c WHERE c.coach_id = ? AND c.status = 'active'
         GROUP BY COALESCE(c.sport_slug, c.category, '')`,
      )
      .all(req.user.id);
    const sports = rows.map((r) => {
      const e = svc.issuerEligibility(req.user.id, r.sport, r.title);
      return { sport: r.sport || "未分類", can_issue: !!e.ok, reason: e.reason || "" };
    });
    const cred = db
      .prepare("SELECT status, license_expiry, insurance_expiry_date, qualified_sports FROM coach_credentials WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(req.user.id) || null;
    res.json({
      success: true,
      credentials: cred
        ? { ...cred, qualified_sports_list: svc.parseQualified(cred.qualified_sports) }
        : null,
      sports,
    });
  } catch (err) {
    console.error("發證資格查詢失敗:", err);
    res.status(500).json({ success: false, error: "查詢失敗" });
  }
});

// ===== 補發（教練／管理員）=====
router.post("/:bookingId/issue", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const b = db
      .prepare(
        `SELECT b.id, b.user_id, b.status, c.coach_id, c.title AS class_title,
                COALESCE(c.sport_slug, c.category, '') AS sport
         FROM bookings b
         JOIN classes c ON c.id = b.class_id WHERE b.id = ?`,
      )
      .get(req.params.bookingId);
    if (!b) return res.status(404).json({ success: false, error: "預約不存在" });

    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id) || {};
    const isAdmin = ["admin", "super_admin", "platform_manager", "platform_staff"].includes(me.role);
    if (!isAdmin && b.coach_id !== req.user.id) {
      return res.status(403).json({ success: false, error: "無權限補發此證書" });
    }
    if (b.status !== "attended") {
      return res.status(400).json({ success: false, error: "未完成簽到，未能發證" });
    }

    // 🪪 發證資格閘門：教練必須持有已核實資質、保單有效、並具該項目授權（管理員可覆核）
    if (!isAdmin) {
      const el = svc.issuerEligibility(b.coach_id, b.sport, b.class_title);
      if (!el.ok) {
        return res.status(403).json({
          success: false,
          error: el.reason,
          code: "ISSUER_NOT_QUALIFIED",
          qualified: el.qualified || null,
        });
      }
    }

    const cert = svc.issueForBooking(b.id);
    if (!cert) return res.status(400).json({ success: false, error: "發證失敗" });

    // 📊 期制進度（教練恭賀訊息用：尚差 N 堂解鎖 Level 2）
    let progress = null;
    try {
      const p = svc.termProgressForUser(b.user_id).find((x) => x.class_id === cert.class_id);
      if (p) {
        progress = {
          attended: p.attended,
          total_sessions: p.total_sessions,
          required: p.required,
          remaining: Math.max(0, p.required - p.attended),
          completed: p.completed,
          level2: "Level 2 · 核心進階者",
        };
      }
    } catch (e) {}

    res.json({ success: true, certificate: cert, progress });
  } catch (err) {
    console.error("補發證書失敗:", err);
    res.status(500).json({ success: false, error: "補發失敗" });
  }
});

// ===== 🎖️ Level 3 專項技能評定 =====
// GET  /api/certificates/assessment/candidates — 教練名下可評核學員
router.get("/assessment/candidates", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id) || {};
    const isCoach = ["coach", "admin", "super_admin", "platform_manager"].includes(me.role);
    if (!isCoach) return res.status(403).json({ success: false, error: "只限教練使用" });
    const coachId = req.query.coach_id && me.role !== "coach" ? String(req.query.coach_id) : req.user.id;
    const list = svc.assessmentCandidatesForCoach(coachId);
    res.json({
      success: true,
      candidates: list,
      dims: svc.ASSESS_DIMS,
      tags: svc.ASSESS_TAGS,
      min_hours: svc.assessmentMinHours(db),
    });
  } catch (err) {
    console.error("評核名單失敗:", err);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

// POST /api/certificates/assessment — 提交評核並簽發 Level 3 證書
router.post("/assessment", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id) || {};
    const isAdmin = ["admin", "super_admin", "platform_manager"].includes(me.role);
    if (!isAdmin && me.role !== "coach") {
      return res.status(403).json({ success: false, error: "只限教練提交評核" });
    }
    const body = req.body || {};
    const out = svc.issueSkillAssessment({
      coachId: isAdmin && body.coach_id ? String(body.coach_id) : req.user.id,
      userId: body.user_id,
      studentName: body.student_name,
      sport: body.sport,
      scores: {
        technical_score: body.technical_score,
        tactical_score: body.tactical_score,
        teamwork_score: body.teamwork_score,
        sportsmanship_score: body.sportsmanship_score,
      },
      comment: body.comment,
      tags: body.tags,
      isAdmin,
    });
    if (!out.ok) {
      return res.status(out.status || 400).json({ success: false, error: out.error, code: out.code });
    }
    res.json({ success: true, certificate: out.certificate, duplicate: !!out.duplicate });
  } catch (err) {
    console.error("專項評定失敗:", err);
    res.status(500).json({ success: false, error: "評定失敗" });
  }
});

module.exports = router;
module.exports.maskStudentName = maskStudentName; // 供測試／其他模組重用
