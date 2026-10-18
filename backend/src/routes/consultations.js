/**
 * ZenPass — 一對一健康諮詢／身體評估 API
 *
 * 會員：
 *   GET  /api/consultations/my       — 我的配額 + 申請紀錄
 *   POST /api/consultations/request  — 提交申請
 * 管理員：
 *   GET   /api/consultations/admin/list?status=pending
 *   PATCH /api/consultations/admin/:id  — 安排時間／完成／取消
 */

const express = require("express");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const {
  listMine,
  requestConsultation,
  listForAdmin,
  updateByAdmin,
} = require("../services/consultations");

const router = express.Router();

router.get("/my", authenticateToken, (req, res) => {
  try {
    res.json({ success: true, data: listMine(req.user.id) });
  } catch (err) {
    console.error("consultations/my error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取諮詢資料" });
  }
});

router.post("/request", authenticateToken, (req, res) => {
  try {
    const out = requestConsultation(req.user.id, req.body || {});
    res.status(201).json({
      success: true,
      message: "✅ 已提交申請，我哋會盡快聯絡你安排時間",
      data: out,
    });
  } catch (err) {
    const code = err.status || 500;
    if (code >= 500) console.error("consultations/request error:", err.message);
    res.status(code).json({ success: false, error: err.message || "提交失敗" });
  }
});

router.get("/admin/list", authenticateToken, requireAdmin, (req, res) => {
  try {
    const status = req.query.status || "pending";
    res.json({ success: true, data: listForAdmin(status) });
  } catch (err) {
    console.error("consultations/admin/list error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

router.patch("/admin/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const row = updateByAdmin(req.params.id, {
      ...req.body,
      adminId: req.user.id,
    });
    res.json({ success: true, message: "已更新", data: row });
  } catch (err) {
    const code = err.status || 500;
    if (code >= 500) console.error("consultations/admin update error:", err.message);
    res.status(code).json({ success: false, error: err.message || "更新失敗" });
  }
});

module.exports = router;
