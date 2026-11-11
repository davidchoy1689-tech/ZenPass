/** Phase 5.2 — 運動復康輔具商城（Drop-shipping + 教練帶貨分佣） */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const { requireIdempotency } = require("../middleware/idempotency");
const { audit } = require("../services/audit");
const { sendNotification } = require("../services/notification");
const mk = require("../services/marketplace");

const router = express.Router();
let stripeClient = null;

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!stripeClient && key && key !== "sk_test_xxxxxxxxxxxxxxxxxxxx") stripeClient = require("stripe")(key);
  return stripeClient;
}

function fail(res, status, code, error) {
  return res.status(status).json({ success: false, code, error });
}

const SEED = [
  ["prod_fascia_ball_01", "HK Medical Rehab Supply Ltd", "HK-REHAB-FB01", "物理治療級 蜂巢深層筋膜放鬆球套裝", "fascia_release", ["office_worker", "elderly", "general_fitness"], 6800, 13800, 2500, "https://images.unsplash.com/photo-1600881333168-2ef49b341f30?w=600&q=70"],
  ["prod_knee_support_01", "HK Medical Rehab Supply Ltd", "HK-REHAB-KN01", "醫用級開放式護膝（可調壓力）", "knee_care", ["elderly", "general_fitness"], 5200, 11800, 2200, "https://images.unsplash.com/photo-1598289431512-b97b0917affc?w=600&q=70"],
  ["prod_lumbar_cushion_01", "ErgoCare HK", "HK-ERGO-LC01", "人體工學記憶棉腰椎坐墊", "lumbar_support", ["office_worker"], 7500, 16800, 3000, "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=70"],
  ["prod_yoga_mat_01", "FlowMat HK", "HK-MAT-PR01", "防滑天然橡膠瑜伽墊（6mm）", "mat", ["general_fitness", "postnatal"], 8000, 15800, 2800, "https://images.unsplash.com/photo-1592432678016-e910b452f9a2?w=600&q=70"],
];

