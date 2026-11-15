/**
 * admin-payouts.js — 平台登記 FPS 出糧（工單二十）
 *  POST  /api/admin/coach-payouts/disburse
 *  PATCH /api/admin/coach-payouts/:id
 *  GET   /api/admin/coach-payouts
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { audit } = require("../services/audit");
const disb = require("../services/payout-disbursements");

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get("/coach-payouts", (req, res) => {
  try {
    const db = getDb();
    disb.ensureSchema(db);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? req.query.month : null;
    const rows = month
      ? db.prepare("SELECT * FROM coach_payout_disbursements WHERE payout_month=? ORDER BY datetime(created_at) DESC").all(month)
      : db.prepare("SELECT * FROM coach_payout_disbursements ORDER BY payout_month DESC, datetime(created_at) DESC LIMIT 200").all();
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[ADMIN-PAYOUT] list:", e.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/coach-payouts/disburse", (req, res) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const coachId = String(b.coach_id || b.coachId || "");
    const month = String(b.month || b.payout_month || "");
    if (!coachId) return res.status(400).json({ success: false, error: "缺少 coach_id" });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, error: "月份格式 YYYY-MM" });

    const coach = db.prepare("SELECT id, name, phone FROM users WHERE id=?").get(coachId);
    if (!coach) return res.status(404).json({ success: false, error: "找不到教練" });
    const payoutState = require("../services/risk-control").payoutState(db, coachId);
    if (payoutState !== "active") {
      return res.status(409).json({
        success: false,
        code: "COACH_FROZEN",
        error: "此教練出糧已被風控凍結，請先於風控台解凍",
      });
    }

    // 🪪 實名出糧：必須有已驗證收款戶口
    try {
      require("../services/payout-settings").ensureSchema(db);
      const ps = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id=?").get(coachId);
      if (!ps) {
        return res.status(400).json({
          success: false,
          code: "BANK_REQUIRED",
          error: "此教練未登記收款戶口（需實名登記，姓名須與教練一致），無法出糧",
        });
      }
      if (Number(ps.is_verified || 0) !== 1) {
        return res.status(400).json({
          success: false,
          code: "BANK_UNVERIFIED",
          error: "收款戶口未核實，請先喺「收款戶口核實」一撳通過",
        });
      }
      const me = db.prepare("SELECT name, name_en FROM users WHERE id=?").get(coachId);
      const norm = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9\u4e00-\u9fff]/g, "");
      const hasCJK = (v) => /[\u4e00-\u9fff]/.test(String(v || ""));
      const holder = ps.account_holder_name;
      const comparable = me && me.name && holder && hasCJK(me.name) === hasCJK(holder);
      const enMismatch = me && me.name_en && norm(me.name_en) !== norm(holder);
      if (enMismatch || (comparable && norm(me.name) !== norm(holder))) {
        return res.status(400).json({
          success: false,
          code: "NAME_MISMATCH",
          error: "收款人姓名與教練姓名唔一致，請先更新收款設定",
        });
      }
    } catch (e) {}

    const { buildMonthlyBreakdown } = require("./coach-earnings");
    const data = buildMonthlyBreakdown(db, coachId, month);
    const gross = Number(data.total_payout_cents) || 0;
    // 現金 walk-in 已改為零出糧，唔再沖抵（用 offset_cents；舊資料 fallback）
    const offset = Number(data.offset_cents != null ? data.offset_cents : data.cash_collected_cents) || 0;
    const net = Number(data.net_payout_cents) || 0;
    if (gross <= 0 && net <= 0) {
      return res.status(400).json({ success: false, error: "該月份冇可發放收益" });
    }

    let out;
    try {
      // 風控解凍時會預先建立 pending 記錄（已納入發放隊列）；正式登記時直接完成該筆
      const pending = disb.getForMonth(db, coachId, month);
      if (pending && pending.status === "pending") {
        db.prepare(
          `UPDATE coach_payout_disbursements
              SET gross_earnings_cents=?, offset_cash_cents=?, net_payout_cents=?, fps_proxy_id=?,
                  disbursed_at=COALESCE(?, datetime('now')), status=?, failure_reason=NULL
            WHERE id=?`,
        ).run(
          Math.round(gross),
          Math.round(offset),
          Math.round(net),
          b.fps_proxy_id || coach.phone || null,
          b.disbursed_at || null,
          b.status || "cleared",
          pending.id,
        );
        out = { id: pending.id, bank_reference_no: pending.bank_reference_no };
      } else {
        out = disb.record(db, {
          coachId,
          month,
          grossCents: gross,
          offsetCents: offset,
          netCents: net,
          proxyId: b.fps_proxy_id || coach.phone || null,
          refNo: b.bank_reference_no || null,
          disbursedAt: b.disbursed_at || null,
          status: b.status || "cleared",
        });
      }
    } catch (e) {
      if (/UNIQUE constraint failed/.test(e.message)) {
        return res.status(409).json({ success: false, code: "DUPLICATE", error: "該教練本月或此參考編號已有出糧紀錄" });
      }
      throw e;
    }

    audit({
      actionType: "payout.disbursed",
      entityType: "coach_payout_disbursement",
      entityId: out.id,
      userId: req.user.id,
      newValues: {
        coach_id: coachId,
        month,
        gross_cents: gross,
        offset_cash_cents: offset,
        net_payout_cents: net,
        bank_reference_no: out.bank_reference_no,
      },
      description: `登記 FPS 出糧（${month}）`,
    });

    res.status(201).json({
      success: true,
      id: out.id,
      month,
      gross_earnings_cents: gross,
      offset_cash_cents: offset,
      net_payout_cents: net,
      bank_reference_no: out.bank_reference_no,
    });
  } catch (e) {
    console.error("[ADMIN-PAYOUT] disburse:", e.message);
    res.status(500).json({ success: false, error: "登記出糧失敗" });
  }
});

router.patch("/coach-payouts/:id", (req, res) => {
  try {
    const db = getDb();
    const status = String((req.body || {}).status || "");
    if (!["pending", "processing", "cleared", "failed"].includes(status)) {
      return res.status(400).json({ success: false, error: "狀態無效" });
    }
    const out = disb.setStatus(db, req.params.id, status, (req.body || {}).reason);
    if (!out.ok) return res.status(404).json({ success: false, error: "找不到紀錄" });
    if (status === "failed") {
      try {
        const row = db.prepare("SELECT coach_id, payout_month, net_payout_cents FROM coach_payout_disbursements WHERE id=?").get(req.params.id);
        require("../services/notification").dbNotification(
          row.coach_id,
          "payout",
          "⚠️ FPS 出糧轉帳失敗",
          `${row.payout_month} 收益轉帳失敗（HK$${(Number(row.net_payout_cents) / 100).toFixed(2)}）。款項已保留於平台錢包，請核對銀行戶名／FPS 號碼後更正，財務會於下一個工作日重發。`,
          { payout_id: req.params.id },
        );
      } catch (e) {}
    }
    res.json({ success: true, status });
  } catch (e) {
    console.error("[ADMIN-PAYOUT] patch:", e.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});


/* ===== 收款戶口核實（免 SMS；後台一撳通過）===== */
router.get("/payout-settings/pending", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    require("../services/payout-settings").ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT p.coach_id, p.fps_type, p.fps_proxy_value, p.bank_code, p.account_holder_name, p.verified_at,
                u.name, u.name_en, u.email, u.role
           FROM coach_payout_settings p JOIN users u ON u.id=p.coach_id
          WHERE COALESCE(p.is_verified,0)=0
          ORDER BY datetime(p.updated_at) DESC LIMIT 100`,
      )
      .all();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, pending: rows });
  } catch (e) {
    console.error("[ADMIN-PS] pending:", e.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post("/payout-settings/:coachId/verify", authenticateToken, requireAdmin, express.json(), (req, res) => {
  try {
    const db = getDb();
    require("../services/payout-settings").ensureSchema(db);
    const row = db.prepare("SELECT * FROM coach_payout_settings WHERE coach_id=?").get(req.params.coachId);
    if (!row) return res.status(404).json({ success: false, error: "收款設定不存在" });
    db.prepare(
      "UPDATE coach_payout_settings SET is_verified=1, verified_by=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE coach_id=?",
    ).run(req.user.id, req.params.coachId);
    try {
      audit({
        actionType: "payout.bank_verified",
        entityType: "user",
        entityId: req.params.coachId,
        userId: req.user.id,
        newValues: { holder: row.account_holder_name, bank_code: row.bank_code },
        description: "平台核實收款戶口",
      });
    } catch (e) {}
    res.json({ success: true });
  } catch (e) {
    console.error("[ADMIN-PS] verify:", e.message);
    res.status(500).json({ success: false, error: "核實失敗" });
  }
});

module.exports = router;
