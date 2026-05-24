/**
 * ZenPass 教練銀包系統
 * Wallet balance → 租場扣數 / 提現
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";
const WITHDRAWAL_FEE = 1;

// ===== 1. GET /api/wallet/balance — 查詢銀包 =====
router.get("/balance", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT wallet_balance, bank_name, bank_account, bank_code FROM users WHERE id = ?").get(req.user.id);
    if (!user) { db.close(); return res.status(404).json({ error: "用戶不存在" }); }
    
    db.close();
    res.json({
      balance: user.wallet_balance || 0,
      bank: user.bank_name ? {
        name: user.bank_name,
        account: user.bank_account,
        code: user.bank_code,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 2. GET /api/wallet/transactions — 交易記錄 =====
router.get("/transactions", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const limit = parseInt(req.query.limit) || 50;
    const txs = db.prepare(
      "SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(req.user.id, limit);
    db.close();
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 3. POST /api/wallet/withdraw — 提現 =====
router.post("/withdraw", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT wallet_balance, bank_name, bank_account FROM users WHERE id = ?").get(req.user.id);
    
    if (!user || !user.bank_account) {
      db.close();
      return res.status(400).json({ error: "請先設定銀行戶口" });
    }
    
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) {
      db.close();
      return res.status(400).json({ error: "請輸入有效金額" });
    }
    
    const total = amount + WITHDRAWAL_FEE;
    if (user.wallet_balance < total) {
      db.close();
      return res.status(400).json({ error: `餘額不足。需要 $${total}（提現 $${amount} + 行政費 $${WITHDRAWAL_FEE}）` });
    }
    
    const id = uuidv4();
    const newBalance = Math.round((user.wallet_balance - total) * 100) / 100;
    
    db.prepare("UPDATE users SET wallet_balance = ? WHERE id = ?").run(newBalance, req.user.id);
    db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_before, balance_after, fee, reference)
      VALUES (?, ?, 'withdrawal', ?, ?, ?, ?, ?)`).run(id, req.user.id, amount, user.wallet_balance, newBalance, WITHDRAWAL_FEE, `提現至 ${user.bank_name}`);
    
    db.close();
    res.json({ success: true, amount, fee: WITHDRAWAL_FEE, balance_after: newBalance, transaction_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 4. POST /api/wallet/bank — 設定銀行戶口 =====
router.post("/bank", authenticateToken, (req, res) => {
  try {
    const { bank_name, bank_account, bank_code } = req.body;
    if (!bank_name || !bank_account) {
      return res.status(400).json({ error: "請填寫銀行名稱同戶口號碼" });
    }
    
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET bank_name = ?, bank_account = ?, bank_code = ? WHERE id = ?")
      .run(bank_name, bank_account, bank_code || "", req.user.id);
    db.close();
    
    res.json({ success: true, message: "銀行戶口已設定" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 5. POST /api/wallet/pay-rental — 銀包扣數租場 =====
router.post("/pay-rental", authenticateToken, (req, res) => {
  try {
    const { rental_id, amount } = req.body;
    if (!rental_id || !amount) {
      return res.status(400).json({ error: "缺少資料" });
    }
    
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT wallet_balance FROM users WHERE id = ?").get(req.user.id);
    
    if (user.wallet_balance < amount) {
      db.close();
      return res.status(400).json({ error: `餘額不足。需要 $${amount}，目前 $${user.wallet_balance}` });
    }
    
    const newBalance = Math.round((user.wallet_balance - amount) * 100) / 100;
    const id = uuidv4();
    
    db.prepare("UPDATE users SET wallet_balance = ? WHERE id = ?").run(newBalance, req.user.id);
    db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_before, balance_after, reference)
      VALUES (?, ?, 'rental_payment', ?, ?, ?, ?)`).run(id, req.user.id, amount, user.wallet_balance, newBalance, `租場扣數 #${rental_id}`);
    
    db.close();
    res.json({ success: true, amount, balance_after: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
