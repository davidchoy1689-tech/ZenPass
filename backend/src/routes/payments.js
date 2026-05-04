/**
 * ZenPass 禪流 - 付款路由
 * Stripe Checkout / 轉數快 / PayMe
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const { authenticateToken } = require('../middleware/auth');

const fs = require('fs');
const path = require('path');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || './data/zenpass.db';
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// ===== POST /api/payments/upload-receipt — 上傳收據圖片 (壓縮 + 永久儲存) =====
router.post('/upload-receipt', authenticateToken, (req, res) => {
  try {
    const { image } = req.body;  // base64 data URL

    if (!image || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: '請提供有效嘅圖片' });
    }

    // Decode base64
    const matches = image.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: '圖片格式無效' });
    }

    const ext = matches[1] === 'png' ? 'png' : 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');

    // Size limit: max 2MB after decode
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: '圖片太大，請上載 2MB 以下嘅圖片' });
    }

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Save with unique filename (YYYY/MM/uuid.ext)
    const now = new Date();
    const datePath = now.getFullYear() + '/' + String(now.getMonth()+1).padStart(2,'0');
    const dirPath = path.join(UPLOAD_DIR, datePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const filename = uuidv4() + '.' + ext;
    fs.writeFileSync(path.join(dirPath, filename), buffer);

    const url = '/uploads/' + datePath + '/' + filename;

    res.json({
      message: '圖片已上載',
      url: url,
      size_kb: Math.round(buffer.length / 1024)
    });

  } catch (err) {
    console.error('上載圖片錯誤:', err);
    res.status(500).json({ error: '上載圖片失敗' });
  }
});

// ===== Stripe 香港收費標準 (2026) =====
const STRIPE_HK_FEES = {
  domestic_cards: { percentage: 3.4, fixed_hkd: 2.35, label: '香港發行信用卡' },
  international_cards: { percentage: 3.9, fixed_hkd: 2.35, label: '國際信用卡' },
  alipay_wechat: { percentage: 2.2, fixed_hkd: 2.00, label: 'Alipay/WeChat Pay' },
  dispute_fee: { fixed_hkd: 85.00, label: '爭議處理費' }
};

/**
 * 計算 Stripe 手續費
 * @param {number} amount - 交易金額 (HKD)
 * @param {string} cardType - 'domestic' | 'international'
 * @returns {{ fee: number, net: number, breakdown: object }}
 */
function calculateStripeFee(amount, cardType = 'domestic') {
  const rate = cardType === 'international' 
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
      fixed: rate.fixed_hkd
    }
  };
}

// ===== Stripe SDK (lazy init — 只喺有 key 時先初始化) =====
let stripe = null;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function getStripe() {
  if (!stripe && STRIPE_SECRET && STRIPE_SECRET !== 'sk_test_xxxxxxxxxxxxxxxxxxxx') {
    stripe = require('stripe')(STRIPE_SECRET);
    console.log('💳 Stripe SDK initialized');
  }
  return stripe;
}

// ===== 前端 URL（用於 Checkout redirect）=====
const FRONTEND_URL = process.env.CORS_ORIGIN || 'http://localhost:3001';

// ===== GET /api/payments/stripe/fees — 查詢 Stripe HK 手續費 =====
router.get('/stripe/fees', (req, res) => {
  const amount = parseFloat(req.query.amount) || 0;
  
  const domesticFee = amount > 0 ? calculateStripeFee(amount, 'domestic') : null;
  const intlFee = amount > 0 ? calculateStripeFee(amount, 'international') : null;
  
  res.json({
    currency: 'HKD',
    region: 'Hong Kong',
    standard_rates: STRIPE_HK_FEES,
    calculation: amount > 0 ? {
      amount,
      domestic: domesticFee,
      international: intlFee
    } : null,
    notice: 'Stripe 手續費已包含在付款金額中，商戶實收金額已扣除相關費用。'
  });
});

