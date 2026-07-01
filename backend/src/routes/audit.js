/**
 * ZenPass 禪流 — 區塊鏈交易追溯路由
 *
 * 每單交易由邊度嚟、去咗邊、最後去咗邊，清清楚楚。
 */

const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const {
  traceBooking,
  traceWalletTransaction,
  verifyChain,
} = require("../services/blockchain-audit");

const router = express.Router();

// ===== GET /api/audit/booking/:id — 追溯一筆 booking 嘅完整資金流向 =====
router.get("/booking/:id", authenticateToken, (req, res) => {
  try {
    const result = traceBooking(req.params.id);
    if (result.error) return res.status(404).json({ success: false, error: result.error });

    res.json({
      booking: result.booking,
      chain: result.chain,
      chain_hash: result.chain_hash,
      total_steps: result.total_steps,
      verified: result.verified,
    });
  } catch (err) {
    console.error("[AUDIT] trace booking error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/audit/wallet/:id — 追溯一筆 wallet 交易嘅完整流向 =====
router.get("/wallet/:id", authenticateToken, (req, res) => {
  try {
    const result = traceWalletTransaction(req.params.id);
    if (result.error) return res.status(404).json({ success: false, error: result.error });
    res.json(result);
  } catch (err) {
    console.error("[AUDIT] trace wallet error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = { router, traceBooking, traceWalletTransaction };
