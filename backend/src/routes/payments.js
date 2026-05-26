/**
 * ZenPass 禪流 - 付款路由
 * Stripe Checkout / 轉數快 / PayMe
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");
const { validate, schemas } = require("../middleware/validate");

const fs = require("fs");
const path = require("path");
const { audit, trackPaymentChange } = require("../services/audit");
const { sendTelegramAlert } = require("../services/notification");
const {
  recordPayment,
  recordRefund,
  recordCommission,
  recordPayout,
} = require("../services/accounting");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";
const UPLOAD_DIR = path.join(__dirname, "../../uploads");

// ===== POST /api/payments/upload-receipt — 上傳收據圖片 (壓縮 + 永久儲存) =====
router.post("/upload-receipt", authenticateToken, (req, res) => {
  try {
    const { image } = req.body; // base64 data URL

    if (!image || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "請提供有效嘅圖片" });
    }

    // Decode base64
    const matches = image.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "圖片格式無效" });
    }

    const ext = matches[1] === "png" ? "png" : "jpg";
    const buffer = Buffer.from(matches[2], "base64");

    // Size limit: max 2MB after decode
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: "圖片太大，請上載 2MB 以下嘅圖片" });
    }

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Save with unique filename (YYYY/MM/uuid.ext)
    const now = new Date();
    const datePath =
      now.getFullYear() + "/" + String(now.getMonth() + 1).padStart(2, "0");
    const dirPath = path.join(UPLOAD_DIR, datePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const filename = uuidv4() + "." + ext;
    fs.writeFileSync(path.join(dirPath, filename), buffer);

    const url = "/uploads/" + datePath + "/" + filename;

    res.json({
      message: "圖片已上載",
      url: url,
      size_kb: Math.round(buffer.length / 1024),
    });
  } catch (err) {
    console.error("上載圖片錯誤:", err);
    res.status(500).json({ error: "上載圖片失敗" });
  }
});

// ===== Stripe 香港收費標準 (2026) =====
const STRIPE_HK_FEES = {
  domestic_cards: { percentage: 3.4, fixed_hkd: 2.35, label: "香港發行信用卡" },
  international_cards: {
    percentage: 3.9,
    fixed_hkd: 2.35,
    label: "國際信用卡",
  },
  alipay_wechat: {
    percentage: 2.2,
    fixed_hkd: 2.0,
    label: "Alipay/WeChat Pay",
  },
  dispute_fee: { fixed_hkd: 85.0, label: "爭議處理費" },
};

/**
 * 計算 Stripe 手續費
 * @param {number} amount - 交易金額 (HKD)
 * @param {string} cardType - 'domestic' | 'international'
 * @returns {{ fee: number, net: number, breakdown: object }}
 */
function calculateStripeFee(amount, cardType = "domestic") {
  const rate =
    cardType === "international"
      ? STRIPE_HK_FEES.international_cards
      : STRIPE_HK_FEES.domestic_cards;

  const percentageFee = amount * (rate.percentage / 100);
  const totalFee = percentageFee + rate.fixed_hkd;

  return {
    fee: Math.round(totalFee * 100) / 100,
    net: Math.round((amount - totalFee) * 100) / 100,
    percentage: rate.percentage,
    fixed: rate.fixed_hkd,
    breakdown: {
      percentage: Math.round(percentageFee * 100) / 100,
      fixed: rate.fixed_hkd,
    },
  };
}

// ===== Stripe SDK (lazy init — 只喺有 key 時先初始化) =====
let stripe = null;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function getStripe() {
  if (
    !stripe &&
    STRIPE_SECRET &&
    STRIPE_SECRET !== "sk_test_xxxxxxxxxxxxxxxxxxxx"
  ) {
    stripe = require("stripe")(STRIPE_SECRET);
    console.log("💳 Stripe SDK initialized");
  }
  return stripe;
}

// ===== 前端 URL（用於 Checkout redirect）=====
const FRONTEND_URL = process.env.CORS_ORIGIN || "http://localhost:3001";

