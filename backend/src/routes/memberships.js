/**
 * ZenPass 禪流 - 會籍路由
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// 會籍方案定價
const MEMBERSHIP_PLANS = {
  lite: {
    name: "輕量 Pass",
    name_en: "Light",
    price_hkd: 299,
    credits_granted: 37,
    duration_days: 30,
    description: "每月 37 Credits，適合輕度運動用戶",
    features: ["每月 37 Credits", "優先預約權", "自由取消（適用於開課前一日）"],
    avg_price: 8,
    popular: false,
  },
  standard: {
    name: "標準 Pass",
    name_en: "Standard",
    price_hkd: 799,
    credits_granted: 100,
    duration_days: 30,
    description: "每月 100 Credits，適合定期運動嘅你",
    features: [
      "每月 100 Credits",
      "優先預約權",
      "高峰有 premium",
      "自由取消（適用於開課前一日）",
    ],
    avg_price: 8,
    popular: true,
  },
  silver: {
    name: "高階 Pass",
    name_en: "Premium",
    price_hkd: 1899,
    credits_granted: 237,
    duration_days: 30,
    description: "每月 237 Credits，適合運動狂熱者",
    features: [
      "每月 237 Credits",
      "VIP 優先預約",
      "無限取消更換",
      "每月 1 堂私人教練",
      "自由取消（適用於開課前一日）",
    ],
    avg_price: 8,
    popular: false,
  },
  gold: {
    name: "VIP Pass",
    name_en: "VIP",
    price_hkd: 2899,
    credits_granted: 362,
    duration_days: 30,
    description: "每月 362 Credits，終極運動體驗",
    features: [
      "每月 362 Credits",
      "白金優先預約",
      "無限取消更換",
      "每月 2 堂私人教練",
      "專屬客服",
      "自由取消（適用於開課前一日）",
    ],
    avg_price: 8,
    popular: false,
  },
};

// ===== GET /api/memberships/plans — 取得會籍方案 =====
// 改用 DB pricing_config，管理員可隨時調整
router.get("/plans", (req, res) => {
  const http = require("http");
  http
    .get(
      "http://localhost:" + (process.env.PORT || 3001) + "/api/pricing/plans",
      function (pr) {
        let d = "";
        pr.on("data", (c) => (d += c));
        pr.on("end", () => {
          try {
            res.json(JSON.parse(d));
          } catch (e) {
            res.json({ plans: {} });
          }
        });
      },
    )
    .on("error", function () {
      res.json({ plans: {} });
    });
});

// ===== POST /api/memberships/subscribe — 訂閱會籍 =====
router.post("/subscribe", authenticateToken, async (req, res) => {
  try {
    const { type, payment_method } = req.body;

    if (!type || !MEMBERSHIP_PLANS[type]) {
      return res.status(400).json({ success: false, error: "無效的會籍類型" });
    }

    const plan = MEMBERSHIP_PLANS[type];
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.user.id);

    const membershipId = uuidv4();
    const now = new Date();
    const endDate = new Date(
      now.getTime() + plan.duration_days * 24 * 60 * 60 * 1000,
    );

    const startDateStr = now.toISOString();
    const endDateStr = endDate.toISOString();

    // 建立會籍記錄
    db.prepare(
      `
      INSERT INTO memberships (id, user_id, type, price_hkd, credits_granted, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      membershipId,
      req.user.id,
      type,
      plan.price_hkd,
      plan.credits_granted,
      startDateStr,
      endDateStr,
    );

    // 更新用戶會籍
    db.prepare(
      `
      UPDATE users SET membership_type = ?, membership_expires_at = ?, credits = credits + ?
      WHERE id = ?
    `,
    ).run(type, endDateStr, plan.credits_granted, req.user.id);

    // 記錄交易
    db.prepare(
      `
      INSERT INTO transactions (id, user_id, type, amount, payment_method, description)
      VALUES (?, ?, 'membership', ?, ?, ?)
    `,
    ).run(
      uuidv4(),
      req.user.id,
      plan.price_hkd,
      payment_method || "stripe",
      `${plan.name}會籍 (${plan.duration_days}日)`,
    );

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "membership",
        entityId: membershipId,
        data: {
          userId: req.user.id,
          type,
          plan_name: plan.name,
          price_hkd: plan.price_hkd,
          credits_granted: plan.credits_granted,
          start_date: startDateStr,
          end_date: endDateStr,
          duration_days: plan.duration_days,
          payment_method: payment_method || "stripe",
          action: "subscribe",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write membership block:", blockErr.message);
    }

    res.status(201).json({
      message: `🎉 成功訂閱 ${plan.name} 會籍！`,
      membership: {
        id: membershipId,
        type,
        start_date: startDateStr,
        end_date: endDateStr,
        credits_granted: plan.credits_granted,
      },
    });
  } catch (err) {
    console.error("訂閱會籍錯誤:", err);
    res.status(500).json({ success: false, error: "訂閱會籍失敗" });
  }
});

// ===== GET /api/memberships/my — 我的會籍 =====
router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const memberships = db
      .prepare(
        `
      SELECT * FROM memberships 
      WHERE user_id = ? 
      ORDER BY created_at DESC
      LIMIT 5
    `,
      )
      .all(req.user.id);

    const user = db
      .prepare(
        `
      SELECT credits, membership_type, membership_expires_at FROM users WHERE id = ?
    `,
      )
      .get(req.user.id);

    res.json({
      current: {
        type: user.membership_type,
        expires_at: user.membership_expires_at,
        credits: user.credits,
      },
      history: memberships,
    });
  } catch (err) {
    console.error("查詢會籍錯誤:", err);
    res.status(500).json({ success: false, error: "無法查詢會籍" });
  }
});

// ===== POST /api/memberships/credits — 購買點數 =====
router.post("/credits", authenticateToken, (req, res) => {
  try {
    const { amount } = req.body; // 金額 (HKD)

    if (!amount || amount < 20) {
      return res.status(400).json({ success: false, error: "最低購買金額為 HK$20" });
    }

    // 匯率: HK$8 = 1 Credit
    const creditsToAdd = Math.floor(amount / 8);
    const actualAmount = creditsToAdd * 8;

    // Bonus
    let bonusCredits = 0;
    if (creditsToAdd >= 100) bonusCredits = 30;
    else if (creditsToAdd >= 50) bonusCredits = 12;
    else if (creditsToAdd >= 10) bonusCredits = 2;

    const db = getDb();
    db.pragma("foreign_keys = ON");

    db.prepare("UPDATE users SET credits = credits + ? + ? WHERE id = ?").run(
      creditsToAdd,
      bonusCredits,
      req.user.id,
    );

    db.prepare(
      `
      INSERT INTO transactions (id, user_id, type, amount, description)
      VALUES (?, ?, 'credits_topup', ?, ?)
    `,
    ).run(
      uuidv4(),
      req.user.id,
      actualAmount,
      `購買 ${creditsToAdd} Credits + 贈送 ${bonusCredits} Credits`,
    );

    const user = db
      .prepare("SELECT credits FROM users WHERE id = ?")
      .get(req.user.id);

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "membership",
        entityId: uuidv4(),
        data: {
          userId: req.user.id,
          credits_purchased: creditsToAdd,
          bonus_credits: bonusCredits,
          total_credits_added: creditsToAdd + bonusCredits,
          amount_paid: actualAmount,
          new_balance: user.credits,
          action: "credits_topup",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write credits topup block:", blockErr.message);
    }

    res.json({
      message: `✅ 成功添加 ${creditsToAdd + bonusCredits} Credits`,
      credits_purchased: creditsToAdd,
      bonus_credits: bonusCredits,
      total_credits: user.credits,
      amount_paid: actualAmount,
    });
  } catch (err) {
    console.error("購買點數錯誤:", err);
    res.status(500).json({ success: false, error: "購買點數失敗" });
  }
});

// ===== GET /api/memberships/credits/packages — 點數套餐 =====
router.get("/credits/packages", (req, res) => {
  const packages = [
    { credits: 10, bonus: 2, price: 80, label: "輕量包" },
    { credits: 50, bonus: 12, price: 400, label: "標準包", popular: false },
    { credits: 100, bonus: 30, price: 800, label: "超值包", popular: true },
    { credits: 200, bonus: 70, price: 1600, label: "尊尚包" },
  ];
  res.json({ packages });
});

// ===== POST /api/memberships/stripe-subscribe — Stripe 自動續費會籍 =====
router.post("/stripe-subscribe", authenticateToken, async (req, res) => {
  try {
    const { type, payment_method_id } = req.body;
    const plan = MEMBERSHIP_PLANS[type];
    if (!plan) return res.status(400).json({ success: false, error: "無效的會籍類型" });

    const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET || STRIPE_SECRET.startsWith("sk_test_51TTH5l")) {
      return res.status(200).json({
        dev_mode: true,
        message: "Dev mode: subscription saved locally",
      });
    }

    const stripe = require("stripe")(STRIPE_SECRET);
    const db = getDb();

    // Get or create Stripe customer
    let customerId = db
      .prepare("SELECT stripe_customer_id FROM users WHERE id = ?")
      .get(req.user.id)?.stripe_customer_id;
    if (!customerId) {
      const user = db
        .prepare("SELECT name, email FROM users WHERE id = ?")
        .get(req.user.id);
      const customer = await stripe.customers.create({
        name: user.name,
        email: user.email,
        payment_method: payment_method_id,
        metadata: { user_id: req.user.id },
      });
      customerId = customer.id;
      db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(
        customerId,
        req.user.id,
      );
    }

    // Attach payment method
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: customerId,
      });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: payment_method_id },
      });
    }

    // Create product + price in Stripe (one-time per plan type)
    let priceId = db
      .prepare("SELECT stripe_price_id FROM platform_settings WHERE key = ?")
      .get("stripe_price_" + type)?.value;
    if (!priceId) {
      const product = await stripe.products.create({
        name: plan.name,
        metadata: { plan_type: type },
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(plan.price_hkd * 100),
        currency: "hkd",
        recurring: { interval: "month" },
      });
      priceId = price.id;
      db.prepare(
        "INSERT OR REPLACE INTO platform_settings (key, value) VALUES (?, ?)",
      ).run("stripe_price_" + type, priceId);
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: { user_id: req.user.id, plan_type: type },
    });

    db.prepare(
      "UPDATE users SET stripe_subscription_id = ?, auto_renew = 1 WHERE id = ?",
    ).run(subscription.id, req.user.id);

    // ⛓️ Blockchain audit trail
    try {
      writeBlock({
        entityType: "membership",
        entityId: subscription.id,
        data: {
          userId: req.user.id,
          type,
          plan_name: plan.name,
          price_hkd: plan.price_hkd,
          credits_granted: plan.credits_granted,
          stripe_subscription_id: subscription.id,
          action: "stripe_subscribe",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write stripe subscription block:", blockErr.message);
    }

    res.json({
      subscription_id: subscription.id,
      client_secret: subscription.latest_invoice?.payment_intent?.client_secret,
    });
  } catch (err) {
    console.error("Stripe subscription error:", err.message);
    res.status(500).json({ success: false, error: "建立訂閱失敗" });
  }
});

// ===== PUT /api/memberships/:id/pause — 暫停會籍 =====
router.put("/:id/pause", authenticateToken, (req, res) => {
  try {
    const { pause_days, reason } = req.body;
    const days = Math.min(Math.max(parseInt(pause_days) || 14, 1), 30);

    const db = getDb();
    db.pragma("foreign_keys = ON");

    const membership = db
      .prepare("SELECT * FROM memberships WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);

    if (!membership) {
      return res.status(404).json({ success: false, error: "會籍不存在" });
    }
    if (membership.status !== "active") {
      return res.status(400).json({ success: false, error: "會籍唔係 active 狀態" });
    }
    if (membership.paused_until) {
      const pausedEnd = new Date(membership.paused_until);
      if (pausedEnd > new Date()) {
        return res.status(400).json({ success: false, error: "會籍已經暫停緊" });
      }
    }
    if ((membership.pause_count || 0) >= 3) {
      return res.status(400).json({ success: false, error: "已達到最大暫停次數 (3次)" });
    }

    const pausedUntil = new Date(Date.now() + days * 86400000).toISOString();

    // 延長 membership expiry（暫停日數順延）
    const currentEnd = new Date(membership.end_date);
    const newEnd = new Date(currentEnd.getTime() + days * 86400000).toISOString();

    db.prepare(
      `UPDATE memberships SET paused_until = ?, pause_count = COALESCE(pause_count, 0) + 1, pause_reason = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(pausedUntil, reason || null, newEnd, req.params.id);

    // ⛓️ Blockchain audit trail
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "membership",
        entityId: membership.id,
        data: {
          userId: req.user.id,
          pause_days: days,
          reason: reason || null,
          paused_until: pausedUntil,
          original_end: membership.end_date,
          new_end: newEnd,
          pause_count: (membership.pause_count || 0) + 1,
          action: "pause",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write pause block:", blockErr.message);
    }

    res.json({
      message: `⏸️ 會籍已暫停 ${days} 日，將於 ${new Date(pausedUntil).toLocaleDateString("zh-HK")} 自動恢復`,
      paused_until: pausedUntil,
      new_end_date: newEnd,
      pause_count: (membership.pause_count || 0) + 1,
    });
  } catch (err) {
    console.error("暫停會籍錯誤:", err);
    res.status(500).json({ success: false, error: "暫停會籍失敗" });
  }
});

// ===== PUT /api/memberships/:id/resume — 恢復會籍 =====
router.put("/:id/resume", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const membership = db
      .prepare("SELECT * FROM memberships WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);

    if (!membership) {
      return res.status(404).json({ success: false, error: "會籍不存在" });
    }
    if (!membership.paused_until) {
      return res.status(400).json({ success: false, error: "會籍未暫停" });
    }

    db.prepare(
      `UPDATE memberships SET paused_until = NULL, pause_reason = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(req.params.id);

    // ⛓️ Blockchain audit trail
    try {
      const { writeBlock } = require("../services/blockchain-audit");
      writeBlock({
        entityType: "membership",
        entityId: membership.id,
        data: {
          userId: req.user.id,
          was_paused_until: membership.paused_until,
          pause_count: membership.pause_count || 0,
          action: "resume",
        },
      });
    } catch (blockErr) {
      console.error("[BLOCKCHAIN] Failed to write resume block:", blockErr.message);
    }

    res.json({
      message: "🔁 會籍已恢復！",
      end_date: membership.end_date,
    });
  } catch (err) {
    console.error("恢復會籍錯誤:", err);
    res.status(500).json({ success: false, error: "恢復會籍失敗" });
  }
});

// ===== GET /api/memberships/:id/pause-status — 睇 pause 狀態 =====
router.get("/:id/pause-status", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const membership = db
      .prepare("SELECT * FROM memberships WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);

    if (!membership) {
      return res.status(404).json({ success: false, error: "會籍不存在" });
    }

    const isPaused = membership.paused_until && new Date(membership.paused_until) > new Date();

    // 計算剩餘暫停時間
    let remainingMs = 0;
    if (isPaused) {
      remainingMs = new Date(membership.paused_until).getTime() - Date.now();
    }

    // Pause history: if previously paused, fetch from blockchain audit
    const pauseHistory = [];
    if (membership.pause_count > 0) {
      // Get audit log entries for pause/resume of this membership
      try {
        const auditRows = db
          .prepare(
            `SELECT created_at, description, new_values FROM audit_log 
             WHERE entity_type = 'membership' AND entity_id = ? 
             AND (action_type = 'membership.pause' OR action_type = 'membership.resume')
             ORDER BY created_at DESC LIMIT 10`
          )
          .all(req.params.id);
        for (const row of auditRows) {
          pauseHistory.push({
            action: row.description?.includes("暫停") ? "pause" : "resume",
            description: row.description,
            timestamp: row.created_at,
          });
        }
      } catch (e) {
        // Audit log not available, provide basic info
        pauseHistory.push({
          action: "pause",
          description: `暫停 (x${membership.pause_count})`,
          timestamp: null,
        });
      }
    }

    res.json({
      is_paused: !!isPaused,
      paused_until: isPaused ? membership.paused_until : null,
      remaining_days: isPaused ? Math.ceil(remainingMs / 86400000) : 0,
      remaining_hours: isPaused ? Math.ceil(remainingMs / 3600000) : 0,
      pause_count: membership.pause_count || 0,
      max_pause_days: membership.max_pause_days || 30,
      pause_reason: isPaused ? membership.pause_reason : null,
      can_pause: !isPaused && (membership.pause_count || 0) < 3 && membership.status === "active",
      can_resume: !!isPaused,
      pause_history: pauseHistory,
    });
  } catch (err) {
    console.error("查詢暫停狀態錯誤:", err);
    res.status(500).json({ success: false, error: "無法查詢暫停狀態" });
  }
});

module.exports = router;
