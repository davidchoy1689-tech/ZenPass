/**
 * ZenPass 禪流 — 錢包路由
 *
 * 完整錢包系統：
 * - GET  /api/wallet/summary        — 錢包總覽（結餘 + 銀行 + 最近交易）
 * - GET  /api/wallet/transactions   — 交易記錄（可 filter by type/日期）
 * - POST /api/wallet/withdraw       — 提現申請
 * - POST /api/wallet/bank           — 設定銀行戶口
 * - POST /api/wallet/pay-rental     — 銀包扣數租場
 *
 * Admin only:
 * - GET  /api/wallet/admin/coaches  — 所有教練錢包總覽
 * - GET  /api/wallet/admin/txs/:userId — 指定教練交易記錄
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const walletService = require("../services/wallet-service");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();
const WITHDRAWAL_FEE = 1;

// ===== 1. GET /api/wallet/summary — 錢包總覽 =====
router.get("/summary", authenticateToken, (req, res) => {
  try {
    const summary = walletService.getWalletSummary(req.user.id);
    if (!summary) return res.status(404).json({ success: false, error: "用戶不存在" });
    res.json(summary);
  } catch (err) {
    console.error("[WALLET] /summary error:", err);
    res.status(500).json({ success: false, error: "無法獲取錢包資料" });
  }
});

// ===== 2. GET /api/wallet/transactions — 交易記錄 =====
router.get("/transactions", authenticateToken, (req, res) => {
  try {
    const { type, limit = 50, offset = 0, start_date, end_date } = req.query;
    const result = walletService.getTransactions({
      userId: req.user.id,
      type: type || null,
      limit: parseInt(limit),
      offset: parseInt(offset),
      startDate: start_date || null,
      endDate: end_date || null,
    });
    res.json(result);
  } catch (err) {
    console.error("[WALLET] /transactions error:", err);
    res.status(500).json({ success: false, error: "無法獲取交易記錄" });
  }
});

// ===== 2.5 GET /api/wallet/credits — Credits 餘額 + 完整流水 =====
router.get("/credits", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT credits FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const { listCreditTransactions } = require("../services/credit-ledger");
    const transactions = listCreditTransactions(db, req.user.id, {
      limit,
      offset,
      type: req.query.type || null,
    });
    res.json({ success: true, balance: user.credits || 0, transactions, limit, offset });
  } catch (err) {
    console.error("[WALLET] credits error:", err.message);
    res.status(500).json({ success: false, error: "無法讀取 Credits 紀錄" });
  }
});

// ===== 3. GET /api/wallet/balance — 簡單結餘查詢 (backward compat) =====
router.get("/balance", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db
      .prepare(
        "SELECT wallet_balance, credits, bank_name, bank_account, bank_code FROM users WHERE id = ?",
      )
      .get(req.user.id);

    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });

    res.json({
      balance: user.wallet_balance || 0,
      credits: user.credits || 0,
      bank: user.bank_name
        ? {
            name: user.bank_name,
            account: user.bank_account,
            code: user.bank_code,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 4. POST /api/wallet/withdraw — 提現 =====
router.post("/withdraw", authenticateToken, (req, res) => {
  // 🚫 安全（2026-10-19）：wallet_balance 同 coach_earnings.pending_payout 係同一筆錢嘅兩個鏡像，
  // 呢條 route 唔會將 coach_earnings 標記 paid → 可以同教練後台出糧重複提款。
  return res.status(403).json({
    success: false,
    code: "USE_COACH_PAYOUT",
    error: "請到「教練後台 → 出糧」申請提款（同一筆收入只可以提一次）。",
  });

  /* eslint-disable no-unreachable */
  try {
    const db = getDb();
    const user = db
      .prepare(
        "SELECT wallet_balance, bank_name, bank_account FROM users WHERE id = ?",
      )
      .get(req.user.id);

    if (!user || !user.bank_account) {

      return res.status(400).json({ success: false, error: "請先設定銀行戶口" });
    }

    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) {

      return res.status(400).json({ success: false, error: "請輸入有效金額" });
    }

    if (amount < 100) {

      return res.status(400).json({ success: false, error: "最低提現金額為 HK$100" });
    }

    const result = walletService.debitWallet({
      userId: req.user.id,
      amount,
      type: "withdrawal",
      description: `提現至 ${user.bank_name}`,
      reference: `提現 HK$${amount}`,
      fee: WITHDRAWAL_FEE,
      sourceType: "wallet_withdraw",
      sourceId: "",
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Also insert payout request record
    const poRef =
      "PO-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase();
    db
      .prepare(
        `
      INSERT INTO coach_payouts (id, payout_reference, coach_id, amount, fee, net_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `,
      )
      .run(
        uuidv4(),
        poRef,
        req.user.id,
        amount,
        WITHDRAWAL_FEE,
        amount - WITHDRAWAL_FEE,
      );

    // ⛓️ 區塊鏈：記錄提現交易
    try {
      writeBlock({
        entityType: "wallet_transaction",
        entityId: result.transaction_id,
        data: {
          user_id: req.user.id,
          amount,
          type: "withdrawal",
          balance_after: result.balance_after,
          fee: WITHDRAWAL_FEE,
          status: "completed",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (wallet withdraw):", bcErr.message);
    }

    res.json({
      success: true,
      amount,
      fee: WITHDRAWAL_FEE,
      balance_before: result.balance_before,
      balance_after: result.balance_after,
      transaction_id: result.transaction_id,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 5. POST /api/wallet/bank — 設定銀行戶口 =====
router.post("/bank", authenticateToken, (req, res) => {
  try {
    const { bank_name, bank_account, bank_code } = req.body;
    if (!bank_name || !bank_account) {
      return res.status(400).json({ success: false, error: "請填寫銀行名稱同戶口號碼" });
    }

    const db = getDb();
    db.prepare(
      "UPDATE users SET bank_name = ?, bank_account = ?, bank_code = ? WHERE id = ?",
    ).run(bank_name, bank_account, bank_code || "", req.user.id);

    res.json({ success: true, message: "銀行戶口已設定" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 6. POST /api/wallet/pay-rental — 銀包扣數租場 =====
router.post("/pay-rental", authenticateToken, (req, res) => {
  // 🚫 安全（2026-10-19）：客戶端傳入 amount 可以任意改細，而且唔會更新租場紀錄。
  // 一律改用 POST /api/venue-rentals/:id/pay（金額由租場紀錄決定、有付款冪等檢查）。
  return res.status(403).json({
    success: false,
    code: "USE_VENUE_RENTAL_PAY",
    error: "請喺「租場紀錄」用付款按鈕繳費。",
  });
  /* eslint-disable no-unreachable */
  try {
    const { rental_id, amount } = req.body;
    if (!rental_id || !amount) {
      return res.status(400).json({ success: false, error: "缺少資料" });
    }

    const result = walletService.debitWallet({
      userId: req.user.id,
      amount: parseFloat(amount),
      type: "rental_payment",
      description: `租場扣數 #${rental_id}`,
      reference: `場地租金 HK$${amount}`,
      sourceType: "venue_rental",
      sourceId: rental_id,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // ⛓️ 區塊鏈：記錄租場扣數
    try {
      writeBlock({
        entityType: "wallet_transaction",
        entityId: result.transaction_id,
        data: {
          user_id: req.user.id,
          amount,
          type: "rental_payment",
          balance_after: result.balance_after,
          status: "completed",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (rental pay):", bcErr.message);
    }

    res.json({
      success: true,
      amount,
      balance_after: result.balance_after,
      transaction_id: result.transaction_id,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================
// Admin 管理員路由
// =====================

// ===== A1. GET /api/wallet/admin/coaches — 所有教練錢包總覽 =====
router.get("/admin/coaches", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);

    if (!user || !["admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ success: false, error: "僅管理員可查看" });
    }

    const { limit = 50, offset = 0 } = req.query;
    const result = walletService.getAllCoachWallets({
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json(result);
  } catch (err) {
    console.error("[WALLET] admin/coaches error:", err);
    res.status(500).json({ success: false, error: "無法獲取教練錢包資料" });
  }
});

// ===== A2. GET /api/wallet/admin/txs/:userId — 指定教練交易記錄 =====
router.get("/admin/txs/:userId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);

    if (!user || !["admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ success: false, error: "僅管理員可查看" });
    }

    const { type, limit = 100, offset = 0, start_date, end_date } = req.query;
    const result = walletService.getTransactions({
      userId: req.params.userId,
      type: type || null,
      limit: parseInt(limit),
      offset: parseInt(offset),
      startDate: start_date || null,
      endDate: end_date || null,
    });
    res.json(result);
  } catch (err) {
    console.error("[WALLET] admin/txs error:", err);
    res.status(500).json({ success: false, error: "無法獲取交易記錄" });
  }
});

// ===== A2.5 GET /api/wallet/admin/reconcile — 帳目一致性報告（read-only）=====
router.get("/admin/reconcile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.id);
    if (!me || !["admin", "super_admin"].includes(me.role)) {
      return res.status(403).json({ success: false, error: "僅管理員可查看" });
    }

    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.wallet_balance, u.pending_payout,
                COALESCE((SELECT SUM(net_amount) FROM coach_earnings
                          WHERE coach_id = u.id AND status = 'pending'), 0) AS earnings_pending
         FROM users u
         WHERE COALESCE(u.wallet_balance,0) <> 0 OR COALESCE(u.pending_payout,0) <> 0`,
      )
      .all();

    const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const mismatches = [];
    let walletTotal = 0;
    let pendingTotal = 0;
    for (const r of rows) {
      walletTotal += Number(r.wallet_balance) || 0;
      pendingTotal += Number(r.pending_payout) || 0;
      const diff = round((Number(r.wallet_balance) || 0) - (Number(r.pending_payout) || 0));
      if (Math.abs(diff) > 0.009) {
        mismatches.push({
          user_id: r.id,
          name: r.name,
          email: r.email,
          wallet_balance: round(r.wallet_balance),
          pending_payout: round(r.pending_payout),
          earnings_pending: round(r.earnings_pending),
          diff,
        });
      }
    }

    res.json({
      success: true,
      users_checked: rows.length,
      wallet_total: round(walletTotal),
      pending_total: round(pendingTotal),
      mismatches: mismatches.slice(0, 50),
      mismatch_count: mismatches.length,
    });
  } catch (err) {
    console.error("[WALLET] reconcile error:", err.message);
    res.status(500).json({ success: false, error: "對帳失敗" });
  }
});

// ===== A3. POST /api/wallet/admin/adjust — 管理員調整結餘（audit trail） =====
router.post("/admin/adjust", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const admin = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    if (!admin || !["admin", "super_admin"].includes(admin.role)) {

      return res.status(403).json({ success: false, error: "僅管理員可操作" });
    }

    const { user_id, amount, reason } = req.body;
    if (!user_id || !amount || !reason) {

      return res
        .status(400)
        .json({ error: "缺少資料 (user_id, amount, reason)" });
    }

    const result =
      amount > 0
        ? walletService.creditCoachEarning({
            coachId: user_id,
            scheduleId: "admin-adjust",
            coachEarningId: `adjust-${uuidv4()}`,
            netAmount: Math.abs(amount),
            description: `管理員調整: ${reason}`,
            bookingId: null,
          })
        : walletService.debitWallet({
            userId: user_id,
            amount: Math.abs(amount),
            type: "adjustment",
            description: `管理員調整: ${reason}`,
            reference: reason,
            sourceType: "admin",
            sourceId: req.user.id,
          });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
