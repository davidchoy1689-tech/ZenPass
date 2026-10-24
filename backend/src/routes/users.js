/**
 * ZenPass 禪流 - 用戶資料路由
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { writeBlock } = require("../services/blockchain-audit");

const router = express.Router();

// ===== GET /api/users/profile — 取個人資料 =====
router.get("/profile", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });

    // 獲取預約記錄
    db.pragma("foreign_keys = ON");
    const bookings = db
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

    res.json({ user, bookings });
  } catch (err) {
    console.error("取用戶資料錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得用戶資料" });
  }
});

// ===== PUT /api/users/profile — 更新個人資料 =====
router.put("/profile", authenticateToken, (req, res) => {
  try {
    const { name, phone, avatar_url, birth_year, gender, emergency_name, emergency_phone, health_declared } = req.body;
    const db = getDb();
    db.pragma("foreign_keys = ON");

    const updates = [];
    const params = [];

    if (name) {
      updates.push("name = ?");
      params.push(name);
    }
    if (phone !== undefined) {
      // 2026-10-24：電話必填（社交登入帳號補填用），格式同註冊一致
      const digits = String(phone || "").replace(/[^\d]/g, "").replace(/^852/, "").replace(/^0/, "");
      if (digits && digits.length !== 8) {
        return res.status(400).json({ success: false, error: "電話號碼格式不正確（香港 8 位數字）", code: "PHONE_INVALID" });
      }
      updates.push("phone = ?");
      params.push(digits || null);
    }
    if (avatar_url) {
      updates.push("avatar_url = ?");
      params.push(avatar_url);
    }
    // 選填個人資料
    if (birth_year !== undefined) {
      updates.push("birth_year = ?");
      params.push(birth_year ? parseInt(birth_year) || null : null);
    }
    if (gender !== undefined) {
      updates.push("gender = ?");
      params.push(gender ? String(gender).slice(0, 12) : null);
    }
    if (emergency_name !== undefined) {
      updates.push("emergency_name = ?");
      params.push(emergency_name ? String(emergency_name).slice(0, 60) : null);
    }
    if (emergency_phone !== undefined) {
      updates.push("emergency_phone = ?");
      params.push(emergency_phone ? String(emergency_phone).replace(/[^\d+]/g, "").slice(0, 20) : null);
    }
    if (health_declared !== undefined) {
      updates.push("health_declared = ?", "health_declared_at = ?");
      params.push(health_declared ? 1 : 0, health_declared ? new Date().toISOString() : null);
    }

    if (updates.length === 0) {

      return res.status(400).json({ success: false, error: "沒有需要更新的資料" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params,
    );

    const changedFields = {};
    if (name) changedFields.name = name;
    if (phone !== undefined) changedFields.phone = phone;
    if (avatar_url) changedFields.avatar_url = avatar_url;
    try {
      writeBlock({ entityType: "user", entityId: req.user.id, data: { action: "profile_update", changes: changedFields } });
    } catch (be) { console.error("[BLOCKCHAIN] writeBlock error:", be.message); }

    res.json({ message: "資料已更新" });
  } catch (err) {
    console.error("更新用戶資料錯誤:", err);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

// ===== GET /api/users/credits — 查詢點數 =====
router.get("/credits", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

    res.json({
      credits: user.credits,
      membership_type: user.membership_type,
      transactions,
    });
  } catch (err) {
    console.error("查詢點數錯誤:", err);
    res.status(500).json({ success: false, error: "無法查詢點數" });
  }
});

// ===== GET /api/users/me — 別名指向 /profile =====
router.get("/me", authenticateToken, (req, res) => {
  // Forward to /profile handler logic
  try {
    const db = getDb();
    const user = db
      .prepare(
        `SELECT id, email, email_verified, name, phone, avatar_url, credits, membership_type,
                membership_expires_at, is_coach, coach_verified, created_at,
                role, user_reference, points, points_tier, checkin_streak,
                total_visits, total_spent,
                birth_year, gender, emergency_name, emergency_phone, COALESCE(health_declared,0) AS health_declared
         FROM users WHERE id = ?`,
      )
      .get(req.user.id);

    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });

    const { permissionsFor } = require("../config/permissions");
    res.json({
      ...user,
      membership_expires_at: user.membership_expires_at || null,
      needs_phone: !user.phone,
      permissions: permissionsFor(user.role),
    });
  } catch (err) {
    console.error("GET /users/me error:", err);
    res.status(500).json({ success: false, error: "無法取得用戶資料" });
  }
});

module.exports = router;
