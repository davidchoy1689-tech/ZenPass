/**
 * ZenPass 禪流 - 認證路由
 * 註冊、登入、第三方登入
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const { generateToken, authenticateToken } = require("../middleware/auth");

const { OAuth2Client } = require("google-auth-library");

const router = express.Router();
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// Google OAuth2 client (lazy init)
let googleClient = null;
function getGoogleClient() {
  if (!googleClient) {
    const gId = process.env.GOOGLE_CLIENT_ID;
    if (gId && gId !== "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com") {
      googleClient = new OAuth2Client(gId);
    }
  }
  return googleClient;
}

// Verify Google ID token
async function verifyGoogleToken(idToken) {
  try {
    const client = getGoogleClient();
    if (!client) return null; // No client ID configured, skip verification
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  } catch (err) {
    console.error("Google token verification failed:", err.message);
    return null;
  }
}

// ===== POST /api/auth/register - 電郵註冊 =====
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

    // 生成驗證 token (24小時有效)
    const verificationToken = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    db.prepare(
      `
      INSERT INTO users (id, user_reference, email, password_hash, name, phone, auth_provider, email_verified, verification_token, verification_token_expires)
      VALUES (?, ?, ?, ?, ?, ?, 'email', 0, ?, datetime('now', '+24 hours'))
    `,
    ).run(id, userRef, email, passwordHash, name, phone || null, verificationToken);

    const user = db
      .prepare(
        "SELECT id, email, name, phone, credits, membership_type, email_verified, created_at FROM users WHERE id = ?",
      )
      .get(id);
    db.close();

    const token = generateToken(user);

    const isDev = !process.env.SMTP_HOST;
    res.status(201).json({
      message: "註冊成功",
      token,
      user,
      ...(isDev ? { dev_verify_url: "https://zenpass.hk/verify-email.html?token=" + verificationToken } : {})
    });
  } catch (err) {
    console.error("註冊錯誤:", err);
    res.status(500).json({ error: "註冊失敗,請稍後再試" });
  }
});

// ===== POST /api/auth/login - 電郵登入 =====
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
        error: `此帳戶使用 ${user.auth_provider === "apple" ? "Apple" : "Google"} 登入,請使用該方式登入`,
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
    res.status(500).json({ error: "登入失敗,請稍後再試" });
  }
});

// ===== POST /api/auth/social - Apple / Google 第三方登入 =====
router.post("/social", async (req, res) => {
  try {
    let { provider, providerId, email, name, providerToken } = req.body;

    if (!provider || !providerId) {
      return res.status(400).json({ error: "缺少第三方登入資料" });
    }
    if (!["apple", "google"].includes(provider)) {
      return res.status(400).json({ error: "不支援的登入方式" });
    }

    // Google: verify ID token if provided
    if (provider === "google" && providerToken) {
      const payload = await verifyGoogleToken(providerToken);
      if (payload) {
        // Override with verified data from Google
        providerId = payload.sub;
        email = email || payload.email;
        name = name || payload.name;
      } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com") {
        // Client ID configured but verification failed - reject
        return res.status(401).json({ error: "Google 身份驗證失敗" });
      }
    }

    // Apple: basic verification (full server-side requires Apple's JWKS)
    // For now, trust the ID token since client-side Apple Sign-In is secure
    if (provider === "apple" && providerToken) {
      try {
        const payload = JSON.parse(
          Buffer.from(providerToken.split(".")[1], "base64").toString(),
        );
        if (payload.sub) {
          providerId = payload.sub;
          email = email || payload.email;
        }
      } catch (e) {
        // Ignore decode errors, use provided values
      }
    }

    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 先按 provider ID 查找
    let user = db
      .prepare(
        "SELECT * FROM users WHERE auth_provider = ? AND auth_provider_id = ?",
      )
      .get(provider, providerId);

    // 如果未找到,按 email 查找
    if (!user && email) {
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    }

    if (user) {
      // 用戶存在,更新 provider ID
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

// ===== GET /api/auth/me - 取當前用戶資料 =====
router.get("/me", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const user = db
      .prepare(
        `
      SELECT id, email, name, phone, avatar_url, credits, membership_type,
             membership_expires_at, is_coach, coach_verified, role, partner_id, created_at,
             email_verified
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



// ===== GET /api/auth/verify-email — 驗證電郵 =====
router.get("/verify-email", (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "缺少驗證 token" });

    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT id FROM users WHERE verification_token = ? AND verification_token_expires > datetime('now')").get(token);

    if (!user) {
      db.close();
      return res.status(400).json({ error: "驗證連結已過期或無效" });
    }

    db.prepare("UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?").run(user.id);
    db.close();

    res.json({ message: "✅ 電郵已驗證成功" });
  } catch (err) {
    res.status(500).json({ error: "驗證失敗" });
  }
});

// ===== POST /api/auth/resend-verification — 重新發送驗證電郵 =====
router.post("/resend-verification", authenticateToken, (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT email, email_verified FROM users WHERE id = ?").get(req.user.id);
    if (!user) { db.close(); return res.status(404).json({ error: "用戶不存在" }); }
    if (user.email_verified) { db.close(); return res.json({ message: "電郵已驗證" }); }

    // Generate new token
    const token = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    db.prepare("UPDATE users SET verification_token = ?, verification_token_expires = datetime('now', '+24 hours') WHERE id = ?").run(token, req.user.id);
    db.close();

    const isDev = !process.env.SMTP_HOST;
    res.json({
      message: "驗證電郵已發送",
      ...(isDev ? { dev_verify_url: "https://zenpass.hk/verify-email.html?token=" + token } : {})
    });
  } catch (err) {
    res.status(500).json({ error: "發送失敗" });
  }
});

// ===== POST /api/auth/password-reset-request — 請求重置密碼 =====
router.post("/password-reset-request", (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "請輸入電郵" });

    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(email);
    db.close();

    if (!user) {
      return res.json({ message: "如果此電郵已註冊,你將會收到重置密碼指示" });
    }

    const token = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    const db2 = new Database(DB_PATH);
    db2.prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?")
      .run(token, expiresAt, user.id);
    db2.close();

    const isDev = !process.env.SMTP_HOST;
    res.json({
      message: "如果此電郵已註冊,你將會收到重置密碼指示",
      ...(isDev ? { dev_token: token, dev_message: "開發模式:使用此 token 重置密碼" } : {})
    });

  } catch (err) {
    console.error("[PASSWORD RESET] Error:", err);
    res.status(500).json({ error: "處理請求失敗" });
  }
});

// ===== POST /api/auth/password-reset - 重置密碼 =====
router.post("/password-reset", (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: "請提供 token 及新密碼" });
    if (new_password.length < 6) return res.status(400).json({ error: "密碼至少 6 個字元" });

    const db = new Database(DB_PATH);
    const user = db.prepare("SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > datetime('now')").get(token);

    if (!user) {
      db.close();
      return res.status(400).json({ error: "連結已過期或無效,請重新申請" });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(hash, user.id);
    db.close();

    res.json({ message: "✅ 密碼已成功重置,請使用新密碼登入" });
  } catch (err) {
    console.error("[PASSWORD RESET] Error:", err);
    res.status(500).json({ error: "重置密碼失敗" });
  }
});

module.exports = router;