// ===== GET /api/payments/stripe/fees — 查詢 Stripe HK 手續費 =====
router.get("/stripe/fees", (req, res) => {
  const amount = parseFloat(req.query.amount) || 0;

  const domesticFee =
    amount > 0 ? calculateStripeFee(amount, "domestic") : null;
  const intlFee =
    amount > 0 ? calculateStripeFee(amount, "international") : null;

  res.json({
    currency: "HKD",
    region: "Hong Kong",
    standard_rates: STRIPE_HK_FEES,
    calculation:
      amount > 0
        ? {
            amount,
            domestic: domesticFee,
            international: intlFee,
          }
        : null,
    notice: "Stripe 手續費已包含在付款金額中，商戶實收金額已扣除相關費用。",
  });
});

// ===== POST /api/payments/stripe/create-checkout — 建立 Stripe Checkout Session =====
router.post("/stripe/create-checkout", authenticateToken, async (req, res) => {
  try {
    const { amount, booking_id, description, success_path, cancel_path } =
      req.body;

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "無效金額" });
    }

    // 預先計算手續費
    const feeInfo = calculateStripeFee(amount, "domestic");

    // 如果沒 Stripe key，fallback 去開發模式
    if (!getStripe()) {
      console.log("⚠️ Stripe not configured, using dev fallback");
      const fakeSession = {
        id: "cs_dev_" + uuidv4().slice(0, 8),
        url: null,
      };
      const intentId = "pi_dev_" + uuidv4().slice(0, 8);
      return res.json({
        checkout_url: null,
        session_id: fakeSession.id,
        dev_mode: true,
        dev_intent_id: intentId,
        amount,
        fee: feeInfo,
        message: "Stripe 未設定，開發模式：直接 confirm 即可",
      });
    }

    // 建立 Stripe Checkout Session
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "hkd",
            product_data: {
              name: description || "ZenPass 課程預約",
              description: `HK$${amount} — 已包含 Stripe 手續費 HK$${feeInfo.fee}`,
            },
            unit_amount: Math.round(amount * 100), // HKD 轉 cent
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: booking_id || "",
        user_id: req.user.id,
        gross_amount: String(amount),
        stripe_fee: String(feeInfo.fee),
        net_amount: String(feeInfo.net),
      },
      success_url: `${FRONTEND_URL}/payment.html?stripe=success&session_id={CHECKOUT_SESSION_ID}&booking_id=${booking_id || ""}`,
      cancel_url: `${FRONTEND_URL}/payment.html?stripe=cancel&booking_id=${booking_id || ""}`,
    });

    res.json({
      checkout_url: session.url,
      session_id: session.id,
      dev_mode: false,
      amount,
      fee: feeInfo,
    });
  } catch (err) {
    console.error("Stripe Checkout 錯誤:", err);
    res.status(500).json({ error: "無法建立付款頁面" });
  }
});

// ===== POST /api/payments/stripe/confirm-payment — 確認 Stripe 付款 (Checkout 完成後 call) =====
router.post("/stripe/confirm-payment", authenticateToken, async (req, res) => {
  try {
    const { session_id, booking_id } = req.body;

    // 如果開發模式，模擬成功
    if (!getStripe()) {
      // Dev mode: mark as paid
      return await completeStripePayment(
        req,
        res,
        booking_id,
        "pi_dev_" + uuidv4().slice(0, 8),
      );
    }

    // 正式：檢查 Stripe Session 狀態
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id);

      if (session.payment_status !== "paid") {
        return res.status(400).json({ error: "付款尚未完成" });
      }

      const paymentIntentId = session.payment_intent;
      return await completeStripePayment(req, res, booking_id, paymentIntentId);
    } catch (stripeErr) {
      console.error("Stripe session retrieval error:", stripeErr);
      return res.status(500).json({ error: "無法確認付款狀態" });
    }
  } catch (err) {
    console.error("確認付款錯誤:", err);
    res.status(500).json({ error: "確認付款失敗" });
  }
});