function seedProducts(db) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO marketplace_products
      (id,supplier_name,sku,title,description,category,recommended_audiences,cost_price_cents,retail_price_cents,coach_commission_cents,platform_margin_cents,image_url,stock_quantity,is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,999,1)`,
  );
  for (const p of SEED) {
    const margin = p[7] - p[6] - p[8];
    ins.run(p[0], p[1], p[2], p[3], p[3], p[4], JSON.stringify(p[5]), p[6], p[7], p[8], margin, p[9]);
  }
}

function shapeProduct(p) {
  return {
    id: p.id,
    sku: p.sku,
    title: p.title,
    supplier_name: p.supplier_name,
    category: p.category,
    audiences: (() => { try { return JSON.parse(p.recommended_audiences || "[]"); } catch (e) { return []; } })(),
    price_cents: Number(p.retail_price_cents),
    price: Number(p.retail_price_cents) / 100,
    coach_commission_cents: Number(p.coach_commission_cents),
    image_url: p.image_url,
    in_stock: Number(p.stock_quantity) > 0,
  };
}

function creditCommission(db, order, product) {
  const existing = db.prepare("SELECT id FROM coach_earnings WHERE product_order_id=?").get(order.id);
  if (existing) return existing.id;
  if (!order.coach_id) return null;
  const id = mk.uuidv4();
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Hong_Kong" });
  const retail = Number(order.total_paid_cents);
  const comm = Number(order.commission_cents);
  db.prepare(
    `INSERT INTO coach_earnings
      (id, coach_id, schedule_id, class_id, class_title, date, enrolled_count, unit_price, gross_amount, commission_rate, net_amount, status,
       notes, unit_price_cents, gross_amount_cents, net_amount_cents, earning_type, payout_month, product_order_id, clearing_status)
     VALUES (?,?,NULL,NULL,?,?,?,?,?,?,?,'pending',?,?,?,?, 'affiliate_product_commission', ?, ?, 'pending')`,
  ).run(id, order.coach_id, `輔具帶貨 · ${product.title}`, date, Number(order.quantity || 1), retail / 100, retail / 100,
    retail > 0 ? comm / retail : 0, comm / 100, `商城訂單 ${order.id}`, retail, retail, comm, mk.monthKey(), order.id);
  return id;
}

function markPaid(db, orderId, paymentIntentId) {
  const order = db.prepare("SELECT * FROM marketplace_orders WHERE id=?").get(orderId);
  if (!order) return { error: "ORDER_NOT_FOUND" };
  if (order.order_status !== "pending_payment") return { order, already: true };
  const product = db.prepare("SELECT * FROM marketplace_products WHERE id=?").get(order.product_id);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE marketplace_orders SET order_status='paid', payment_intent_id=COALESCE(payment_intent_id,?), paid_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
      .run(paymentIntentId || null, orderId);
    const earningId = creditCommission(db, order, product);
    db.exec("COMMIT");
    const fresh = db.prepare("SELECT * FROM marketplace_orders WHERE id=?").get(orderId);
    return { order: fresh, earning_id: earningId };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ===== GET /api/marketplace/products =====
router.get("/marketplace/products", (req, res) => {
  try {
    const db = getDb();
    mk.ensureSchema(db);
    seedProducts(db);
    const audience = String(req.query.audience || "").trim();
    const category = String(req.query.category || "").trim();
    let rows = db.prepare("SELECT * FROM marketplace_products WHERE is_active=1 ORDER BY retail_price_cents ASC").all();
    if (audience) rows = rows.filter((p) => { try { return JSON.parse(p.recommended_audiences || "[]").includes(audience); } catch (e) { return false; } });
    if (category) rows = rows.filter((p) => p.category === category);
    res.json({ success: true, products: rows.map(shapeProduct) });
  } catch (e) {
    console.error("[MARKET] products:", e.message);
    fail(res, 500, "SERVER_ERROR", "讀取商品失敗");
  }
});

// ===== POST /api/marketplace/orders/checkout =====
router.post("/marketplace/orders/checkout", authenticateToken, requireIdempotency, async (req, res) => {
  const db = getDb();
  try {
    mk.ensureSchema(db);
    seedProducts(db);
    const b = req.body || {};
    const productId = String(b.product_id || b.productId || "");
    const qty = Math.max(1, Math.min(10, Number(b.quantity || 1)));
    const name = String(b.shipping_name || "").trim();
    const phone = String(b.shipping_phone || "").replace(/\s+/g, "");
    const address = String(b.shipping_address || "").trim();
    const district = String(b.shipping_district || "").trim();
    if (!productId) return fail(res, 400, "PRODUCT_REQUIRED", "缺少商品");
    if (name.length < 2) return fail(res, 400, "NAME_REQUIRED", "請填收件人姓名");
    if (!/^[4-9]\d{7}$/.test(phone)) return fail(res, 400, "PHONE_INVALID", "請填有效香港 8 位電話");
    if (address.length < 6) return fail(res, 400, "ADDRESS_REQUIRED", "請填完整送貨地址");
    if (!district) return fail(res, 400, "DISTRICT_REQUIRED", "請選擇送貨地區");

    const product = db.prepare("SELECT * FROM marketplace_products WHERE id=? AND is_active=1").get(productId);
    if (!product) return fail(res, 404, "PRODUCT_NOT_FOUND", "商品不存在或已下架");
    if (Number(product.stock_quantity) < qty) return fail(res, 409, "OUT_OF_STOCK", "庫存不足");

    const coachId = b.coach_id || b.coachId || null;
    let coach = null;
    if (coachId) {
      coach = db.prepare("SELECT id,is_coach FROM users WHERE id=?").get(String(coachId));
      if (!coach || Number(coach.is_coach) !== 1) return fail(res, 400, "COACH_INVALID", "推薦教練無效");
    }

    const unit = Number(product.retail_price_cents);
    const total = unit * qty;
    const commission = Number(product.coach_commission_cents) * qty;
    const orderId = mk.uuidv4();
    db.prepare(
      `INSERT INTO marketplace_orders
        (id,user_id,coach_id,product_id,quantity,unit_price_cents,total_paid_cents,commission_cents,shipping_name,shipping_phone,shipping_address,shipping_district,order_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(orderId, req.user.id, coach ? coach.id : null, product.id, qty, unit, total, commission, name, phone, address, district,
      process.env.MARKETPLACE_SIMULATE_PAYMENT === "1" ? "pending_payment" : "pending_payment");

    // 測試／未配置 Stripe：明確的模擬付款模式（只可在非生產環境開啟）
    const simulate = process.env.MARKETPLACE_SIMULATE_PAYMENT === "1";
    if (simulate) {
      const done = markPaid(db, orderId, "sim_" + crypto.randomBytes(8).toString("hex"));
      audit({ actionType: "marketplace.order_paid", entityType: "marketplace_order", entityId: orderId, userId: req.user.id, newValues: { total_cents: total, commission_cents: commission, simulated: true }, description: "輔具訂單（模擬付款）" });
      return res.status(201).json({ success: true, order: done.order, commission_earning_id: done.earning_id, simulated: true });
    }

    const s = stripe();
    if (!s) return fail(res, 503, "PAYMENT_NOT_CONFIGURED", "線上付款未配置，請用 FPS 或稍後再試");

    const baseUrl = process.env.PUBLIC_BASE_URL || "https://zenpass.hk";
    const session = await s.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "hkd",
          product_data: { name: product.title, description: "ZenPass 輔具 · 順豐包郵" },
          unit_amount: unit,
        },
        quantity: qty,
      }],
      metadata: { product_type: "marketplace_product", order_id: orderId, product_id: product.id, user_id: req.user.id, coach_id: coach ? coach.id : "" },
      success_url: `${baseUrl}/student-handbook.html?mk_order=${orderId}`,
      cancel_url: `${baseUrl}/student-handbook.html?mk_cancel=1`,
    });
    db.prepare("UPDATE marketplace_orders SET payment_intent_id=?, updated_at=datetime('now') WHERE id=?").run(session.id, orderId);
    audit({ actionType: "marketplace.order_created", entityType: "marketplace_order", entityId: orderId, userId: req.user.id, newValues: { total_cents: total, product_id: product.id, coach_id: coach?.id || null }, description: "輔具訂單建立" });

    res.status(201).json({
      success: true,
      order_id: orderId,
      order_status: "pending_payment",
      total_paid_cents: total,
      checkout_url: session.url,
      payment_intent_id: session.id,
      product: shapeProduct(product),
    });
  } catch (e) {
    console.error("[MARKET] checkout:", e.message);
    fail(res, 500, "SERVER_ERROR", "下單失敗");
  }
});