// ===== POST /api/payments/stripe/create-checkout — 建立 Stripe Checkout Session =====
router.post('/stripe/create-checkout', authenticateToken, async (req, res) => {
  try {
    const { amount, booking_id, description, success_path, cancel_path } = req.body;

    if (!amount || amount < 1) {
      return res.status(400).json({ error: '無效金額' });
    }

    // 預先計算手續費
    const feeInfo = calculateStripeFee(amount, 'domestic');

    // 如果沒 Stripe key，fallback 去開發模式
    if (!getStripe()) {
      console.log('⚠️ Stripe not configured, using dev fallback');
      const fakeSession = {
        id: 'cs_dev_' + uuidv4().slice(0, 8),
        url: null
      };
      const intentId = 'pi_dev_' + uuidv4().slice(0, 8);
      return res.json({
        checkout_url: null,
        session_id: fakeSession.id,
        dev_mode: true,
        dev_intent_id: intentId,
        amount,
        fee: feeInfo,
        message: 'Stripe 未設定，開發模式：直接 confirm 即可'
      });
    }

    // 建立 Stripe Checkout Session
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'hkd',
          product_data: {
            name: description || 'ZenPass 課程預約',
            description: `HK$${amount} — 已包含 Stripe 手續費 HK$${feeInfo.fee}`
          },
          unit_amount: Math.round(amount * 100) // HKD 轉 cent
        },
        quantity: 1
      }],
      metadata: {
        booking_id: booking_id || '',
        user_id: req.user.id,
        gross_amount: String(amount),
        stripe_fee: String(feeInfo.fee),
        net_amount: String(feeInfo.net)
      },
      success_url: `${FRONTEND_URL}/payment.html?stripe=success&session_id={CHECKOUT_SESSION_ID}&booking_id=${booking_id || ''}`,
      cancel_url: `${FRONTEND_URL}/payment.html?stripe=cancel&booking_id=${booking_id || ''}`
    });

    res.json({
      checkout_url: session.url,
      session_id: session.id,
      dev_mode: false,
      amount,
      fee: feeInfo
    });

  } catch (err) {
    console.error('Stripe Checkout 錯誤:', err);
    res.status(500).json({ error: '無法建立付款頁面' });
  }
});

// ===== POST /api/payments/stripe/confirm-payment — 確認 Stripe 付款 (Checkout 完成後 call) =====
router.post('/stripe/confirm-payment', authenticateToken, async (req, res) => {
  try {
    const { session_id, booking_id } = req.body;

    // 如果開發模式，模擬成功
    if (!getStripe()) {
      // Dev mode: mark as paid
      return await completeStripePayment(req, res, booking_id, 'pi_dev_' + uuidv4().slice(0, 8));
    }

    // 正式：檢查 Stripe Session 狀態
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id);
      
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: '付款尚未完成' });
      }

      const paymentIntentId = session.payment_intent;
      return await completeStripePayment(req, res, booking_id, paymentIntentId);

    } catch (stripeErr) {
      console.error('Stripe session retrieval error:', stripeErr);
      return res.status(500).json({ error: '無法確認付款狀態' });
    }

  } catch (err) {
    console.error('確認付款錯誤:', err);
    res.status(500).json({ error: '確認付款失敗' });
  }
});

// ===== Helper: 完成 Stripe 付款 (更新 booking + transaction) =====
async function completeStripePayment(req, res, booking_id, paymentIntentId) {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    if (booking_id) {
      const booking = db.prepare('SELECT status FROM bookings WHERE id = ?').get(booking_id);
      if (booking && booking.status === 'pending_payment') {
        db.prepare(`
          UPDATE bookings SET status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = ?
          WHERE id = ?
        `).run(paymentIntentId, booking_id);
      } else {
        db.prepare(`
          UPDATE bookings SET payment_status = 'paid', stripe_payment_intent_id = ?
          WHERE id = ?
        `).run(paymentIntentId, booking_id);
      }
    }

    // 記錄交易
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, payment_method, stripe_payment_intent_id, status)
      VALUES (?, ?, 'single_booking', ?, 'stripe', ?, 'completed')
    `).run(uuidv4(), req.user.id, req.body.amount || 0, paymentIntentId);

    db.close();

    res.json({
      message: '💳 信用卡付款成功！',
      booking_id,
      status: 'confirmed',
      payment_status: 'paid'
    });

  } catch (err) {
    console.error('Stripe 完成付款錯誤:', err);
    res.status(500).json({ error: '付款確認失敗' });
  }
}

// ===== POST /api/payments/stripe/webhook — Stripe Webhook =====
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    
    if (!getStripe() || !STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET === 'whsec_xxxxxxxxxxxxxxxxxxxx') {
      return res.status(200).json({ received: true, note: 'Webhook not configured' });
    }

    let event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 處理 checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const booking_id = session.metadata?.booking_id;
      const paymentIntentId = session.payment_intent;

      if (booking_id) {
        const db = new Database(DB_PATH);
        db.pragma('foreign_keys = ON');
        
        const booking = db.prepare('SELECT status FROM bookings WHERE id = ?').get(booking_id);
        if (booking && booking.status === 'pending_payment') {
          db.prepare(`
            UPDATE bookings SET status = 'confirmed', payment_status = 'paid', stripe_payment_intent_id = ?
            WHERE id = ?
          `).run(paymentIntentId, booking_id);
        }

        db.prepare(`
          INSERT INTO transactions (id, user_id, type, amount, payment_method, stripe_payment_intent_id, status)
          VALUES (?, ?, 'single_booking', ?, 'stripe', ?, 'completed')
        `).run(uuidv4(), session.metadata.user_id || '', session.amount_total / 100, paymentIntentId);

        db.close();
        console.log('✅ Webhook: Booking', booking_id, 'payment confirmed via Stripe');
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// ===== POST /api/payments/fps — 轉數快付款 (需 Admin 確認) =====
router.post('/fps', authenticateToken, (req, res) => {
  try {
    const { amount, booking_id, fps_reference, receipt_image } = req.body;

    if (!fps_reference) {
      return res.status(400).json({ error: '請提供轉數快參考編號' });
    }

    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    // 檢查 booking 存在
    const booking = booking_id ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id) : null;
    if (booking_id && !booking) {
      db.close();
      return res.status(404).json({ error: '預約不存在' });
    }

    // 儲存 FPS 資料，保持 pending_payment，等 Admin 核實
    if (booking_id) {
      db.prepare(`
        UPDATE bookings SET fps_reference = ?, amount = ?, payment_method = 'fps', receipt_image = ?
        WHERE id = ?
      `).run(fps_reference, amount || booking.amount || 0, receipt_image || null, booking_id);
    }

    // 記錄交易 (pending 狀態)
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, payment_method, fps_reference, status, description)
      VALUES (?, ?, 'single_booking', ?, 'fps', ?, 'pending', '待管理員確認')
    `).run(uuidv4(), req.user.id, amount || (booking ? booking.amount : 0), fps_reference);

    db.close();

    res.json({
      message: '轉數快資料已提交，管理員確認後預約會自動生效',
      status: 'pending_verification',
      fps_info: {
        phone: '9033 5538',
        email: 'info@zenpass.hk',
        bank: 'HSBC'
      }
    });

  } catch (err) {
    console.error('轉數快付款錯誤:', err);
    res.status(500).json({ error: '轉數快付款失敗' });
  }
});