// ===== Helper: 完成 Stripe 付款 (更新 booking + transaction) =====
async function completeStripePayment(req, res, booking_id, paymentIntentId) {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    if (booking_id) {
      const booking = db
        .prepare("SELECT status, schedule_id FROM bookings WHERE id = ?")
        .get(booking_id);
      if (booking && booking.status === "pending_payment") {
        db.prepare(
          `
          UPDATE bookings SET status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = ?
          WHERE id = ?
        `,
        ).run(paymentIntentId, booking_id);

        // Auto-calculate coach earnings
        if (booking.schedule_id) {
          try {
            const {
              syncCoachEarningsForSchedule,
            } = require("./coach-earnings");
            syncCoachEarningsForSchedule(booking.schedule_id);
          } catch (e) {
            console.error("auto coach earnings:", e.message);
          }
        }
      } else {
        db.prepare(
          `
          UPDATE bookings SET payment_status = 'paid', stripe_payment_intent_id = ?
          WHERE id = ?
        `,
        ).run(paymentIntentId, booking_id);
      }
    }

    // 記錄交易
    db.prepare(
      `
      INSERT INTO transactions (id, user_id, type, amount, payment_method, stripe_payment_intent_id, status)
      VALUES (?, ?, 'single_booking', ?, 'stripe', ?, 'completed')
    `,
    ).run(uuidv4(), req.user.id, req.body.amount || 0, paymentIntentId);

    db.close();

    res.json({
      message: "💳 信用卡付款成功！",
      booking_id,
      status: "confirmed",
      payment_status: "paid",
    });
  } catch (err) {
    console.error("Stripe 完成付款錯誤:", err);
    res.status(500).json({ error: "付款確認失敗" });
  }
}

// ===== POST /api/payments/stripe/webhook — Stripe Webhook =====
router.post("/stripe/webhook", async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];

    if (
      !getStripe() ||
      !STRIPE_WEBHOOK_SECRET ||
      STRIPE_WEBHOOK_SECRET === "whsec_xxxxxxxxxxxxxxxxxxxx"
    ) {
      return res
        .status(200)
        .json({ received: true, note: "Webhook not configured" });
    }

    let event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 處理 checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const booking_id = session.metadata?.booking_id;
      const paymentIntentId = session.payment_intent;

      if (booking_id) {
        const db = new Database(DB_PATH);
        db.pragma("foreign_keys = ON");

        const booking = db
          .prepare("SELECT status, schedule_id FROM bookings WHERE id = ?")
          .get(booking_id);
        if (booking && booking.status === "pending_payment") {
          db.prepare(
            `
            UPDATE bookings SET status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = ?
            WHERE id = ?
          `,
          ).run(paymentIntentId, booking_id);

          // Auto-calculate coach earnings
          if (booking.schedule_id) {
            try {
              const {
                syncCoachEarningsForSchedule,
              } = require("./coach-earnings");
              syncCoachEarningsForSchedule(booking.schedule_id);
            } catch (e) {
              console.error("auto coach earnings:", e.message);
            }
          }
        }

        db.prepare(
          `
          INSERT INTO transactions (id, user_id, type, amount, payment_method, stripe_payment_intent_id, status)
          VALUES (?, ?, 'single_booking', ?, 'stripe', ?, 'completed')
        `,
        ).run(
          uuidv4(),
          session.metadata.user_id || "",
          session.amount_total / 100,
          paymentIntentId,
        );

        // Send notification
        try {
          const notifData = {
            user_id: session.metadata.user_id || booking.user_id,
            booking_id: booking_id,
            class_name: session.metadata.class_name || "課程",
            amount: session.amount_total / 100,
            coach_name: session.metadata.coach_name || "",
            schedule_time: session.metadata.schedule_time || "",
          };
          sendNotification("payment.approved", notifData);
        } catch (e) {
          console.error("Webhook notification error:", e.message);
        }

        db.close();
        console.log(
          "✅ Webhook: Booking",
          booking_id,
          "payment confirmed via Stripe",
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Webhook error" });
  }
});

