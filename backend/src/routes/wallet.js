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
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const walletService = require("../services/wallet-service");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";
const WITHDRAWAL_FEE = 1;

// ===== 1. GET /api/wallet/summary — 錢包總覽 =====
router.get("/summary", authenticateToken, (req, res) => {
  try {
    const summary = walletService.getWalletSummary(req.user.id);
    if (!summary) return res.status(404).json({ error: "用戶不存在" });
    res.json(summary);
  } catch (err) {
    console.error("[WALLET] /summary error:", err);
    res.status(500).json({ error: "無法獲取錢包資料" });
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
    res.status(500).json({ error: "無法獲取交易記錄" });
  }
});

// ===== 3. GET /api/wallet/balance — 簡單結餘查詢 (backward compat) =====
router.get("/balance", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare(
        "SELECT wallet_balance, bank_name, bank_account, bank_code FROM users WHERE id = ?",
      )
      .get(req.user.id);
    db.close();
    if (!user) return res.status(404).json({ error: "用戶不存在" });

    res.json({
      balance: user.wallet_balance || 0,
      bank: user.bank_name
        ? {
            name: user.bank_name,
            account: user.bank_account,
            code: user.bank_code,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 4. POST /api/wallet/withdraw — 提現 =====
router.post("/withdraw", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare(
        "SELECT wallet_balance, bank_name, bank_account FROM users WHERE id = ?",
      )
      .get(req.user.id);

    if (!user || !user.bank_account) {
      db.close();
      return res.status(400).json({ error: "請先設定銀行戶口" });
    }

    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) {
      db.close();
      return res.status(400).json({ error: "請輸入有效金額" });
    }

    if (amount < 100) {
      db.close();
      return res.status(400).json({ error: "最低提現金額為 HK$100" });
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

    db.close();

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Also insert payout request record
    const payoutDb = new Database(DB_PATH);
    const poRef =
      "PO-" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      Math.random().toString(36).substring(2, 6).toUpperCase();
    payoutDb
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
    payoutDb.close();

    res.json({
      success: true,
      amount,
      fee: WITHDRAWAL_FEE,
      balance_before: result.balance_before,
      balance_after: result.balance_after,
      transaction_id: result.transaction_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 5. POST /api/wallet/bank — 設定銀行戶口 =====
router.post("/bank", authenticateToken, (req, res) => {
  try {
    const { bank_name, bank_account, bank_code } = req.body;
    if (!bank_name || !bank_account) {
      return res.status(400).json({ error: "請填寫銀行名稱同戶口號碼" });
    }

    const db = new Database(DB_PATH);
    db.prepare(
      "UPDATE users SET bank_name = ?, bank_account = ?, bank_code = ? WHERE id = ?",
    ).run(bank_name, bank_account, bank_code || "", req.user.id);
    db.close();

    res.json({ success: true, message: "銀行戶口已設定" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 6. POST /api/wallet/pay-rental — 銀包扣數租場 =====
router.post("/pay-rental", authenticateToken, (req, res) => {
  try {
    const { rental_id, amount } = req.body;
    if (!rental_id || !amount) {
      return res.status(400).json({ error: "缺少資料" });
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
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      amount,
      balance_after: result.balance_after,
      transaction_id: result.transaction_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// Admin 管理員路由
// =====================

// ===== A1. GET /api/wallet/admin/coaches — 所有教練錢包總覽 =====
router.get("/admin/coaches", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    db.close();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "僅管理員可查看" });
    }

    const { limit = 50, offset = 0 } = req.query;
    const result = walletService.getAllCoachWallets({
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json(result);
  } catch (err) {
    console.error("[WALLET] admin/coaches error:", err);
    res.status(500).json({ error: "無法獲取教練錢包資料" });
  }
});

// ===== A2. GET /api/wallet/admin/txs/:userId — 指定教練交易記錄 =====
router.get("/admin/txs/:userId", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    db.close();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "僅管理員可查看" });
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
    res.status(500).json({ error: "無法獲取交易記錄" });
  }
});

// ===== A3. POST /api/wallet/admin/adjust — 管理員調整結餘（audit trail） =====
router.post("/admin/adjust", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const admin = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(req.user.id);
    if (!admin || admin.role !== "admin") {
      db.close();
      return res.status(403).json({ error: "僅管理員可操作" });
    }

    const { user_id, amount, reason } = req.body;
    if (!user_id || !amount || !reason) {
      db.close();
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

    db.close();

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
