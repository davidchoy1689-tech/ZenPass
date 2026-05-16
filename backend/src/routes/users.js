/**
 * ZenPass 禪流 - 用戶資料路由
 */

const express = require("express");
const Database = require("better-sqlite3");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== GET /api/users/profile — 取個人資料 =====
router.get("/profile", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare(
        `
      SELECT id, email, name, phone, avatar_url, credits, membership_type,
             membership_expires_at, is_coach, coach_verified, created_at,
             points, points_tier, points_tier_label, last_checkin, checkin_streak
      FROM users WHERE id = ?
    `,
      )
      .get(req.user.id);

    db.close();

    if (!user) return res.status(404).json({ error: "用戶不存在" });

    // 獲取預約記錄
    const db2 = new Database(DB_PATH);
    db2.pragma("foreign_keys = ON");
    const bookings = db2
      .prepare(
        `
      SELECT b.*, c.title, c.category, c.duration, cs.start_time, cs.end_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      WHERE b.user_id = ?
      ORDER BY cs.start_time DESC
      LIMIT 20
    `,
      )
      .all(req.user.id);
    db2.close();

    res.json({ user, bookings });
  } catch (err) {
    console.error("取用戶資料錯誤:", err);
    res.status(500).json({ error: "無法取得用戶資料" });
  }
});

// ===== PUT /api/users/profile — 更新個人資料 =====
router.put("/profile", authenticateToken, (req, res) => {
  try {
    const { name, phone, avatar_url } = req.body;
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const updates = [];
    const params = [];

    if (name) {
      updates.push("name = ?");
      params.push(name);
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (avatar_url) {
      updates.push("avatar_url = ?");
      params.push(avatar_url);
    }

    if (updates.length === 0) {
      db.close();
      return res.status(400).json({ error: "沒有需要更新的資料" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params,
    );
    db.close();

    res.json({ message: "資料已更新" });
  } catch (err) {
    console.error("更新用戶資料錯誤:", err);
    res.status(500).json({ error: "更新失敗" });
  }
});

// ===== GET /api/users/credits — 查詢點數 =====
router.get("/credits", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare("SELECT credits, membership_type FROM users WHERE id = ?")
      .get(req.user.id);

    const transactions = db
      .prepare(
        `
      SELECT id, type, amount, description, created_at
      FROM transactions
      WHERE user_id = ? AND (type = 'credits_topup' OR type = 'refund')
      ORDER BY created_at DESC
      LIMIT 20
    `,
      )
      .all(req.user.id);

    db.close();

    res.json({
      credits: user.credits,
      membership_type: user.membership_type,
      transactions,
    });
  } catch (err) {
    console.error("查詢點數錯誤:", err);
    res.status(500).json({ error: "無法查詢點數" });
  }
});

// ===== GET /api/users/me — 別名指向 /profile =====
router.get("/me", authenticateToken, (req, res) => {
  // Forward to /profile handler logic
  try {
    const db = new Database(DB_PATH);
    const user = db
      .prepare(
        `SELECT id, email, name, phone, avatar_url, credits, membership_type,
                membership_expires_at, is_coach, coach_verified, created_at,
                role
         FROM users WHERE id = ?`
      )
      .get(req.user.id);
    db.close();

    if (!user) return res.status(404).json({ error: "用戶不存在" });

    res.json({
      ...user,
      membership_expires_at: user.membership_expires_at || null,
    });
  } catch (err) {
    console.error("GET /users/me error:", err);
    res.status(500).json({ error: "無法取得用戶資料" });
  }
});

module.exports = router;