// ===== POST /api/payments/fps — 轉數快付款 (需 Admin 確認) =====
router.post("/fps", authenticateToken, (req, res) => {
  try {
    const { amount, booking_id, fps_reference, receipt_image } = req.body;

    if (!fps_reference) {
      return res.status(400).json({ error: "請提供轉數快參考編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 檢查 booking 存在
    const booking = booking_id
      ? db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking_id)
      : null;
    if (booking_id && !booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在" });
    }

    // 儲存 FPS 資料，保持 pending_payment，等 Admin 核實
    if (booking_id) {
      db.prepare(
        `
        UPDATE bookings SET fps_reference = ?, amount = ?, payment_method = 'fps', receipt_image = ?,
          status = 'pending_payment', payment_status = 'pending'
        WHERE id = ?
      `,
      ).run(
        fps_reference,
        amount || booking.amount || 0,
        receipt_image || null,
        booking_id,
      );
    }

    // 記錄交易 (pending 狀態)
    db.prepare(
      `
      INSERT INTO transactions (id, user_id, type, amount, payment_method, fps_reference, status, description)
      VALUES (?, ?, 'single_booking', ?, 'fps', ?, 'pending', 'FPS 付款 — 待管理員確認')
    `,
    ).run(
      uuidv4(),
      req.user.id,
      amount || (booking ? booking.amount : 0),
      fps_reference,
    );

    // 🔔 AUDIT：FPS 付款（待確認）
    try {
      trackPaymentChange(
        booking_id,
        req.user.id,
        "pending",
        "pending",
        amount || (booking ? booking.amount : 0),
        "fps",
        req
      );
    } catch (auditErr) {
      console.error("⚠️ Audit record failed:", auditErr.message);
    }

    // 🔔 ADMIN TELEGRAM：通知管理員有新 FPS 付款待確認
    setTimeout(() => {
      const classTitle = booking ? (booking.title || "") : "";
      sendTelegramAlert(
        `🆕 <b>新 FPS 付款待確認</b>\n` +
        `👤 用戶：${req.user.name || req.user.email || req.user.id}\n` +
        `💰 金額：HK$${amount || (booking ? booking.amount : 0)}\n` +
        `📎 參考：${fps_reference}\n` +
        `📚 課程：${classTitle || "—"}\n` +
        `🆔 Booking：${booking_id || "—"}\n` +
        `⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`
      );
    }, 0);

    db.close();

    res.json({
      message: "✅ FPS 付款資料已提交，等待管理員確認",
      status: "pending_payment",
      payment_status: "pending",
      requires_admin_approval: true,
      fps_info: {
        phone: "9033 5538",
        email: "info@zenpass.hk",
        bank: "HSBC",
      },
    });
  } catch (err) {
    console.error("轉數快付款錯誤:", err);
    res.status(500).json({ error: "轉數快付款失敗" });
  }
});

// ===== POST /api/payments/payme — PayMe 付款 (需 Admin 確認) =====
router.post("/payme", authenticateToken, (req, res) => {
  try {
    const { amount, booking_id, payme_reference, receipt_image } = req.body;

    if (!payme_reference) {
      return res.status(400).json({ error: "請提供 PayMe 參考編號" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const booking = booking_id
      ? db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking_id)
      : null;
    if (booking_id && !booking) {
      db.close();
      return res.status(404).json({ error: "預約不存在" });
    }

    // 儲存 PayMe 資料，保持 pending_payment，等 Admin 核實
    if (booking_id) {
      db.prepare(
        `
        UPDATE bookings SET payme_reference = ?, amount = ?, payment_method = 'payme', receipt_image = ?,
          status = 'pending_payment', payment_status = 'pending'
        WHERE id = ?
      `,
      ).run(
        payme_reference,
        amount || booking.amount || 0,
        receipt_image || null,
        booking_id,
      );
    }

    db.prepare(
      `
      INSERT INTO transactions (id, user_id, type, amount, payment_method, payme_reference, status, description)
      VALUES (?, ?, 'single_booking', ?, 'payme', ?, 'pending', 'PayMe 付款 — 待管理員確認')
    `,
    ).run(
      uuidv4(),
      req.user.id,
      amount || (booking ? booking.amount : 0),
      payme_reference,
    );

    // 🔔 ADMIN TELEGRAM：通知管理員有新 PayMe 付款待確認
    setTimeout(() => {
      const classTitle = booking ? (booking.title || "") : "";
      sendTelegramAlert(
        `🆕 <b>新 PayMe 付款待確認</b>\n` +
        `👤 用戶：${req.user.name || req.user.email || req.user.id}\n` +
        `💰 金額：HK$${amount || (booking ? booking.amount : 0)}\n` +
        `📎 參考：${payme_reference}\n` +
        `📚 課程：${classTitle || "—"}\n` +
        `🆔 Booking：${booking_id || "—"}\n` +
        `⏰ ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}`
      );
    }, 0);

    db.close();

    res.json({
      message: "✅ PayMe 付款資料已提交，等待管理員確認",
      status: "pending_payment",
      payment_status: "pending",
      requires_admin_approval: true,
      payme_info: {
        phone: "9492 5828",
        note: "ZenPass 課程",
      },
    });
  } catch (err) {
    console.error("PayMe 付款錯誤:", err);
    res.status(500).json({ error: "PayMe 付款失敗" });
  }
});

// ===== GET /api/payments/gateways — 付款方式列表 (含手續費資訊) =====
router.get("/gateways", (req, res) => {
  const amount = parseFloat(req.query.amount) || 0;
  const stripeFee = amount > 0 ? calculateStripeFee(amount, "domestic") : null;

  res.json({
    currency: "HKD",
    gateways: [
      {
        id: "stripe",
        name: "信用卡 (Stripe)",
        icon: "💳",
        description: "Visa / Mastercard / AE",
        enabled: true,
        fee_info: {
          rate:
            STRIPE_HK_FEES.domestic_cards.percentage +
            "% + HK$" +
            STRIPE_HK_FEES.domestic_cards.fixed_hkd,
          label: "香港發行卡：3.4% + HK$2.35",
          international_rate:
            STRIPE_HK_FEES.international_cards.percentage +
            "% + HK$" +
            STRIPE_HK_FEES.international_cards.fixed_hkd,
          note: "國際信用卡或附加 0.5%",
        },
        estimated_fee: stripeFee
          ? {
              amount: stripeFee.fee,
              net: stripeFee.net,
              breakdown: stripeFee.breakdown,
            }
          : null,
      },
      {
        id: "fps",
        name: "轉數快 FPS",
        icon: "🏦",
        description: "FPS 即時轉帳 · 零手續費",
        fee_info: { fee: 0, label: "免手續費" },
        account: "9033 5538 (HSBC)",
        enabled: true,
      },
      {
        id: "payme",
        name: "PayMe",
        icon: "💚",
        description: "PayMe 掃碼付款 · 零手續費",
        fee_info: { fee: 0, label: "免手續費" },
        account: "9492 5828",
        enabled: true,
      },
    ],
  });
});

// ===== 1.3 POST /api/payments/create-payment-intent — Stripe Payment Intent API =====
// 比前端用 Stripe Elements 直接 confirm payment，唔經 Checkout redirect
router.post("/create-payment-intent", authenticateToken, async (req, res) => {
  try {
    const { amount, booking_id, description } = req.body;

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "無效金額" });
    }

    // 如果沒 Stripe key，fallback 做本地 mock（FPS/PayMe QR）
    if (!getStripe()) {
      console.log("⚠️ Stripe not configured for PaymentIntent, returning mock");
      return res.json({
        client_secret: null,
        dev_mode: true,
        amount,
        booking_id: booking_id || null,
        message: "Stripe 未設定，請使用 FPS 或 PayMe 付款",
      });
    }

    // 建立 Payment Intent (HKD cent)
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "hkd",
      description: description || "ZenPass 課程預約",
      metadata: {
        booking_id: booking_id || "",
        user_id: req.user.id,
      },
      // Stripe.js 需要 client_secret 去 confirm payment
    });

    res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount,
      currency: "hkd",
      dev_mode: false,
    });
  } catch (err) {
    console.error("❌ Create PaymentIntent error:", err);
    res.status(500).json({ error: "無法建立付款" });
  }
});

