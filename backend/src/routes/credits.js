/**
 * ZenPass — Credits 增值（FPS / PayMe 人手確認）
 *
 * 安全原則：**冇確認收款，唔會加點**
 *   用戶：建立增值單（pending）→ 轉數快/PayMe 入數 → 提交參考編號 + 收據
 *   管理員：核對銀行紀錄 → 確認 → 才加 credits（同時寫 transaction + 區塊鏈 audit）
 *
 * 取代舊有「一按即加點」嘅 /api/memberships/credits 同 /api/topup/execute。
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken, requireAdmin, optionalAuth } = require("../middleware/auth");
const { getDb } = require("../services/database");
const { writeBlock } = require("../services/blockchain-audit");
const { applyTopUpDiscount } = require("../services/loyalty");

const router = express.Router();

const PAY_INFO = {
  fps: {
    label: "轉數快 FPS / 銀行轉賬",
    bank: "HSBC 滙豐銀行",
    account: "741-293856-838",
    name: "香港康樂及體育有限公司",
    name_en: "Hong Kong Leisure and Fitness Company Limited",
  },
  payme: {
    label: "PayMe",
    link: "https://qr.payme.hsbc.com.hk/2/8EKv4B8usVVSSdf2YzLSkm",
    name: "香港康樂及體育有限公司",
  },
};

const BONUS_TIERS = [
  { min: 1000, bonus: 30 },
  { min: 500, bonus: 12 },
  { min: 100, bonus: 2 },
];

function creditsFor(amount) {
  const credits = Math.floor(Number(amount) / 10); // HK$10 = 1 credit
  const tier = BONUS_TIERS.find((t) => credits >= t.min);
  return { credits, bonus: tier ? tier.bonus : 0 };
}

// ===== GET /api/credits/packages — 增值方案（公開；登入後套用會員等級折扣）=====
router.get("/packages", optionalAuth, (req, res) => {
  const userId = req.user && req.user.id;
  const list = [100, 250, 550, 1000].map((amount) => {
    const { credits, bonus } = creditsFor(amount);
    const q = applyTopUpDiscount(amount, userId);
    return {
      amount_hkd: amount, // 原價（購買價值）
      original_amount_hkd: q.original_amount_hkd,
      discount_percent: q.discount_percent,
      payable_hkd: q.payable_hkd, // 實付（會員折扣後）
      credits,
      bonus_credits: bonus,
      total_credits: credits + bonus,
    };
  });
  res.json({
    success: true,
    data: { packages: list, rate: "HK$10 = 1 credit", pay: PAY_INFO },
  });
});

// ===== POST /api/credits/topup — 建立增值單（pending，唔加點）=====
router.post("/topup", authenticateToken, (req, res) => {
  try {
    const { amount, method = "fps", reference, receipt_image } = req.body || {};
    const amt = Number(amount);
    if (!amt || amt < 20) return res.status(400).json({ success: false, error: "最低增值金額 HK$20" });
    if (amt > 20000) return res.status(400).json({ success: false, error: "單次最多 HK$20,000" });
    if (!PAY_INFO[method]) return res.status(400).json({ success: false, error: "付款方式無效" });
    if (!reference || String(reference).trim().length < 3) {
      return res.status(400).json({ success: false, error: "請填寫轉數快／PayMe 參考編號（交易編號）" });
    }

    const db = getDb();
    const { credits, bonus } = creditsFor(amt);
    // 會員等級增值折扣（銀 5% / 金、VIP 10%）— 伺服器計算，唔信前端
    const q = applyTopUpDiscount(amt, req.user.id);
    const id = uuidv4();

    db.prepare(
      `INSERT INTO credit_topup_orders (id, user_id, amount_hkd, original_amount_hkd, discount_percent, credits, bonus_credits, method, reference, receipt_image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      id,
      req.user.id,
      q.payable_hkd,
      q.original_amount_hkd,
      q.discount_percent,
      credits,
      bonus,
      method,
      String(reference).trim(),
      receipt_image || null,
    );

    // 通知管理員（Email / 站內）
    try {
      const { sendNotification } = require("../services/notification");
      sendNotification("credits.topup_request", {
        recipient: req.user.id,
        data: { amount: q.payable_hkd, original_amount: q.original_amount_hkd, discount_percent: q.discount_percent, credits, method, reference },
      });
    } catch (e) {}

    res.status(201).json({
      success: true,
      message: "✅ 已提交，管理員核對收款後會即刻加點",
      data: {
        order_id: id,
        amount_hkd: q.payable_hkd,
        original_amount_hkd: q.original_amount_hkd,
        discount_percent: q.discount_percent,
        credits_to_add: credits + bonus,
        status: "pending",
        pay: PAY_INFO[method],
      },
    });
  } catch (err) {
    console.error("credits/topup error:", err.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

// ===== GET /api/credits/orders — 我嘅增值紀錄 =====
router.get("/orders", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, amount_hkd, original_amount_hkd, discount_percent, credits, bonus_credits, method, reference, status, note, created_at, confirmed_at
         FROM credit_topup_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
      )
      .all(req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "無法讀取紀錄" });
  }
});

// ===== 管理員：待確認清單 =====
router.get("/admin/pending", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT o.*, u.name AS user_name, u.email AS user_email
         FROM credit_topup_orders o JOIN users u ON o.user_id = u.id
         WHERE o.status = 'pending' ORDER BY o.created_at ASC`,
      )
      .all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

// ===== 管理員：確認收款 → 加點 =====
router.post("/admin/:id/confirm", authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const order = db.prepare("SELECT * FROM credit_topup_orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ success: false, error: "增值單不存在" });
  if (order.status !== "pending") return res.status(409).json({ success: false, error: "此單已處理" });

  const actual = req.body && req.body.actual_amount ? Number(req.body.actual_amount) : Number(order.amount_hkd);
  if (!actual || actual <= 0) return res.status(400).json({ success: false, error: "金額無效" });

  // 實收少於應付（會員價）→ 唔可以確認，避免折扣後收唔足錢但照加點
  const payable = Number(order.amount_hkd) || 0;
  if (actual + 0.01 < payable) {
    return res.status(400).json({
      success: false,
      error: `實收 ${actual} 少於應付 ${payable}，請核對後再確認`,
      expected_amount: payable,
    });
  }

  // Credits 以落單時嘅購買價值為準（折扣只影響實付金額，唔會減少 credits）
  const credits = Number(order.credits) || 0;
  const bonus = Number(order.bonus_credits) || 0;
  const total = credits + bonus;

  try {
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE credit_topup_orders SET status='confirmed', amount_hkd=?, credits=?, bonus_credits=?,
           admin_id=?, confirmed_at=datetime('now'), note=?
         WHERE id=? AND status='pending'`,
      ).run(actual, credits, bonus, req.user.id, (req.body && req.body.note) || null, order.id);

      db.prepare("UPDATE users SET credits = COALESCE(credits,0) + ? WHERE id = ?").run(total, order.user_id);
      db.prepare(
        `INSERT INTO transactions (id, user_id, type, amount, description)
         VALUES (?, ?, 'credits_topup', ?, ?)`,
      ).run(uuidv4(), order.user_id, actual, `增值 ${credits} Credits${bonus ? ` + 贈送 ${bonus}` : ""}（${order.method.toUpperCase()} ${order.reference}）`);
    });
    tx();

    try {
      writeBlock({
        entityType: "credit_topup",
        entityId: order.id,
        data: { user_id: order.user_id, amount: actual, original_amount: order.original_amount_hkd, discount_percent: order.discount_percent || 0, credits: total, method: order.method, admin: req.user.id },
      });
    } catch (e) {}

    try {
      const { sendNotification } = require("../services/notification");
      sendNotification("credits.topup_confirmed", {
        recipient: order.user_id,
        data: { amount: actual, credits: total },
      });
    } catch (e) {}

    res.json({ success: true, message: `✅ 已確認，加 ${total} credits`, credits_added: total });
  } catch (err) {
    console.error("credits confirm error:", err.message);
    res.status(500).json({ success: false, error: "確認失敗" });
  }
});

// ===== 管理員：拒絕 =====
router.post("/admin/:id/reject", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const r = db
      .prepare(
        "UPDATE credit_topup_orders SET status='rejected', admin_id=?, note=?, confirmed_at=datetime('now') WHERE id=? AND status='pending'",
      )
      .run(req.user.id, (req.body && req.body.reason) || "未收到款項", req.params.id);
    if (!r.changes) return res.status(409).json({ success: false, error: "此單已處理或不存在" });
    res.json({ success: true, message: "已拒絕" });
  } catch (err) {
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

module.exports = router;
