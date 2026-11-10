/**
 * admin-risk.js — 風控審核台（工單二十二 / 風控 Console）
 *  GET  /api/admin/risk-summary                    首屏統計
 *  GET  /api/admin/risk-tickets                    隊列
 *  GET  /api/admin/risk-tickets/:id                證據鏈詳情
 *  POST /api/admin/risk-tickets/:id/resolve        { action:'unlock'|'reject', notes, challenge? }
 *       unlock：金額 > 門檻 → 第一次回 challenge（初審），第二位管理員帶 challenge 完成覆核
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const risk = require("../services/risk-control");

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get("/risk-summary", (req, res) => {
  try {
    res.json({ success: true, data: risk.summary(getDb()) });
  } catch (e) {
    console.error("[RISK] summary:", e.message);
    res.status(500).json({ success: false, error: "讀取風控統計失敗" });
  }
});

router.get("/risk-tickets", (req, res) => {
  try {
    const rows = risk.listTickets(getDb(), { status: req.query.status || null });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[RISK] list:", e.message);
    res.status(500).json({ success: false, error: "讀取風控工單失敗" });
  }
});

router.get("/risk-tickets/:id", (req, res) => {
  try {
    const d = risk.detail(getDb(), req.params.id);
    if (!d) return res.status(404).json({ success: false, error: "找不到工單" });
    res.json({ success: true, data: d });
  } catch (e) {
    console.error("[RISK] detail:", e.message);
    res.status(500).json({ success: false, error: "讀取工單詳情失敗" });
  }
});

const ERR_STATUS = {
  NOT_FOUND: 404,
  BAD_ACTION: 400,
  NOTES_REQUIRED: 400,
  ALREADY_CLOSED: 409,
  SAME_ADMIN: 403,
  CHALLENGE_REQUIRED: 400,
  CHALLENGE_INVALID: 400,
  CHALLENGE_EXPIRED: 410,
};

router.post("/risk-tickets/:id/resolve", (req, res) => {
  try {
    const b = req.body || {};
    const out = risk.resolve(getDb(), {
      ticketId: req.params.id,
      action: String(b.action || ""),
      notes: b.notes || b.resolution_notes || "",
      adminId: req.user.id,
      challenge: b.challenge || b.secondary_challenge || "",
    });
    if (!out.ok) {
      const msgs = {
        NOT_FOUND: "找不到工單",
        NOTES_REQUIRED: "請填寫核實備註（最少 4 字）",
        ALREADY_CLOSED: "此工單已處理",
        SAME_ADMIN: "初審與覆核必須由不同管理員執行",
        CHALLENGE_REQUIRED: "請輸入初審產生的一次性覆核碼",
        CHALLENGE_INVALID: "覆核碼不正確",
        CHALLENGE_EXPIRED: "覆核碼已過期（10 分鐘），請重新初審",
        BAD_ACTION: "操作無效",
      };
      return res.status(ERR_STATUS[out.code] || 400).json({
        success: false,
        code: out.code,
        error: out.error || msgs[out.code] || "操作無效",
      });
    }
    res.json({ success: true, ...out });
  } catch (e) {
    console.error("[RISK] resolve:", e.message);
    res.status(500).json({ success: false, error: "處理失敗" });
  }
});

module.exports = router;