// ===== 1.2 POST /api/payments/confirm — 確認付款（FPS / PayMe / Stripe）=====
// 通用確認 endpoint：將 pending_payment booking 轉爲 confirmed
router.post("/confirm", authenticateToken, validate(schemas.payment_confirm), (req, res) => {
  try {
    const { booking_id, payment_method, payment_reference, amount } = req.body;

    if (!booking_id || !payment_method) {
      return res
        .status(400)
        .json({ error: "缺少必要資料（booking_id, payment_method）" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 檢查 booking 係咪屬於呢個 user 且係 pending_payment
    const booking = db
      .prepare(
        `
      SELECT b.*, c.title as class_title, cs.start_time, cs.end_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.id = ? AND b.user_id = ? AND b.status = 'pending_payment'
    `,
      )
      .get(booking_id, req.user.id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: "未找到待付款的預約或預約已取消" });
    }

    // 根據付款方式決定是否需要管理員確認
    // Stripe — 即時確認（Stripe 已驗證付款）
    // FPS / PayMe — 停留 pending_payment，等待管理員確認
    const isAdminApprovalRequired = payment_method === "fps" || payment_method === "payme";

    let updateFields = [];
    let updateParams = [];

    if (isAdminApprovalRequired) {
      // FPS/PayMe: 儲存參考編號，保持 pending，等 admin 確認
      updateFields = ["status = 'pending_payment'", "payment_status = 'pending'"];
    } else {
      // Stripe: 即時確認
      updateFields = ["status = 'confirmed'", "payment_status = 'paid'"];
    }

    if (payment_method === "stripe" && payment_reference) {
      updateFields.push("stripe_payment_intent_id = ?");
      updateParams.push(payment_reference);
    } else if (payment_method === "fps" && payment_reference) {
      updateFields.push("fps_reference = ?");
      updateParams.push(payment_reference);
    } else if (payment_method === "payme" && payment_reference) {
      updateFields.push("payme_reference = ?");
      updateParams.push(payment_reference);
    }

    // 如果有傳入 amount 就更新
    if (amount) {
      updateFields.push("amount = ?");
      updateParams.push(amount);
    }

    // 記錄付款方式
    updateFields.push("payment_method = ?");
    updateParams.push(payment_method);

    updateParams.push(booking_id);
    db.prepare(
      `UPDATE bookings SET ${updateFields.join(", ")} WHERE id = ?`,
    ).run(...updateParams);

    // Auto-calculate coach earnings
    if (booking.schedule_id) {
      try {
        const { syncCoachEarningsForSchedule } = require("./coach-earnings");
        syncCoachEarningsForSchedule(booking.schedule_id);
      } catch (e) {
        console.error("auto coach earnings:", e.message);
      }
    }

    // 更新 enrolled_count（pending_payment 時已經 +1，但爲咗 consistent）
    // 留意：create booking 時已經加咗 enrolled_count，所以唔使再加
    // 但爲咗確保數值正確，重新 sync
    const schedule = db
      .prepare("SELECT * FROM class_schedules WHERE id = ?")
      .get(booking.schedule_id);
    const confirmedCount = db
      .prepare(
        `
      SELECT COUNT(*) as cnt FROM bookings WHERE schedule_id = ? AND status = 'confirmed'
    `,
      )
      .get(booking.schedule_id);
    if (schedule && confirmedCount) {
      db.prepare(
        "UPDATE class_schedules SET enrolled_count = ? WHERE id = ?",
      ).run(confirmedCount.cnt, booking.schedule_id);
    }

    // 記錄交易
    const txId = require("../services/refgen").genRef("TX");
    db.prepare(
      `
      INSERT INTO transactions (id, user_id, type, amount, payment_method, ${payment_method === "stripe" ? "stripe_payment_intent_id" : payment_method === "fps" ? "fps_reference" : "payme_reference"}, status)
      VALUES (?, ?, 'single_booking', ?, ?, ?, 'completed')
    `,
    ).run(
      txId,
      req.user.id,
      amount || booking.amount || 0,
      payment_method,
      payment_reference || null,
    );

    // 🔔 通知：預約確認（付款完成）
    try {
      const notif = require("./notifications");
      // send in-app notification
    } catch (notifErr) {
      // ignore
    }

    // 用 setTimeout fire-and-forget 發通知唔阻住 response
    setTimeout(() => {
      try {
        const { sendNotification } = require("../services/notification");
        sendNotification("booking.confirmed", {
          recipient: req.user.id,
          data: {
            class_title: booking.class_title || "—",
            date: booking.start_time ? booking.start_time.split("T")[0] : "—",
            time: booking.start_time
              ? booking.start_time.split("T")[1]?.slice(0, 5)
              : "—",
            venue: "—",
            coach_name: "—",
          },
        });
      } catch (e) {}
    }, 0);

    db.close();

    if (isAdminApprovalRequired) {
      res.json({
        message: "✅ 付款資料已提交，等待管理員確認",
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        status: "pending_payment",
        payment_status: "pending",
        requires_admin_approval: true,
      });
    } else {
      res.json({
        message: "付款成功，預約已確認！",
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        status: "confirmed",
        payment_status: "paid",
      });
    }
  } catch (err) {
    console.error("❌ 確認付款錯誤:", err);
    res.status(500).json({ error: "確認付款失敗" });
  }
});


// ===== POST /api/payments/setup-intent — 建立 SetupIntent（儲存信用卡）=====
router.post("/setup-intent", authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.json({ dev_mode: true, client_secret: null, message: "Stripe 未設定" });
    }

    // Find or create Stripe customer
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    const user = db.prepare("SELECT id, email, name, stripe_customer_id FROM users WHERE id = ?").get(req.user.id);
    db.close();

    let customerId = user?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user?.email,
        name: user?.name,
        metadata: { user_id: req.user.id },
      });
      customerId = customer.id;
      const db2 = new Database(DB_PATH);
      db2.pragma("foreign_keys = ON");
      db2.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, req.user.id);
      db2.close();
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    });

    res.json({ client_secret: setupIntent.client_secret, dev_mode: false });
  } catch (err) {
    console.error("SetupIntent error:", err);
    res.status(500).json({ error: "無法建立付款設定" });
  }
});

