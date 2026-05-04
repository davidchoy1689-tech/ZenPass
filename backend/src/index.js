/**
 * ZenPass 禪流 - 主伺服器入口
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sendNotification } = require('./services/notification');

// 初始化數據庫
const initDatabase = require('./config/init-db');
initDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// ===== 中介軟體 =====

// CORS 設定 - 支援跨域請求（GitHub Pages → localhost）
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://davidchoy1689-tech.github.io',
      'http://localhost:8080',
      'http://localhost:9090',
      'http://localhost:8888',
      'http://localhost:3001',
      undefined  // Allow same-origin
    ];
    if (allowed.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for development
    }
  },
  credentials: true
}));

// 靜態檔案服務 - 直接 serve ZenPass 前台和管理後台
app.use(express.static(path.join(__dirname, '../../frontend')));
app.use('/admin', express.static(path.join(__dirname, '../../admin')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分鐘
  max: 100,
  message: { error: '太多請求，請稍後再試' }
});
app.use('/api/', limiter);

// Stripe webhook needs raw body — must come BEFORE express.json()
app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));

// JSON body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== 路由 =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/coach', require('./routes/coach'));
app.use('/api/memberships', require('./routes/memberships'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/coach', require('./routes/coach-earnings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));

// ===== 健康檢查 =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    name: 'ZenPass 禪流 API',
    time: new Date().toISOString()
  });
});

// ===== 錯誤處理 =====
app.use((err, req, res, next) => {
  console.error('❌ 伺服器錯誤:', err);
  res.status(500).json({
    error: '伺服器內部錯誤',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const DB_PATH = process.env.DB_PATH || './data/zenpass.db';

// ===== 定期清理過期嘅 pending_payment（30分鐘未付款就釋放名額）=====
function cleanupExpiredBookings() {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  
  // 清理過期未付款 booking，但保留已提交 FPS/PayMe 嘅（等 Admin 核實）
  const result = db.prepare(`
    UPDATE bookings SET status = 'cancelled'
    WHERE status = 'pending_payment'
    AND fps_reference IS NULL
    AND payme_reference IS NULL
    AND created_at < datetime('now', '-30 minutes')
  `).run();
  
  // 釋放名額
  db.prepare(`
    UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1)
    WHERE id IN (
      SELECT schedule_id FROM bookings
      WHERE status = 'cancelled'
      AND created_at >= datetime('now', '-31 minutes')
      AND created_at < datetime('now', '-30 minutes')
    )
  `).run();
  
  if (result.changes > 0) {
    console.log('🧹 清理了 ' + result.changes + ' 個過期未付款預約');
  }
  db.close();
}

// 每 5 分鐘清理一次
setInterval(cleanupExpiredBookings, 5 * 60 * 1000);
// 啟動時先清理一次
cleanupExpiredBookings();

// ===== 課前 1 小時提醒 =====
function sendClassReminders() {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  try {
    // 搵出 1 小時後上堂、狀態 confirmed、仲未提醒過嘅 booking
    const due = db.prepare(`
      SELECT b.id, b.user_id, b.class_id, b.schedule_id, b.id as booking_id,
             c.title as class_title, c.venue_name,
             cs.start_time, cs.end_time,
             u.name as user_name, u.email as user_email
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN users u ON b.user_id = u.id
      WHERE b.status = 'confirmed'
        AND (b.reminder_sent_1h IS NULL OR b.reminder_sent_1h = 0)
        AND cs.start_time > datetime('now', '+55 minutes')
        AND cs.start_time < datetime('now', '+65 minutes')
    `).all();

    for (const booking of due) {
      try {
        sendNotification('booking.reminder_1h', {
          recipient: booking.user_id,
          data: {
            class_title: booking.class_title,
            date: booking.start_time.split('T')[0],
            time: booking.start_time.split('T')[1]?.slice(0, 5),
            venue: booking.venue_name || '—'
          }
        });
        console.log(`⏰ 已發送提醒: ${booking.user_name} → ${booking.class_title}`);

        // Mark as reminded (用 booking_id 防重複發送)
        db.prepare(`UPDATE bookings SET reminder_sent_1h = 1 WHERE id = ?`).run(booking.id);
      } catch (e) {
        console.error(`⚠️ 提醒發送失敗 (booking=${booking.id}):`, e.message);
      }
    }

    if (due.length > 0) {
      console.log(`⏰ 發送了 ${due.length} 個課前提醒`);
    }
  } catch (err) {
    console.error('⚠️ 課前提醒排程錯誤:', err.message);
  } finally {
    db.close();
  }
}

// 每 5 分鐘 check 一次
setInterval(sendClassReminders, 5 * 60 * 1000);
// 啟動時 check 一次
setTimeout(sendClassReminders, 5000);

// ===== Startup Health Check =====
function startupHealthCheck() {
  const checks = {
    database: false,
    stripe_key: false,
    port: false
  };

  // Check DB
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.prepare('SELECT 1').get();
    checks.database = true;
    db.close();
  } catch (err) {
    console.error('❌ Startup Check — DB 連線失敗:', err.message);
  }

  // Check Stripe key
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_xxxxxxxxxxxxxxxxxxxx') {
    checks.stripe_key = true;
  } else {
    console.warn('⚠️ Startup Check — Stripe key 未設定或使用預設值，信用卡付款將使用 dev fallback');
  }

  // Check port (will be checked when listen succeeds)
  checks.port = true;

  const allPassed = Object.values(checks).every(v => v === true);
  if (allPassed) {
    console.log('✅ 啟動健康檢查：全部通過');
  } else {
    console.warn('⚠️ 啟動健康檢查：部分檢查未通過', JSON.stringify(checks));
  }

  return checks;
}

// ===== 啟動 =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════╗
║     ZenPass 禪流 API 伺服器已啟動         ║
║     Port: ${PORT}                           ║
║     環境: ${process.env.NODE_ENV || 'development'}                    ║
║     前端: ${process.env.CORS_ORIGIN || 'http://localhost:8080'}   ║
╚═══════════════════════════════════════════╝
  `);
});
