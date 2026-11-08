/**
 * ZenPass — 通行證（Multi-Pass）路由
 *  GET  /api/passes/my                      本人有效通行證
 *  POST /api/passes/admin/issue             簽發（需 finance.payout.process）
 *  GET  /api/passes/admin/list?phone=       查詢（需 finance.payout.view）
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const passes = require("../services/passes");
const { audit } = require("../services/audit");

const router = express.Router();

router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const user = db.prepare("SELECT id, phone FROM users WHERE id = ?").get(req.user.id);
    const list = passes.listActiveForUser(db, user || req.user);
    res.json({ success: true, passes: list });
  } catch (e) {
    console.error("[PASS] my error:", e.message);
    res.status(500).json({ success: false, error: "讀取通行證失敗" });
  }
});

router.post("/admin/issue", authenticateToken, requirePermission("finance.payout.process"), (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const b = req.body || {};
    const r = passes.issuePass(db, {
      userId: b.user_id || null,
      phone: b.phone || b.user_phone,
      studentName: b.student_name || b.studentName,
      totalCredits: b.total_credits,
      pricePaid: b.price_paid,
      validDays: b.valid_days,
      notes: b.notes,
      createdBy: req.user.id,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    try {
      audit({
        actionType: "pass.issued",
        entityType: "user_pass",
        entityId: r.pass.id,
        userId: req.user.id,
        newValues: r.pass,
        description: `簽發 ${r.pass.total_credits} 堂通行證（${r.pass.student_name}）`,
      });
    } catch (e) {}
    res.status(201).json({ success: true, pass: r.pass });
  } catch (e) {
    console.error("[PASS] issue error:", e.message);
    res.status(500).json({ success: false, error: "簽發通行證失敗" });
  }
});

router.get("/admin/list", authenticateToken, requirePermission("finance.refund.view"), (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const phone = passes.normalizePhone(req.query.phone);
    const rows = phone
      ? db.prepare("SELECT * FROM user_passes WHERE user_phone = ? ORDER BY datetime(created_at) DESC LIMIT 50").all(phone)
      : db.prepare("SELECT * FROM user_passes ORDER BY datetime(created_at) DESC LIMIT 50").all();
    res.json({ success: true, passes: rows.map(passes.shape) });
  } catch (e) {
    console.error("[PASS] list error:", e.message);
    res.status(500).json({ success: false, error: "查詢通行證失敗" });
  }
});

module.exports = router;
