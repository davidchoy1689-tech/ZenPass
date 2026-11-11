/**
 * ZenPass — 通行證（Multi-Pass）路由
 *  GET  /api/passes/my                      本人有效通行證
 *  POST /api/passes/admin/issue             簽發（需 finance.payout.process）
 *  GET  /api/passes/admin/list?phone=       查詢（需 finance.payout.view）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const { requirePhoneGate } = require("../services/phone-gate");
const passes = require("../services/passes");
const { audit } = require("../services/audit");

const router = express.Router();
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.CORS_ORIGIN || "http://localhost:3001";
let stripeClient = null;

function getStripe() {
  if (!stripeClient && STRIPE_SECRET && STRIPE_SECRET !== "sk_test_xxxxxxxxxxxxxxxxxxxx") {
    stripeClient = require("stripe")(STRIPE_SECRET);
  }
  return stripeClient;
}

router.get("/plans", (req, res) => {
  res.json({ success: true, plans: Object.values(passes.PASS_PLANS) });
});

// 建立 Stripe Checkout（4／8 堂家庭 Pass）
router.post("/create-checkout", authenticateToken, requirePhoneGate, async (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const plan = passes.resolvePlan((req.body || {}).pass_plan_id || (req.body || {}).plan_key);
    if (!plan) return res.status(400).json({ success: false, error: "Pass 方案無效" });

    const familyGroupId = (req.body || {}).family_group_id || null;
    if (familyGroupId) {
      const g = db.prepare("SELECT * FROM family_groups WHERE id=?").get(familyGroupId);
      if (!g) return res.status(404).json({ success: false, error: "找不到家庭群組" });
      if (g.owner_user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "只有家庭付款人可購買家庭 Pass" });
      }
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ success: false, error: "線上付款暫未開通，請使用 FPS 或聯絡客服" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.user.email || undefined,
      client_reference_id: req.user.id,
      line_items: [
        {
          price_data: {
            currency: "hkd",
            product_data: { name: plan.name, description: `${plan.units} 堂 · ${plan.valid_days} 天內有效` },
            unit_amount: plan.price_cents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        kind: "pass_purchase",
        user_id: req.user.id,
        family_group_id: familyGroupId || "",
        plan_id: plan.id,
        units: String(plan.units),
      },
      success_url: `${FRONTEND_URL}/pass.html?pass_success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/pass.html?pass_cancel=1`,
    });

    res.json({ success: true, checkout_url: session.url, session_id: session.id, plan });
  } catch (e) {
    console.error("[PASS] create-checkout:", e.message);
    res.status(500).json({ success: false, error: "無法建立付款頁面" });
  }
});

// 付款完成後發卡（前端回跳呼叫；webhook 亦會走同一 service）
// 規格對齊：PaymentIntent 建立（Stripe Elements / Apple Pay / 信用卡）
router.post("/checkout/create-intent", authenticateToken, requirePhoneGate, async (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const b = req.body || {};
    const plan = passes.resolvePlan(b.plan_key || b.pass_plan_id);
    if (!plan) return res.status(400).json({ success: false, error: "Pass 方案無效" });
    const familyGroupId = b.family_group_id || null;
    if (familyGroupId) {
      const g = db.prepare("SELECT * FROM family_groups WHERE id=?").get(familyGroupId);
      if (!g) return res.status(404).json({ success: false, error: "找不到家庭群組" });
      if (g.owner_user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "只有家庭付款人可購買家庭 Pass" });
      }
    }

    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通，請使用 FPS" });

    const intent = await stripe.paymentIntents.create({
      amount: plan.price_cents,
      currency: "hkd",
      automatic_payment_methods: { enabled: true },
      receipt_email: req.user.email || undefined,
      metadata: {
        product_type: "user_pass",
        plan_key: plan.id,
        units: String(plan.units),
        owner_user_id: req.user.id,
        family_group_id: familyGroupId || "",
      },
    });
    res.json({
      success: true,
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      amount_cents: plan.price_cents,
      plan,
    });
  } catch (e) {
    console.error("[PASS] create-intent:", e.message);
    res.status(500).json({ success: false, error: "無法建立付款" });
  }
});

// 規格對齊：PaymentIntent 完成後原子發卡（idempotent）
router.post("/checkout/complete", authenticateToken, async (req, res) => {
  try {
    const piId = String((req.body || {}).payment_intent_id || "");
    if (!piId) return res.status(400).json({ success: false, error: "缺少 payment_intent_id" });
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通" });

    const pi = await stripe.paymentIntents.retrieve(piId);
    if (!pi || pi.status !== "succeeded") {
      return res.status(402).json({ success: false, error: "付款尚未完成" });
    }
    const md = pi.metadata || {};
    if (md.product_type !== "user_pass") return res.status(400).json({ success: false, error: "付款類型不符" });
    if (md.owner_user_id !== req.user.id) return res.status(403).json({ success: false, error: "此付款不屬於你" });
    if (pi.currency !== "hkd") return res.status(400).json({ success: false, error: "幣種不符" });

    const plan = passes.resolvePlan(md.plan_key);
    if (!plan) return res.status(400).json({ success: false, error: "Pass 方案無效" });
    if (Number(pi.amount) !== plan.price_cents) {
      return res.status(400).json({ success: false, error: "付款金額不符" });
    }

    const db = getDb();
    passes.ensureSchema(db);
    const r = passes.fulfillPassPurchase(db, {
      userId: req.user.id,
      planId: plan.id,
      familyGroupId: md.family_group_id || null,
      paymentIntentId: pi.id,
      sessionId: pi.id,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    try {
      audit({
        actionType: "pass.purchased_auto_issued",
        entityType: "user_pass",
        entityId: r.pass.id,
        userId: req.user.id,
        newValues: { plan_key: md.plan_key || plan.id, family_group_id: md.family_group_id || null, amount_cents: plan.price_cents },
        description: "Stripe PaymentIntent 自動發卡",
      });
    } catch (e) {}
    res.status(r.duplicated ? 200 : 201).json({ success: true, pass: r.pass, duplicated: !!r.duplicated });
  } catch (e) {
    console.error("[PASS] checkout/complete:", e.message);
    res.status(500).json({ success: false, error: "發卡失敗，請聯絡客服" });
  }
});

router.post("/complete-checkout", authenticateToken, async (req, res) => {
  try {
    const sessionId = String((req.body || {}).session_id || "");
    if (!sessionId) return res.status(400).json({ success: false, error: "缺少 session_id" });
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return res.status(402).json({ success: false, error: "付款尚未完成" });
    }
    const md = session.metadata || {};
    if (md.kind !== "pass_purchase") return res.status(400).json({ success: false, error: "付款類型不符" });
    if (md.user_id !== req.user.id) return res.status(403).json({ success: false, error: "此付款不屬於你" });

    const plan = passes.resolvePlan(md.plan_id || md.plan_key);
    if (!plan) return res.status(400).json({ success: false, error: "Pass 方案無效" });
    if (Number(session.amount_total) !== plan.price_cents) {
      return res.status(400).json({ success: false, error: "付款金額不符" });
    }

    const db = getDb();
    passes.ensureSchema(db);
    const r = passes.fulfillPassPurchase(db, {
      userId: req.user.id,
      planId: plan.id,
      familyGroupId: md.family_group_id || null,
      paymentIntentId: session.payment_intent || session.id,
      sessionId: session.id,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    try {
      audit({
        actionType: "pass.purchased",
        entityType: "user_pass",
        entityId: r.pass.id,
        userId: req.user.id,
        newValues: { plan_id: plan.id, family_group_id: md.family_group_id || null, amount_cents: plan.price_cents },
        description: `Stripe 購買 ${plan.name}`,
      });
    } catch (e) {}
    res.status(r.duplicated ? 200 : 201).json({ success: true, pass: r.pass, duplicated: !!r.duplicated });
  } catch (e) {
    console.error("[PASS] complete-checkout:", e.message);
    res.status(500).json({ success: false, error: "發卡失敗，請聯絡客服" });
  }
});

// FPS 備用通路：先落單，管理員確認入數後用同一 fulfill 函數發卡
router.post("/fps-order", authenticateToken, requirePhoneGate, (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const b = req.body || {};
    const plan = passes.resolvePlan(b.pass_plan_id || b.plan_key);
    if (!plan) return res.status(400).json({ success: false, error: "Pass 方案無效" });
    const reference = String(b.reference || "").trim();
    if (reference.length < 3) return res.status(400).json({ success: false, error: "請填寫 FPS 參考編號" });

    const familyGroupId = b.family_group_id || null;
    if (familyGroupId) {
      const g = db.prepare("SELECT * FROM family_groups WHERE id=?").get(familyGroupId);
      if (!g) return res.status(404).json({ success: false, error: "找不到家庭群組" });
      if (g.owner_user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "只有家庭付款人可購買家庭 Pass" });
      }
    }

    const id = "ppo_" + crypto.randomBytes(8).toString("hex");
    db.prepare(
      `INSERT INTO pass_purchase_orders (id,user_id,plan_id,family_group_id,amount_cents,method,reference,status)
       VALUES (?,?,?,?,?,'fps',?,'pending')`,
    ).run(id, req.user.id, plan.id, familyGroupId, plan.price_cents, reference);
    try {
      audit({
        actionType: "pass.fps_order_created",
        entityType: "pass_purchase_order",
        entityId: id,
        userId: req.user.id,
        newValues: { plan_id: plan.id, family_group_id: familyGroupId, amount_cents: plan.price_cents, reference },
        description: "提交 FPS 購買 Pass",
      });
    } catch (e) {}
    res.status(201).json({ success: true, order_id: id, amount_cents: plan.price_cents, status: "pending" });
  } catch (e) {
    console.error("[PASS] fps-order:", e.message);
    res.status(500).json({ success: false, error: "提交失敗" });
  }
});

router.get("/admin/orders", authenticateToken, requirePermission("finance.refund.view"), (req, res) => {
  try {
    const db = getDb();
    passes.ensureSchema(db);
    const status = String(req.query.status || "pending");
    const rows = db
      .prepare(
        `SELECT o.*, u.name AS user_name, u.phone AS user_phone
           FROM pass_purchase_orders o JOIN users u ON u.id=o.user_id
          WHERE o.status=? ORDER BY datetime(o.created_at) ASC LIMIT 200`,
      )
      .all(status);
    res.json({ success: true, orders: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

router.post(
  "/admin/orders/:id/confirm",
  authenticateToken,
  requirePermission("finance.payout.process"),
  (req, res) => {
    try {
      const db = getDb();
      passes.ensureSchema(db);
      const order = db.prepare("SELECT * FROM pass_purchase_orders WHERE id=?").get(req.params.id);
      if (!order) return res.status(404).json({ success: false, error: "訂單不存在" });
      if (order.status !== "pending") return res.status(409).json({ success: false, error: "此單已處理" });
      const plan = passes.resolvePlan(order.plan_id);
      if (!plan) return res.status(400).json({ success: false, error: "方案無效" });
      const paymentRef = String((req.body || {}).payment_ref || order.reference || "").trim();
      if (paymentRef.length < 3) return res.status(400).json({ success: false, error: "缺少入數參考" });

      const r = passes.fulfillPassPurchase(db, {
        userId: order.user_id,
        planId: plan.id,
        familyGroupId: order.family_group_id,
        paymentIntentId: "fps_" + order.id,
        sessionId: order.id,
      });
      if (!r.ok) return res.status(400).json({ success: false, error: r.error });
      db.prepare(
        "UPDATE pass_purchase_orders SET status='confirmed', confirmed_by=?, confirmed_at=datetime('now'), payment_ref=? WHERE id=? AND status='pending'",
      ).run(req.user.id, paymentRef, order.id);
      try {
        audit({
          actionType: "pass.fps_order_confirmed",
          entityType: "pass_purchase_order",
          entityId: order.id,
          userId: req.user.id,
          newValues: { pass_id: r.pass.id, payment_ref: paymentRef, amount_cents: order.amount_cents },
          description: "確認 FPS 入數並發 Pass",
        });
      } catch (e) {}
      res.json({ success: true, pass: r.pass, order_id: order.id });
    } catch (e) {
      console.error("[PASS] confirm order:", e.message);
      res.status(500).json({ success: false, error: "確認失敗" });
    }
  },
);

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
    let familyGroup = null;
    if (b.family_group_id) {
      familyGroup = db.prepare("SELECT * FROM family_groups WHERE id=?").get(b.family_group_id);
      if (!familyGroup) return res.status(404).json({ success: false, error: "找不到家庭群組" });
      const phone = passes.normalizePhone(b.phone || b.user_phone);
      const target = b.user_id
        ? db.prepare("SELECT id FROM users WHERE id=?").get(b.user_id)
        : db.prepare("SELECT id FROM users WHERE phone=? OR phone=? LIMIT 1").get(phone, "852" + phone);
      if (!target || target.id !== familyGroup.owner_user_id) {
        return res.status(400).json({ success: false, error: "家庭 Pass 只可簽發俾付款人本人" });
      }
    }
    const r = passes.issuePass(db, {
      userId: b.user_id || null,
      phone: b.phone || b.user_phone,
      studentName: b.student_name || b.studentName,
      totalCredits: b.total_credits,
      pricePaid: b.price_paid,
      validDays: b.valid_days,
      notes: b.notes,
      createdBy: req.user.id,
      familyGroupId: familyGroup ? familyGroup.id : null,
      ownerUserId: familyGroup ? familyGroup.owner_user_id : null,
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