// ===== POST /api/payments/save-payment-method — 儲存付款方式 =====
router.post("/save-payment-method", authenticateToken, async (req, res) => {
  try {
    const { payment_method_id } = req.body;
    if (!payment_method_id) return res.status(400).json({ error: "缺少付款方式" });

    const stripe = getStripe();
    if (!stripe) return res.json({ dev_mode: true, message: "Dev mode: payment method saved" });

    // Attach to customer
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    const user = db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(req.user.id);
    db.close();

    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: "請先建立付款設定" });
    }

    const paymentMethod = await stripe.paymentMethods.attach(payment_method_id, {
      customer: user.stripe_customer_id,
    });

    // Set as default
    await stripe.customers.update(user.stripe_customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });

    res.json({ message: "✅ 付款方式已儲存", card: paymentMethod.card?.last4 });
  } catch (err) {
    console.error("Save payment method error:", err);
    res.status(500).json({ error: "無法儲存付款方式" });
  }
});

// ===== POST /api/payments/create-subscription — 建立會籍自動扣款 =====
router.post("/create-subscription", authenticateToken, async (req, res) => {
  try {
    const { plan_id, price } = req.body;
    if (!plan_id || !price) return res.status(400).json({ error: "缺少會籍資料" });

    const stripe = getStripe();
    if (!stripe || !plan_id.startsWith("price_")) {
      // Dev mode - just update the user record
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");
      db.prepare("UPDATE users SET membership_type = ?, membership_expires_at = ? WHERE id = ?")
        .run(plan_id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), req.user.id);
      db.close();
      return res.json({ dev_mode: true, message: "Dev mode: subscription created" });
    }

    // Get or create customer
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    const user = db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(req.user.id);
    db.close();

    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: "請先儲存付款方式" });
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: user.stripe_customer_id,
      items: [{ price: plan_id }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });

    res.json({
      subscription_id: subscription.id,
      client_secret: subscription.latest_invoice?.payment_intent?.client_secret,
      status: subscription.status,
    });
  } catch (err) {
    console.error("Create subscription error:", err);
    res.status(500).json({ error: "無法建立會籍" });
  }
});

