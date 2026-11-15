/**
 * 機構資金往來申請（2026-11-16）
 *  - 機構（org_admin）提交退款／結算申請，必須已登記實名收款戶口
 *  - 營運審批 → 人手 FPS 過數 → 登記參考編號 → 狀態 paid
 *
 *  POST /api/org/fund-requests
 *  GET  /api/org/fund-requests
 *  GET  /api/admin/org-fund-requests?status=
 *  POST /api/admin/org-fund-requests/:id/approve | reject | paid
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");

const router = express.Router();

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_fund_requests (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('refund','settlement')),
      amount_cents INTEGER NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','paid','rejected')),
      admin_note TEXT,
      paid_reference TEXT,
      reviewed_by TEXT,
      reviewed_at DATETIME,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ofr_company ON org_fund_requests(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ofr_status ON org_fund_requests(status, created_at);
  `);
}

function companyOf(db, userId) {
  try {
    return db
      .prepare(
        `SELECT c.id, c.name, c.name_en FROM corporate_members m JOIN corporate_companies c ON c.id=m.company_id
          WHERE m.user_id=? AND m.status='active'
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END LIMIT 1`,
      )
      .get(userId);
  } catch (e) {
    return null;
  }
}

router.post("/org/fund-requests", authenticateToken, express.json(), (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const b = req.body || {};
    const type = String(b.type || "");
    if (!["refund", "settlement"].includes(type)) return res.status(400).json({ success: false, error: "申請類型無效" });
    const amountCents = Math.round(Number(b.amount || 0) * 100);
    if (!amountCents || amountCents < 10000) return res.status(400).json({ success: false, error: "最低申請金額 HK$100" });
    if (amountCents > 100000000) return res.status(400).json({ success: false, error: "金額過大" });

    const company = companyOf(db, req.user.id);
    if (!company) return res.status(403).json({ success: false, error: "未綁定機構" });

    try {
      require("../services/payout-settings").ensureSchema(db);
      const ps = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id=?").get(req.user.id);
      if (!ps) {
        return res.status(400).json({
          success: false,
          code: "BANK_REQUIRED",
          error: "請先登記機構收款戶口（實名＝機構名稱）",
        });
      }
    } catch (e) {}

    const dup = db
      .prepare("SELECT id FROM org_fund_requests WHERE company_id=? AND status='pending' LIMIT 1")
      .get(company.id);
    if (dup) return res.status(409).json({ success: false, error: "已有待處理申請", code: "DUPLICATE" });

    const id = "ofr_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      "INSERT INTO org_fund_requests (id, company_id, user_id, type, amount_cents, note) VALUES (?,?,?,?,?,?)",
    ).run(id, company.id, req.user.id, type, amountCents, String(b.note || "").slice(0, 200));

    try {
      const { audit } = require("../services/audit");
      audit({
        actionType: "org.fund_requested",
        entityType: "corporate_company",
        entityId: company.id,
        userId: req.user.id,
        newValues: { type, amount_cents: amountCents },
        description: `機構${type === "refund" ? "退款" : "結算"}申請 HK$${(amountCents / 100).toFixed(2)}`,
      });
    } catch (e) {}

    res.status(201).json({ success: true, id });
  } catch (e) {
    console.error("[ORG-FUND] create:", e.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

router.get("/org/fund-requests", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const company = companyOf(db, req.user.id);
    if (!company) return res.status(403).json({ success: false, error: "未綁定機構" });
    const rows = db
      .prepare("SELECT * FROM org_fund_requests WHERE company_id=? ORDER BY datetime(created_at) DESC LIMIT 50")
      .all(company.id)
      .map((r) => ({ ...r, amount: r.amount_cents / 100 }));
    res.set("Cache-Control", "no-store");
    res.json({ success: true, company, requests: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

const canReview = requirePermission("finance.view");

router.get("/admin/org-fund-requests", authenticateToken, canReview, (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const status = ["pending", "approved", "paid", "rejected", "all"].includes(String(req.query.status))
      ? String(req.query.status)
      : "pending";
    const where = status === "all" ? "" : "WHERE r.status=?";
    const rows = db
      .prepare(
        `SELECT r.*, c.name AS company_name, u.name AS requester
           FROM org_fund_requests r
           JOIN corporate_companies c ON c.id=r.company_id
           LEFT JOIN users u ON u.id=r.user_id
           ${where} ORDER BY datetime(r.created_at) DESC LIMIT 100`,
      )
      .all(...(status === "all" ? [] : [status]))
      .map((r) => ({ ...r, amount: r.amount_cents / 100 }));
    res.set("Cache-Control", "no-store");
    res.json({ success: true, requests: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

function transition(action) {
  return (req, res) => {
    try {
      const db = getDb();
      ensureSchema(db);
      const r = db.prepare("SELECT * FROM org_fund_requests WHERE id=?").get(req.params.id);
      if (!r) return res.status(404).json({ success: false, error: "申請不存在" });
      const note = String((req.body || {}).note || "").slice(0, 200);

      if (action === "reject") {
        if (r.status !== "pending") return res.status(409).json({ success: false, error: "已處理" });
        if (note.length < 2) return res.status(400).json({ success: false, error: "請填寫原因" });
        db.prepare(
          "UPDATE org_fund_requests SET status='rejected', admin_note=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
        ).run(note, req.user.id, r.id);
        return res.json({ success: true, status: "rejected" });
      }
      if (action === "approve") {
        if (r.status !== "pending") return res.status(409).json({ success: false, error: "已處理" });
        db.prepare(
          "UPDATE org_fund_requests SET status='approved', admin_note=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
        ).run(note || null, req.user.id, r.id);
        return res.json({ success: true, status: "approved" });
      }
      // paid
      const ref = String((req.body || {}).reference || "").trim();
      if (ref.length < 4) return res.status(400).json({ success: false, error: "請輸入轉賬參考編號" });
      if (!["approved", "paid"].includes(r.status)) return res.status(409).json({ success: false, error: "未經批准" });
      db.prepare(
        "UPDATE org_fund_requests SET status='paid', paid_reference=?, paid_at=datetime('now'), admin_note=COALESCE(?, admin_note) WHERE id=?",
      ).run(ref, note || null, r.id);
      return res.json({ success: true, status: "paid" });
    } catch (e) {
      console.error("[ORG-FUND] transition:", e.message);
      res.status(500).json({ success: false, error: "操作失敗" });
    }
  };
}

router.post("/admin/org-fund-requests/:id/approve", authenticateToken, canReview, express.json(), transition("approve"));
router.post("/admin/org-fund-requests/:id/reject", authenticateToken, canReview, express.json(), transition("reject"));
router.post("/admin/org-fund-requests/:id/paid", authenticateToken, canReview, express.json(), transition("paid"));

module.exports = router;
module.exports.ensureSchema = ensureSchema;
