const express = require("express");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// GET /api/activity/feed — Recent platform activity (anonymized)
router.get("/feed", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const feed = db.prepare(`
      SELECT b.id, b.created_at as time, b.status,
        u.name as user_name, c.title as class_title, c.venue_name,
        c.category
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.status IN ('confirmed', 'attended')
        AND b.created_at >= datetime('now', '-7 days')
      ORDER BY b.created_at DESC LIMIT 15
    `).all();
    db.close();

    // Anonymize: show first name + last initial
    const anonymized = feed.map(function(item) {
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