// ===== POST /api/payments/cancel-subscription — 取消自動扣款 =====
router.post("/cancel-subscription", authenticateToken, async (req, res) => {
  try {
    const { subscription_id } = req.body;

    const stripe = getStripe();
    if (!stripe) {
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");
      db.prepare("UPDATE users SET membership_type = 'none', membership_expires_at = NULL WHERE id = ?")
        .run(req.user.id);
      db.close();
      return res.json({ dev_mode: true, message: "會籍已取消" });
    }

    await stripe.subscriptions.cancel(subscription_id);

    res.json({ message: "✅ 會籍已取消" });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    res.status(500).json({ error: "無法取消會籍" });
  }
});

// ===== Credits Purchase =====
router.post("/credits/purchase", authenticateToken, async (req, res) => {
  try {
    const { credits, amount, payment_method, payment_reference } = req.body;
    if (!credits || !amount || !payment_method) {
      return res.status(400).json({ error: "缺少必要資料" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 加點數
    db.prepare("UPDATE users SET credits = credits + ? WHERE id = ?")
      .run(credits, req.user.id);

    // 記錄交易
    const txnId = uuidv4();
    db.prepare(
      `INSERT INTO transactions (id, user_id, type, amount, payment_method, description, status, created_at)
       VALUES (?, ?, 'credits_topup', ?, ?, ?, 'completed', datetime('now'))`
    ).run(txnId, req.user.id, amount, payment_method, `購買 ${credits} Credits`);

    db.close();

    res.json({
      success: true,
      message: `✅ 成功加購 ${credits} Credits`,
      credits_added: credits,
      transaction_id: txnId,
    });
  } catch (err) {
    console.error("Credits purchase error:", err);
    res.status(500).json({ error: "加購點數失敗" });
  }
});

module.exports = router;
