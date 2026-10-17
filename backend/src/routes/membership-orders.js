/**
 * ZenPass — 會籍購買（FPS / PayMe 人手確認）
 *
 * 安全原則：**未確認收款，唔會開通會籍 / 唔會加點**
 *   用戶：建立會籍訂單（pending）→ 入數 → 提交參考編號／收據
 *   管理員：核對銀行紀錄 → 確認 → 開通會籍 + 加 credits + entitlements + audit
 *
 * 取代舊有免付款嘅 POST /api/memberships/subscribe。
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { getDb } = require("../services/database");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

const PLAN_PAY = {
  fps: {
    label: "銀行轉賬 / FPS",
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

function plans() {
  return require("./memberships").MEMBERSHIP_PLANS || {};
}

// ===== GET /api/membership-orders/plans — 會籍方案 + 收款資料（公開）=====
router.get("/plans", (req, res) => {
  const all = plans();
  const list = Object.keys(all).map((k) => ({
    key: k,
    name: all[k].name,
    name_en: all[k].name_en,
    price_hkd: all[k].price_hkd,
    credits_granted: all[k].credits_granted,
    duration_days: all[k].duration_days,
    description: all[k].description,
    features: all[k].features || [],
    popular: !!all[k].popular,
  }));
  res.json({ success: true, data: { plans: list, pay: PLAN_PAY } });
});

// ===== POST /api/membership-orders — 建立會籍訂單（pending）=====
router.post("/", authenticateToken, (req, res) => {
  try {
    const { plan_key, method = "fps", reference, receipt_image } = req.body || {};
    const all = plans();
    const plan = all[plan_key];
    if (!plan) return res.status(400).json({ success: false, error: "會籍方案無效" });
    if (!PLAN_PAY[method]) return res.status(400).json({ success: false, error: "付款方式無效" });
    if (!reference || String(reference).trim().length < 3) {
      return res.status(400).json({ success: false, error: "請填寫轉數快／PayMe 參考編號" });
    }

    const db = getDb();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO membership_orders
        (id, user_id, plan_key, price_hkd, credits_granted, duration_days, method, reference, receipt_image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      id, req.user.id, plan_key, plan.price_hkd, plan.credits_granted,
      plan.duration_days, method, String(reference).trim(), receipt_image || null,
    );

    res.status(201).json({
      success: true,
      message: "✅ 已提交，管理員核對收款後會開通會籍",
      data: {
        order_id: id,
        plan: plan.name,
        amount_hkd: plan.price_hkd,
        credits: plan.credits_granted,
        status: "pending",
        pay: PLAN_PAY[method],
      },
    });
  } catch (err) {
    console.error("membership-orders POST error:", err.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

// ===== GET /api/membership-orders/my =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, plan_key, price_hkd, credits_granted, method, reference, status, note, created_at, confirmed_at
         FROM membership_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
      )
      .all(req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

// ===== 管理員：待確認 =====
router.get("/admin/pending", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT o.*, u.name AS user_name, u.email AS user_email
         FROM membership_orders o JOIN users u ON o.user_id = u.id
         WHERE o.status = 'pending' ORDER BY o.created_at ASC`,
      )
      .all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "無法讀取" });
  }
});

// ===== 管理員：確認收款 → 開通會籍 =====
router.post("/admin/:id/confirm", authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const order = db.prepare("SELECT * FROM membership_orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ success: false, error: "訂單不存在" });
  if (order.status !== "pending") return res.status(409).json({ success: false, error: "此單已處理" });

  const now = new Date();
  const end = new Date(now.getTime() + Number(order.duration_days) * 86400000);
  const startStr = now.toISOString();
  const endStr = end.toISOString();
  const membershipId = uuidv4();

  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO memberships (id, user_id, type, price_hkd, credits_granted, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(membershipId, order.user_id, order.plan_key, order.price_hkd, order.credits_granted, startStr, endStr);

      db.prepare(
        `UPDATE users SET membership_type = ?, membership_expires_at = ?,
           credits = COALESCE(credits,0) + ? WHERE id = ?`,
      ).run(order.plan_key, endStr, order.credits_granted, order.user_id);

      db.prepare(
        `INSERT INTO transactions (id, user_id, type, amount, payment_method, description)
         VALUES (?, ?, 'membership', ?, ?, ?)`,
      ).run(
        uuidv4(), order.user_id, order.price_hkd, order.method,
        `會籍 ${order.plan_key}（${order.duration_days}日，${order.reference}）`,
      );

      db.prepare(
        `UPDATE membership_orders SET status='confirmed', admin_id=?, confirmed_at=datetime('now'), note=?
         WHERE id=? AND status='pending'`,
      ).run(req.user.id, (req.body && req.body.note) || null, order.id);
    });
    tx();

    try {
      require("../services/membership-catalog").grantEntitlements(order.user_id, order.plan_key, endStr);
    } catch (e) {
      console.error("⚠️ [ENTITLEMENT] grant failed:", e.message);
    }

    try {
      writeBlock({
        entityType: "membership",
        entityId: membershipId,
        data: {
          userId: order.user_id,
          type: order.plan_key,
          price_hkd: order.price_hkd,
          credits_granted: order.credits_granted,
          confirmed_by: req.user.id,
          order_id: order.id,
        },
      });
    } catch (e) {}

    try {
      const { sendNotification } = require("../services/notification");
      sendNotification("membership.confirmed", {
        recipient: order.user_id,
        data: { plan: order.plan_key, credits: order.credits_granted, expires: endStr.slice(0, 10) },
      });
    } catch (e) {}

    res.json({
      success: true,
      message: `✅ 已開通 ${order.plan_key}，+${order.credits_granted} credits`,
      membership_id: membershipId,
    });
  } catch (err) {
    console.error("membership confirm error:", err.message);
    res.status(500).json({ success: false, error: "開通失敗：" + err.message });
  }
});

// ===== 管理員：拒絕 =====
router.post("/admin/:id/reject", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const r = db
      .prepare(
        "UPDATE membership_orders SET status='rejected', admin_id=?, note=?, confirmed_at=datetime('now') WHERE id=? AND status='pending'",
      )
      .run(req.user.id, (req.body && req.body.reason) || "未收到款項", req.params.id);
    if (!r.changes) return res.status(409).json({ success: false, error: "此單已處理或不存在" });
    res.json({ success: true, message: "已拒絕" });
  } catch (err) {
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

module.exports = router;
