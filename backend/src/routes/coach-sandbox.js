/** 工單八 — 教練自助重設演練沙盒（只限自己嘅沙盒班次） */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { resetSandboxSession } = require("../services/sandbox");

const router = express.Router();

router.post("/sandbox/reset", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const sessionId = String((req.body && req.body.session_id) || "seed-sandbox-session");
    const row = db
      .prepare("SELECT s.id, c.coach_id, pv.is_sandbox FROM class_schedules s JOIN classes c ON c.id=s.class_id LEFT JOIN partner_venues pv ON pv.id=c.partner_venue_id WHERE s.id=?")
      .get(sessionId);
    if (!row) return res.status(404).json({ success: false, error: "找不到班次" });
    const isAdmin = ["super_admin", "platform_manager", "admin"].includes(req.user.role);
    if (!isAdmin && row.coach_id !== req.user.id) return res.status(403).json({ success: false, error: "只可重設自己嘅演練班次" });

    const out = resetSandboxSession(db, sessionId);
    if (!out.ok) return res.status(out.code || 400).json({ success: false, error: out.error });

    audit({
      actionType: "sandbox.reset",
      entityType: "class_schedule",
      entityId: sessionId,
      userId: req.user.id,
      newValues: out,
      description: "重設演練沙盒數據",
    });
    res.json({ success: true, ...out });
  } catch (e) {
    console.error("[SANDBOX] reset:", e.message);
    res.status(500).json({ success: false, error: "重設失敗" });
  }
});

module.exports = router;
