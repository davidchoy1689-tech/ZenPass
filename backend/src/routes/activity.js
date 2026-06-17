const express = require("express");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// GET /api/activity/feed — Recent platform activity (anonymized)
router.get("/feed", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const realFeed = db.prepare(`
      SELECT b.id, b.created_at as time, b.status,
        u.name as user_name, c.title as class_title, c.venue_name,
        c.category
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.status IN ('confirmed', 'attended', 'checked_in')
      ORDER BY b.created_at DESC LIMIT 15
    `).all();
    db.close();

    // Always pad with demo activities so the feed looks alive
    const demos = [
      { id: 'demo-1', time: new Date(Date.now() - 1*3600000).toISOString(), user_name: '小美', class_title: '辦公室伸展舒壓', venue_name: 'ZenSpace 瑜伽教室', category: '伸展' },
      { id: 'demo-2', time: new Date(Date.now() - 3*3600000).toISOString(), user_name: '阿強', class_title: '拳擊有氧 Boxing Fitness', venue_name: 'ZenSpace 健身室', category: '拳擊搏擊' },
      { id: 'demo-3', time: new Date(Date.now() - 8*3600000).toISOString(), user_name: 'Winnie', class_title: '頌缽療癒 Sound Bath', venue_name: 'ZenSpace 瑜伽教室', category: '冥想' },
      { id: 'demo-4', time: new Date(Date.now() - 24*3600000).toISOString(), user_name: 'Phoebe', class_title: '產後修復 Pilates', venue_name: 'ZenSpace 瑜伽教室', category: '產後修復' },
      { id: 'demo-5', time: new Date(Date.now() - 48*3600000).toISOString(), user_name: '小明', class_title: '芭蕾塑形 Barre', venue_name: 'ZenSpace 舞蹈室', category: '舞蹈' },
      { id: 'demo-6', time: new Date(Date.now() - 72*3600000).toISOString(), user_name: 'Catherine', class_title: '空中瑜伽 Aerial Yoga', venue_name: 'ZenSpace 瑜伽教室', category: '瑜伽' },
    ];
    const merged = (realFeed || []).concat(demos).slice(0, 10);

    const anonymized = merged.map(function(item) {
      var nameParts = (item.user_name || '').split(' ');
      var displayName = nameParts[0] || 'User';
      if (nameParts.length > 1) {
        displayName = nameParts[0] + ' ' + nameParts[1].charAt(0) + '.';
      }
      return {
        id: item.id,
        time: item.time,
        user_name: displayName,
        class_title: item.class_title,
        venue_name: item.venue_name,
        category: item.category
      };
    });

    res.json({ feed: anonymized });
  } catch (err) {
    console.error("Activity feed error:", err.message);
    res.status(500).json({ feed: [] });
  }
});

module.exports = router;
