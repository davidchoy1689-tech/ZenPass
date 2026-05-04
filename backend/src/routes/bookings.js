/**
 * ZenPass 禪流 - 預約路由
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const { authenticateToken } = require('../middleware/auth');

const { sendNotification } = require('../services/notification');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || './data/zenpass.db';

function generateBookingRef() {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth()+1).padStart(2,'0') +
    String(now.getDate()).padStart(2,'0');
  const suffix = Math.random().toString(36).substring(2,6).toUpperCase();
  return 'ZP-' + dateStr + '-' + suffix;
}

// ===== POST /api/bookings — 建立預約 =====
router.post('/', authenticateToken, (req, res) => {
  try {
    const { schedule_id, class_id, payment_type, amount } = req.body;

    if (!schedule_id || !class_id || !payment_type) {
      return res.status(400).json({ error: '缺少預約資料' });
    }

    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    // 檢查課程時間表是否存在
    const schedule = db.prepare(`
      SELECT * FROM class_schedules WHERE id = ? AND status = 'available'
    `).get(schedule_id);

    if (!schedule) {
      db.close();
      return res.status(404).json({ error: '該時段不存在或已滿' });
    }

    // 檢查名額
    if (schedule.enrolled_count >= schedule.max_participants) {
      db.close();
      return res.status(400).json({ error: '該時段已滿額' });
    }

    // 檢查是否重複預約（包括未付款的 pending_payment）
    const existing = db.prepare(`
      SELECT id, status, payment_status FROM bookings 
      WHERE user_id = ? AND schedule_id = ? AND (status = 'confirmed' OR status = 'pending_payment')
    `).get(req.user.id, schedule_id);

    if (existing) {
      // 如果係未完成付款，俾佢繼續付款
      if (existing.status === 'pending_payment') {
        db.close();
        return res.status(200).json({ 
          message: '你有一個未完成付款的預約，請繼續付款',
          booking_id: existing.id,
          status: 'pending_payment',
          requires_payment: true
        });
      }
      db.close();
      return res.status(409).json({ error: '你已經預約了此課程時段' });
    }

    // 根據付款類型處理
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (payment_type === 'credits') {
      // 用點數付款
      const classData = db.prepare('SELECT credits_cost FROM classes WHERE id = ?').get(class_id);
      if (!classData) {
        db.close();
        return res.status(404).json({ error: '課程不存在' });
      }
      if (user.credits < classData.credits_cost) {
        db.close();
        return res.status(400).json({ error: '點數不足，請先購買點數' });
      }
      // 扣點數
      db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?')
        .run(classData.credits_cost, req.user.id);
    }

    // 建立預約 — 未付款用 pending_payment，唔會 block 住重試
    const bookingId = uuidv4();
    const bookingRef = generateBookingRef();
    const bookingStatus = payment_type === 'single' ? 'pending_payment' : 'confirmed';
    const paymentStatus = payment_type === 'single' ? 'pending' : 'paid';

    // credits 付款係即時扣點數，唔需要用 pending
    db.prepare(`
      INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bookingId, bookingRef, req.user.id, schedule_id, class_id, payment_type, paymentStatus, bookingStatus, amount || 0);

    // 讀取課程/教練/時間資料（用於通知同 response）
    let classInfo, coachInfo, scheduleTimes;
    try {
      classInfo = db.prepare('SELECT title, venue_name, coach_id, price_hkd FROM classes WHERE id = ?').get(class_id);
      coachInfo = db.prepare('SELECT name FROM users WHERE id = ?').get(classInfo?.coach_id || null);
      scheduleTimes = db.prepare('SELECT start_time, end_time FROM class_schedules WHERE id = ?').get(schedule_id);
    } catch (e) {
      // 讀取失敗唔影響 booking creation
    }

    // 更新已預約人數
    db.prepare('UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ?')
      .run(schedule_id);

    // 🔔 通知：預約成功（async fire-and-forget）
    if (classInfo) {
      setTimeout(async () => {
        try {
          sendNotification('booking.confirmed', {
            recipient: req.user.id,
            data: {
              class_title: classInfo?.title || '—',
              date: scheduleTimes?.start_time ? scheduleTimes.start_time.split('T')[0] : '—',
              time: scheduleTimes?.start_time ? scheduleTimes.start_time.split('T')[1]?.slice(0, 5) : '—',
              venue: classInfo?.venue_name || '—',
              coach_name: coachInfo?.name || '—'
            }
          });
        } catch (notifErr) {
          console.error('⚠️ 發送通知失敗:', notifErr.message);
        }

        // 🔔 通知：教練有新預約
        if (bookingStatus !== 'pending_payment' && classInfo?.coach_id) {
          try {
            sendNotification('coach.new_booking', {
              recipient: classInfo.coach_id,
              data: {
                student_name: req.user.name || '學生',
                class_title: classInfo?.title || '—',
                date: scheduleTimes?.start_time ? scheduleTimes.start_time.split('T')[0] : '—',
                time: scheduleTimes?.start_time ? scheduleTimes.start_time.split('T')[1]?.slice(0, 5) : '—',
                amount: amount || classInfo?.price_hkd || '—'
              }
            });
          } catch (notifErr) {
            console.error('⚠️ 發送教練通知失敗:', notifErr.message);
          }
        }
      }, 0);
    }

    db.close();

    res.status(201).json({
      message: '預約成功' + (bookingStatus === 'pending_payment' ? '，請完成付款' : ''),
      booking_id: bookingId,
      booking_reference: bookingRef,
      status: bookingStatus,
      payment_status: paymentStatus,
      requires_payment: bookingStatus === 'pending_payment',
      class: classInfo ? {
        title: classInfo.title,
        venue: classInfo.venue_name,
        price: classInfo.price_hkd
      } : null,
      schedule: scheduleTimes ? {
        start_time: scheduleTimes.start_time,
        end_time: scheduleTimes.end_time
      } : null
    });

  } catch (err) {
    console.error('預約錯誤:', err);
    res.status(500).json({ error: '預約失敗，請稍後再試' });
  }
});

// ===== GET /api/bookings/my — 我的預約 =====
router.get('/my', authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const { status, page = 1, limit = 20 } = req.query;

    let whereConditions = ['b.user_id = ?'];
    let params = [req.user.id];

    if (status) {
      whereConditions.push('b.status = ?');
      params.push(status);
    }

    const whereClause = whereConditions.join(' AND ');
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const bookings = db.prepare(`
      SELECT 
        b.*, c.title, c.category, c.duration, c.price_hkd, c.venue_name,
        cs.start_time, cs.end_time,
        u.name as coach_name
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN users u ON c.coach_id = u.id
      WHERE ${whereClause}
      ORDER BY cs.start_time DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    db.close();

    res.json({ bookings });

  } catch (err) {
    console.error('獲取預約錯誤:', err);
    res.status(500).json({ error: '無法獲取預約記錄' });
  }
});

// ===== POST /api/bookings/:id/complete-payment — 完成付款（pending_payment → confirmed）=====
router.post('/:id/complete-payment', authenticateToken, (req, res) => {
  try {
    const { payment_method, payment_reference, amount } = req.body;
    
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const booking = db.prepare(`
      SELECT * FROM bookings WHERE id = ? AND user_id = ? AND status = 'pending_payment'
    `).get(req.params.id, req.user.id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: '未找到待付款的預約' });
    }

    // 更新 booking 為已付款
    const updateFields = ["status = 'confirmed'", "payment_status = 'paid'", "amount = ?"];
    const updateParams = [amount || booking.amount || 0];

    if (payment_method === 'stripe' && payment_reference) {
      updateFields.push('stripe_payment_intent_id = ?');
      updateParams.push(payment_reference);
    } else if (payment_method === 'fps' && payment_reference) {
      updateFields.push('fps_reference = ?');
      updateParams.push(payment_reference);
    } else if (payment_method === 'payme' && payment_reference) {
      updateFields.push('payme_reference = ?');
      updateParams.push(payment_reference);
    }

    updateParams.push(req.params.id);
    db.prepare(`UPDATE bookings SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateParams);

    // 更新已預約人數（pending_payment → confirmed，加返名額）
    db.prepare('UPDATE class_schedules SET enrolled_count = enrolled_count + 1 WHERE id = ?')
      .run(booking.schedule_id);

    // 記錄交易
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, payment_method, ${payment_method === 'stripe' ? 'stripe_payment_intent_id' : payment_method === 'fps' ? 'fps_reference' : 'payme_reference'}, status)
      VALUES (?, ?, 'single_booking', ?, ?, ?, 'completed')
    `).run(uuidv4(), req.user.id, amount || booking.amount || 0, payment_method || 'fps', payment_reference || null);

    // 🔔 通知：預約確認（付款完成）
    const classDataNotif = db.prepare('SELECT title FROM classes WHERE id = ?').get(booking.class_id);
    try {
      sendNotification('booking.confirmed', {
        recipient: req.user.id,
        data: {
          class_title: classDataNotif?.title || '—',
          date: '—', time: '—', venue: '—', coach_name: '—'
        }
      });
      sendNotification('coach.new_booking', {
        recipient: null,  // will be filled by class owner
        data: { student_name: req.user.name || '學生', class_title: classDataNotif?.title || '—' }
      });
    } catch (notifErr) {
      console.error('⚠️ 發送通知失敗:', notifErr.message);
    }

    db.close();

    res.json({ 
      message: '付款成功，預約已確認！',
      booking_id: booking.id,
      status: 'confirmed',
      payment_status: 'paid'
    });

  } catch (err) {
    console.error('完成付款錯誤:', err);
    res.status(500).json({ error: '完成付款失敗' });
  }
});

// ===== POST /api/bookings/:id/cancel — 取消預約 =====
router.post('/:id/cancel', authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const booking = db.prepare(`
      SELECT b.*, cs.start_time FROM bookings b
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.id = ? AND b.user_id = ?
    `).get(req.params.id, req.user.id);

    if (!booking) {
      db.close();
      return res.status(404).json({ error: '預約不存在' });
    }

    // pending_payment (未付款) 可隨時取消，唔使等 2 小時限制
    if (booking.status !== 'pending_payment') {
      const now = new Date();
      const classTime = new Date(booking.start_time);
      const hoursUntilClass = (classTime - now) / (1000 * 60 * 60);

      if (hoursUntilClass < 2) {
        db.close();
        return res.status(400).json({ error: '開課前 2 小時內無法取消預約' });
      }
    }

    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    
    // 釋放名額
    db.prepare('UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ?')
      .run(booking.schedule_id);

    // 如果是用點數付款，退還點數
    if (booking.payment_type === 'credits') {
      const classData = db.prepare('SELECT credits_cost FROM classes WHERE id = ?').get(booking.class_id);
      if (classData) {
        db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?')
          .run(classData.credits_cost, req.user.id);
      }
    }

    db.close();

    res.json({ message: '預約已取消' });

  } catch (err) {
    console.error('取消預約錯誤:', err);
    res.status(500).json({ error: '取消預約失敗' });
  }
});

module.exports = router;
