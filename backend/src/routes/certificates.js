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
    res.json({ success: true, certificates: list, summary });
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

router.get("/verify/:code", (req, res) => {
  try {
    const c = svc.getByCode(req.params.code);
    if (!c) {
      return res.status(404).json({ success: false, valid: false, error: "查無此證書編號" });
    }
    if (Number(c.revoked) === 1) {
      return res.json({ success: true, valid: false, revoked: true, reason: c.revoked_reason || "證書已作廢" });
    }
    res.json({
      success: true,
      valid: true,
      certificate: {
        code: c.code,
        is_demo: Number(c.is_demo) === 1,
        student_name: c.student_name,
        class_title: c.class_title,
        level: c.level,
        level_label: c.level_label,
        hours: c.hours,
        coach_name: c.coach_name,
        coach_starred: Number(c.coach_starred) || 0,
        issued_at: c.issued_at,
        sport: c.sport,
      },
      issuer: "Hong Kong Leisure and Fitness Company Limited",
    });
  } catch (err) {
    console.error("驗證證書失敗:", err);
    res.status(500).json({ success: false, valid: false, error: "驗證失敗" });
  }
});

// ===== 補發（教練／管理員）=====
router.post("/:bookingId/issue", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const b = db
      .prepare(
        `SELECT b.id, b.user_id, b.status, c.coach_id FROM bookings b
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
    const cert = svc.issueForBooking(b.id);
    if (!cert) return res.status(400).json({ success: false, error: "發證失敗" });
    res.json({ success: true, certificate: cert });
  } catch (err) {
    console.error("補發證書失敗:", err);
    res.status(500).json({ success: false, error: "補發失敗" });
  }
});

module.exports = router;
