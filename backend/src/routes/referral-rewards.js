/**
 * 工單十三 — 推薦裂變（出席後派堂）
 *  POST /api/student/referral/claim-code  { code, device_id? }
 *  GET  /api/student/referral/summary
 */
const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const referral = require("../services/referral-rewards");

const router = express.Router();

router.post("/student/referral/claim-code", authenticateToken, (req, res) => {
  try {
    const b = req.body || {};
    const out = referral.claimCode(req.user.id, b.code || b.ref, {
      deviceId: b.device_id || b.deviceId,
      ip: req.ip || "",
    });
    res.status(out.status).json(out.body);
  } catch (e) {
    console.error("[REFERRAL] claim:", e.message);
    res.status(500).json({ success: false, error: "綁定推薦碼失敗" });
  }
});

router.get("/student/referral/summary", authenticateToken, (req, res) => {
  try {
    res.json({ success: true, ...referral.summaryForUser(req.user.id) });
  } catch (e) {
    console.error("[REFERRAL] summary:", e.message);
    res.status(500).json({ success: false, error: "讀取推薦資料失敗" });
  }
});

module.exports = router;