// ===== POST /api/payments/payme — PayMe 付款 (需 Admin 確認) =====
router.post('/payme', authenticateToken, (req, res) => {
  try {
    const { amount, booking_id, payme_reference, receipt_image } = req.body;

    if (!payme_reference) {
      return res.status(400).json({ error: '請提供 PayMe 參考編號' });
    }

    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const booking = booking_id ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id) : null;
    if (booking_id && !booking) {
      db.close();
      return res.status(404).json({ error: '預約不存在' });
    }

    // 儲存 PayMe 資料，保持 pending_payment，等 Admin 核實
    if (booking_id) {
      db.prepare(`
        UPDATE bookings SET payme_reference = ?, amount = ?, payment_method = 'payme', receipt_image = ?
        WHERE id = ?
      `).run(payme_reference, amount || booking.amount || 0, receipt_image || null, booking_id);
    }

    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, payment_method, payme_reference, status, description)
      VALUES (?, ?, 'single_booking', ?, 'payme', ?, 'pending', '待管理員確認')
    `).run(uuidv4(), req.user.id, amount || (booking ? booking.amount : 0), payme_reference);

    db.close();

    res.json({
      message: 'PayMe 資料已提交，管理員確認後預約會自動生效',
      status: 'pending_verification',
      payme_info: {
        phone: '9492 5828',
        note: 'ZenPass 課程'
      }
    });

  } catch (err) {
    console.error('PayMe 付款錯誤:', err);
    res.status(500).json({ error: 'PayMe 付款失敗' });
  }
});

// ===== GET /api/payments/gateways — 付款方式列表 (含手續費資訊) =====
router.get('/gateways', (req, res) => {
  const amount = parseFloat(req.query.amount) || 0;
  const stripeFee = amount > 0 ? calculateStripeFee(amount, 'domestic') : null;

  res.json({
    currency: 'HKD',
    gateways: [
      {
        id: 'stripe',
        name: '信用卡 (Stripe)',
        icon: '💳',
        description: 'Visa / Mastercard / AE',
        enabled: true,
        fee_info: {
          rate: STRIPE_HK_FEES.domestic_cards.percentage + '% + HK$' + STRIPE_HK_FEES.domestic_cards.fixed_hkd,
          label: '香港發行卡：3.4% + HK$2.35',
          international_rate: STRIPE_HK_FEES.international_cards.percentage + '% + HK$' + STRIPE_HK_FEES.international_cards.fixed_hkd,
          note: '國際信用卡或附加 0.5%'
        },
        estimated_fee: stripeFee ? {
          amount: stripeFee.fee,
          net: stripeFee.net,
          breakdown: stripeFee.breakdown
        } : null
      },
      {
        id: 'fps',
        name: '轉數快 FPS',
        icon: '🏦',
        description: 'FPS 即時轉帳 · 零手續費',
        fee_info: { fee: 0, label: '免手續費' },
        account: '9033 5538 (HSBC)',
        enabled: true
      },
      {
        id: 'payme',
        name: 'PayMe',
        icon: '💚',
        description: 'PayMe 掃碼付款 · 零手續費',
        fee_info: { fee: 0, label: '免手續費' },
        account: '9492 5828',
        enabled: true
      }
    ]
  });
});

module.exports = router;
