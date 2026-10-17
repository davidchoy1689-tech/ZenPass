/**
 * ZenPass 禪流 — 優惠碼路由
 *   GET  /api/promo/validate?code=&class_id=[&price=]   驗證並回折後價
 *   GET  /api/promo                                      （admin）列出全部
 *   POST /api/promo                                      （admin）新增
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getDb } = require("../services/database");
const { validatePromo, normalize } = require("../services/promo");
const { authenticateToken, requireAdmin, optionalAuth } = require("../middleware/auth");

// GET /api/promo/welcome-status — 目前用戶嘅迎新優惠是否仍可用（每個帳戶一次）
router.get("/welcome-status", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const used = db
      .prepare(
        `SELECT COUNT(*) AS c FROM promo_redemptions r
           JOIN promo_codes p ON r.code_id = p.id
          WHERE r.user_id = ? AND (UPPER(p.code) LIKE 'WELCOME%' OR p.description LIKE '%迎新%')`,
      )
      .get(req.user.id).c;
    res.json({ success: true, available: used === 0, used });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/validate", optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const { code, class_id, price } = req.query;
    let basePrice = price != null ? Number(price) : null;
    if (basePrice == null && class_id) {
      const c = db.prepare("SELECT price_hkd FROM classes WHERE id = ?").get(class_id);
      basePrice = c ? c.price_hkd : 0;
    }
    const r = validatePromo(db, {
      code,
      basePrice: basePrice || 0,
      classId: class_id,
      userId: req.user ? req.user.id : null,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.json({ success: true, code: normalize(code), final_price: r.final_price, discount: r.discount });
  } catch (e) {
    res.status(500).json({ success: false, error: "驗證失敗" });
  }
});

router.get("/", authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  res.json({ success: true, codes: db.prepare("SELECT * FROM promo_codes ORDER BY created_at DESC").all() });
});

router.post("/", authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const b = req.body || {};
  if (!b.code || !b.type) return res.status(400).json({ success: false, error: "缺少 code / type" });
  if (!["fixed_price", "fixed_discount", "percent"].includes(b.type))
    return res.status(400).json({ success: false, error: "無效折扣類型" });
  const id = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO promo_codes (id, code, type, value, class_id, max_uses, used_count, per_user_limit, valid_from, valid_to, active, description, created_at)
       VALUES (?,?,?,?,?,?,0,?,?,?,?,?,datetime('now'))`,
    ).run(
      id,
      normalize(b.code),
      b.type,
      Number(b.value),
      b.class_id || null,
      b.max_uses != null ? Number(b.max_uses) : null,
      b.per_user_limit != null ? Number(b.per_user_limit) : 1,
      b.valid_from || null,
      b.valid_to || null,
      b.active === false ? 0 : 1,
      b.description || null,
    );
    res.status(201).json({ success: true, id, code: normalize(b.code) });
  } catch (e) {
    res.status(400).json({ success: false, error: String(e.message).includes("UNIQUE") ? "優惠碼已存在" : e.message });
  }
});

module.exports = router;
