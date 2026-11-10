/**
 * admin-risk.js — 風控工單台（工單二十二）
 *  GET  /api/admin/risk-tickets
 *  POST /api/admin/risk-tickets/:id/resolve  { action: 'unlock'|'reject', notes }
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const risk = require("../services/risk-control");

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get("/risk-tickets", (req, res) => {
  try {
    const rows = risk.listTickets(getDb(), { status: req.query.status || null });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[RISK] list:", e.message);
    res.status(500).json({ success: false, error: "讀取風控工單失敗" });
  }
});

router.post("/risk-tickets/:id/resolve", (req, res) => {
  try {
    const b = req.body || {};
    const out = risk.resolve(getDb(), {
      ticketId: req.params.id,
      action: String(b.action || ""),
      notes: b.notes || b.resolution_notes || "",
      adminId: req.user.id,
    });
    if (!out.ok) {
      const msg = out.code === "NOT_FOUND" ? "找不到工單" : out.code === "NOTES_REQUIRED" ? "請填寫核實備註（最少 4 字）" : "操作無效";
      return res.status(400).json({ success: false, code: out.code, error: msg });
    }
    res.json({ success: true, status: out.status });
  } catch (e) {
    console.error("[RISK] resolve:", e.message);
    res.status(500).json({ success: false, error: "處理失敗" });
  }
});

module.exports = router;