// ===== POST /api/marketplace/orders/:id/complete =====
router.post("/marketplace/orders/:id/complete", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    mk.ensureSchema(db);
    const order = db.prepare("SELECT * FROM marketplace_orders WHERE id=?").get(req.params.id);
    if (!order) return fail(res, 404, "ORDER_NOT_FOUND", "訂單不存在");
    if (order.user_id !== req.user.id) return fail(res, 403, "FORBIDDEN", "只限訂單本人");
    if (order.order_status !== "pending_payment") {
      return res.json({ success: true, order, already: true });
    }
    const s = stripe();
    if (!s) return fail(res, 503, "PAYMENT_NOT_CONFIGURED", "線上付款未配置");
    if (String(order.payment_intent_id || "").startsWith("cs_")) {
      const session = await s.checkout.sessions.retrieve(order.payment_intent_id);
      if (session.payment_status !== "paid") return fail(res, 402, "PAYMENT_NOT_COMPLETED", "付款尚未完成", { status: session.payment_status });
      if (Number(session.amount_total) !== Number(order.total_paid_cents)) return fail(res, 400, "AMOUNT_MISMATCH", "付款金額不符");
      const done = markPaid(db, order.id, session.id);
      try { sendNotification("order.paid", { recipient: order.user_id, data: { order_id: order.id } }); } catch (e) {}
      return res.json({ success: true, order: done.order, commission_earning_id: done.earning_id });
    }
    const pi = await s.paymentIntents.retrieve(order.payment_intent_id);
    if (pi.status !== "succeeded") return fail(res, 402, "PAYMENT_NOT_COMPLETED", "付款尚未完成", { status: pi.status });
    if (Number(pi.amount) !== Number(order.total_paid_cents)) return fail(res, 400, "AMOUNT_MISMATCH", "付款金額不符");

    const done = markPaid(db, order.id, pi.id);
    try { sendNotification("order.paid", { recipient: order.user_id, data: { order_id: order.id } }); } catch (e) {}
    res.json({ success: true, order: done.order, commission_earning_id: done.earning_id });
  } catch (e) {
    console.error("[MARKET] complete:", e.message);
    fail(res, 500, "SERVER_ERROR", "確認付款失敗");
  }
});

// ===== GET /api/marketplace/orders/my =====
router.get("/marketplace/orders/my", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    mk.ensureSchema(db);
    const rows = db.prepare(
      `SELECT o.*, p.title, p.image_url FROM marketplace_orders o JOIN marketplace_products p ON p.id=o.product_id
        WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 50`,
    ).all(req.user.id);
    res.json({ success: true, orders: rows.map((o) => ({ ...o, total_paid: Number(o.total_paid_cents) / 100 })) });
  } catch (e) {
    fail(res, 500, "SERVER_ERROR", "讀取訂單失敗");
  }
});

