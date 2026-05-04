/**
 * ZenPass 禪流 - 教練路由
 * 教練申請、管理課程
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || './data/zenpass.db';

// ===== POST /api/coach/apply — 提交教練申請 =====
router.post('/apply', authenticateToken, (req, res) => {
  try {
    const {
      name, phone, email, years_experience, specialties,
      certificates, bio, venue_name, venue_address, venue_photos, facilities
    } = req.body;

    if (!name || !phone || !email || !venue_name || !venue_address) {
      return res.status(400).json({ error: '請填寫姓名、電話、電郵、場地名稱和地址' });
    }

    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    // 檢查是否已有申請
    const existing = db.prepare(
      "SELECT id FROM coach_applications WHERE user_id = ? AND status = 'pending'"
    ).get(req.user.id);

    if (existing) {
      db.close();
      return res.status(409).json({ error: '你已經有進行中的申請' });
    }

    const id = uuidv4();
    const specialtiesStr = Array.isArray(specialties) ? specialties.join(',') : specialties;
    const facilitiesStr = Array.isArray(facilities) ? facilities.join(',') : facilities;
    const venuePhotosStr = Array.isArray(venue_photos) ? venue_photos.join(',') : venue_photos;
    const appRef = 'CA-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).substring(2,6).toUpperCase();

    db.prepare(`
      INSERT INTO coach_applications 
        (id, user_id, name, phone, email, years_experience, specialties, 
         certificates, bio, venue_name, venue_address, venue_photos, facilities,
         application_reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, name, phone, email, years_experience || null,
      specialtiesStr || null, certificates || null, bio || null,
      venue_name, venue_address, venuePhotosStr || null, facilitiesStr || null, appRef);

    db.close();

    res.status(201).json({
      message: '申請已提交，我們將在 3 個工作日內完成審批',
      application_id: id
    });

  } catch (err) {
    console.error('教練申請錯誤:', err);
    res.status(500).json({ error: '提交申請失敗' });
  }
});

// ===== GET /api/coach/application — 查詢申請狀態 =====
router.get('/application', authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const application = db.prepare(`
      SELECT * FROM coach_applications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(req.user.id);

    db.close();

    if (!application) {
      return res.json({ application: null });
    }

    res.json({ application });

  } catch (err) {
    console.error('查詢申請錯誤:', err);
    res.status(500).json({ error: '無法查詢申請狀態' });
  }
});

// ===== GET /api/coach/my-classes — 我的課程 =====
router.get('/my-classes', authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    const classes = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'confirmed') as upcoming_bookings,
        (SELECT COUNT(*) FROM bookings WHERE class_id = c.id AND status = 'attended') as total_attended
      FROM classes c
      WHERE c.coach_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);

    db.close();

    res.json({ classes });

  } catch (err) {
    console.error('獲取課程錯誤:', err);
    res.status(500).json({ error: '無法獲取課程列表' });
  }
});

// ===== POST /api/coach/schedules — 新增課程時間 =====
router.post('/schedules', authenticateToken, (req, res) => {
  try {
    const { class_id, start_time, end_time, recurring, max_participants } = req.body;

    if (!class_id || !start_time || !end_time) {
      return res.status(400).json({ error: '請填寫課程、開始時間和結束時間' });
    }

    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');

    // Verify ownership
    const classData = db.prepare('SELECT * FROM classes WHERE id = ? AND coach_id = ?').get(class_id, req.user.id);
    if (!classData) {
      db.close();
      return res.status(403).json({ error: '你無權限操作此課程' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO class_schedules (id, class_id, start_time, end_time, recurring, max_participants)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, class_id, start_time, end_time, recurring || 'none', max_participants || classData.max_participants);

    db.close();

    res.status(201).json({ message: '時間已新增', schedule_id: id });

  } catch (err) {
    console.error('新增時間錯誤:', err);
    res.status(500).json({ error: '無法新增時間' });
  }
});

module.exports = router;
