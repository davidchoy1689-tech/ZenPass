/**
 * ZenPass 禪流 - 認證路由
 * 註冊、登入、第三方登入
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { generateToken, authenticateToken } = require("../middleware/auth");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== POST /api/auth/register — 電郵註冊 =====
router.post("/register", (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    // 驗證
    if (!email || !password || !name) {
      return res.status(400).json({ error: "請填寫姓名、電郵和密碼" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "密碼至少需要 6 個字元" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "電郵格式不正確" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 檢查電郵是否已註冊
    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);
    if (existing) {
      db.close();
      return res.status(409).json({ error: "此電郵已經註冊" });
    }

    // 建立用戶
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const dbCount = new Database(DB_PATH);
    const maxS =
      dbCount
        .prepare(
          "SELECT MAX(CAST(SUBSTR(user_reference, 4) AS INTEGER)) as m FROM users WHERE user_reference GLOB 'US-[0-9]*'",
        )
        .get().m || 0;
    const userRef = "US-" + String(maxS + 1).padStart(4, "0");
    dbCount.close();

    db.prepare(
      `
      INSERT INTO users (id, user_reference, email, password_hash, name, phone, auth_provider)
      VALUES (?, ?, ?, ?, ?, ?, 'email')
    `,
    ).run(id, userRef, email, passwordHash, name, phone || null);

    const user = db
      .prepare(
        "SELECT id, email, name, phone, credits, membership_type, created_at FROM users WHERE id = ?",
      )
      .get(id);
    db.close();

    const token = generateToken(user);

    res.status(201).json({
      message: "註冊成功",
      token,
      user,
    });
  } catch (err) {
    console.error("註冊錯誤:", err);
    res.status(500).json({ error: "註冊失敗，請稍後再試" });
  }
});

// ===== POST /api/auth/login — 電郵登入 =====
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "請輸入電郵和密碼" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      db.close();
      return res.status(401).json({ error: "電郵或密碼不正確" });
    }

    // Check if password login is allowed
    if (user.auth_provider !== "email") {
      db.close();
      return res.status(401).json({
        error: `此帳戶使用 ${user.auth_provider === "apple" ? "Apple" : "Google"} 登入，請使用該方式登入`,
      });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      db.close();
      return res.status(401).json({ error: "電郵或密碼不正確" });
    }

    const token = generateToken(user);

    const { password_hash, ...userData } = user;
    db.close();

    res.json({
      message: "登入成功",
      token,
      user: userData,
    });
  } catch (err) {
    console.error("登入錯誤:", err);
    res.status(500).json({ error: "登入失敗，請稍後再試" });
  }
});

// ===== POST /api/auth/social — Apple / Google 第三方登入 =====
router.post("/social", (req, res) => {
  try {
    const { provider, providerId, email, name } = req.body;

    if (!provider || !providerId) {
      return res.status(400).json({ error: "缺少第三方登入資料" });
    }
    if (!["apple", "google"].includes(provider)) {
      return res.status(400).json({ error: "不支援的登入方式" });
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 先按 provider ID 查找
    let user = db
      .prepare(
        "SELECT * FROM users WHERE auth_provider = ? AND auth_provider_id = ?",
      )
      .get(provider, providerId);

    // 如果未找到，按 email 查找
    if (!user && email) {
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    }

    if (user) {
      // 用戶存在，更新 provider ID
      if (!user.auth_provider_id) {
        db.prepare(
          "UPDATE users SET auth_provider = ?, auth_provider_id = ? WHERE id = ?",
        ).run(provider, providerId, user.id);
      }
      const token = generateToken(user);
      const { password_hash, ...userData } = user;
      db.close();
      return res.json({ message: "登入成功", token, user: userData });
    }

    // 新用戶 - 自動註冊
    const id = uuidv4();
    const displayName = name || email?.split("@")[0] || `${provider}_user`;

    const userRef =
      "US-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    db.prepare(
      `
      INSERT INTO users (id, user_reference, email, name, auth_provider, auth_provider_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(id, userRef, email || null, displayName, provider, providerId);

    user = db
      .prepare(
        "SELECT id, email, name, phone, credits, membership_type, created_at FROM users WHERE id = ?",
      )
      .get(id);
    db.close();

    const token = generateToken(user);

    res.status(201).json({
      message: "註冊成功",
      token,
      user,
    });
  } catch (err) {
    console.error("第三方登入錯誤:", err);
    res.status(500).json({ error: "登入失敗" });
  }
});

// ===== GET /api/auth/me — 取當前用戶資料 =====
router.get("/me", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare(
        `
      SELECT id, email, name, phone, avatar_url, credits, membership_type, 
             membership_expires_at, is_coach, coach_verified, role, partner_id, created_at
      FROM users WHERE id = ?
    `,
      )
      .get(req.user.id);

    db.close();

    if (!user) {
      return res.status(404).json({ error: "用戶不存在" });
    }

    res.json({ user });
  } catch (err) {
    console.error("取用戶資料錯誤:", err);
    res.status(500).json({ error: "無法取得用戶資料" });
  }
});

module.exports = router;