// ===== 供應商出貨 Webhook（順豐／供應商） =====
router.post("/internal/marketplace/supplier-webhook", (req, res) => {
  try {
    const secret = process.env.MARKETPLACE_WEBHOOK_SECRET || process.env.JWT_SECRET || "";
    const sig = String(req.headers["x-marketplace-signature"] || "");
    const raw = JSON.stringify(req.body || {});
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(403).json({ success: false, code: "SIGNATURE_INVALID", error: "簽章無效" });
    }
    const db = getDb();
    mk.ensureSchema(db);
    const orderId = String(req.body?.order_id || "");
    const status = String(req.body?.status || "");
    if (!["dispatched", "delivered", "refunded"].includes(status)) return fail(res, 400, "STATUS_INVALID", "狀態無效");
    const order = db.prepare("SELECT * FROM marketplace_orders WHERE id=?").get(orderId);
    if (!order) return fail(res, 404, "ORDER_NOT_FOUND", "訂單不存在");
    const ts = status === "dispatched" ? new Date().toISOString() : null;
    db.prepare(
      `UPDATE marketplace_orders SET order_status=?, sf_tracking_no=COALESCE(?,sf_tracking_no), supplier_order_ref=COALESCE(?,supplier_order_ref),
              dispatched_at=COALESCE(dispatched_at,?), delivered_at=?, updated_at=datetime('now') WHERE id=?`,
    ).run(status, req.body?.sf_tracking_no || null, req.body?.supplier_order_ref || null, ts, status === "delivered" ? new Date().toISOString() : null, orderId);
    audit({ actionType: "marketplace.order_" + status, entityType: "marketplace_order", entityId: orderId, userId: null, newValues: { status, tracking: req.body?.sf_tracking_no || null }, description: "供應商出貨回執" });
    res.json({ success: true, status });
  } catch (e) {
    console.error("[MARKET] webhook:", e.message);
    fail(res, 500, "SERVER_ERROR", "Webhook 處理失敗");
  }
});

// ===== Admin：新增／更新商品 =====
router.post("/admin/marketplace/products", authenticateToken, requirePermission("finance.pricing.write"), (req, res) => {
  try {
    const db = getDb();
    mk.ensureSchema(db);
    const b = req.body || {};
    const retail = Math.round(Number(b.retail_price_cents || 0));
    const cost = Math.round(Number(b.cost_price_cents || 0));
    const commission = Math.round(Number(b.coach_commission_cents || 0));
    if (!String(b.title || "").trim()) return fail(res, 400, "TITLE_REQUIRED", "請填商品名稱");
    if (retail <= 0 || cost < 0 || commission < 0) return fail(res, 400, "PRICE_INVALID", "價格必須為正整數 cents");
    if (cost + commission > retail) return fail(res, 400, "MARGIN_NEGATIVE", "供貨價＋教練佣金不可高於零售價");
    const id = b.id || ("prod_" + crypto.randomBytes(6).toString("hex"));
    db.prepare(
      `INSERT OR REPLACE INTO marketplace_products
        (id,supplier_name,sku,title,description,category,recommended_audiences,cost_price_cents,retail_price_cents,coach_commission_cents,platform_margin_cents,image_url,stock_quantity,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, String(b.supplier_name || "ZenPass"), String(b.sku || id), String(b.title), String(b.description || ""), String(b.category || "general"),
      JSON.stringify(b.recommended_audiences || []), cost, retail, commission, retail - cost - commission, String(b.image_url || ""),
      Number(b.stock_quantity ?? 999), b.is_active === false ? 0 : 1);
    audit({ actionType: "marketplace.product_upserted", entityType: "marketplace_product", entityId: id, userId: req.user.id, newValues: { retail, cost, commission, margin: retail - cost - commission }, description: "商品上架／更新" });
    res.status(201).json({ success: true, id, platform_margin_cents: retail - cost - commission });
  } catch (e) {
    console.error("[MARKET] product:", e.message);
    fail(res, 500, "SERVER_ERROR", "商品儲存失敗");
  }
});

module.exports = router;
module.exports.seedProducts = seedProducts;
module.exports.markPaid = markPaid;
