/**
 * ZenPass 禪流 - 認證路由
 * 註冊、登入、第三方登入
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { generateToken, authenticateToken, setAuthCookie, clearAuthCookie } = require("../middleware/auth");
const { emailNotification } = require("../services/notification");

const { OAuth2Client } = require("google-auth-library");

const router = express.Router();
const rateLimit = require("express-rate-limit");

// 6 位電郵驗證碼（加密隨機）
function genVerifyCode() {
  return String(require("crypto").randomInt(100000, 1000000));
}

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id) || req.ip,
  message: { success: false, error: "嘗試太頻繁，請 15 分鐘後再試" },
});
const resendVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id) || req.ip,
  message: { success: false, error: "重發太頻繁，請一小時後再試" },
});

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

// 🔒 2026-10-19：密碼強度（至少 8 位，須有英文字母及數字）
function isStrongPassword(pw) {
  return (
    typeof pw === "string" &&
    pw.length >= 8 &&
    /[A-Za-z]/.test(pw) &&
    /[0-9]/.test(pw)
  );
}
const STRONG_PW_MSG = "密碼至少 8 個字元，並需包含英文字母及數字";

// ===== POST /api/auth/register - 電郵註冊 =====
router.post("/register", (req, res) => {
  try {
    const {
      email,
      password,
      name,
      phone,
      ref,
      invite_code,
      birth_year,
      gender,
      emergency_name,
      emergency_phone,
      health_declared,
    } = req.body;

    // 🔒 2026-10-24：上線開關 —— 未上架期間暫停公開註冊
    // 允許：allow_domains 內嘅電郵，或持有邀請碼；主要管理員可喺後台一鍵全面開放
    try {
      const { canRegister } = require("../services/launch-mode");
      const gate = canRegister(email, invite_code);
      if (!gate.allowed) {
        return res.status(403).json({
          success: false,
          code: gate.code || "REGISTRATION_CLOSED",
          error: gate.notice || "系統測試中，暫停公開註冊。",
        });
      }
    } catch (e) {
      console.error("[REGISTER GATE] error:", e.message);
    }

    // 驗證
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, error: "請填寫姓名、電郵和密碼" });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ success: false, error: STRONG_PW_MSG });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: "電郵格式不正確" });
    }
    // 2026-10-24：電話改為必填（8 位香港號碼，可帶 +852／空格／-）
    const normPhone = String(phone || "").replace(/[^\d]/g, "").replace(/^852/, "").replace(/^0/, "");
    if (!normPhone) {
      return res.status(400).json({ success: false, error: "請填寫電話號碼", code: "PHONE_REQUIRED" });
    }
    if (normPhone.length !== 8) {
      return res.status(400).json({ success: false, error: "電話號碼格式不正確（香港 8 位數字）", code: "PHONE_INVALID" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    // 檢查電郵是否已註冊
    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);
    if (existing) {

      return res.status(409).json({ success: false, error: "此電郵已經註冊" });
    }

    // 建立用戶
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const maxS =
      db
        .prepare(
          "SELECT MAX(CAST(SUBSTR(user_reference, 4) AS INTEGER)) as m FROM users WHERE user_reference GLOB 'US-[0-9]*'",
        )
        .get().m || 0;
    const userRef = "US-" + String(maxS + 1).padStart(4, "0");

    // 生成驗證 token（連結 24 小時）+ 6 位驗證碼（10 分鐘）
    const verificationToken = require("crypto").randomBytes(24).toString("hex");
    const verificationCode = genVerifyCode();

    db.prepare(
      `
      INSERT INTO users (id, user_reference, email, password_hash, name, phone, auth_provider, email_verified,
                         verification_token, verification_token_expires, verification_code, verification_code_expires,
                         birth_year, gender, emergency_name, emergency_phone, health_declared, health_declared_at)
      VALUES (?, ?, ?, ?, ?, ?, 'email', 0, ?, datetime('now', '+24 hours'), ?, datetime('now', '+10 minutes'),
              ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      userRef,
      email,
      passwordHash,
      name,
      normPhone,
      verificationToken,
      verificationCode,
      birth_year ? parseInt(birth_year) || null : null,
      gender ? String(gender).slice(0, 12) : null,
      emergency_name ? String(emergency_name).slice(0, 60) : null,
      emergency_phone ? String(emergency_phone).replace(/[^\d+]/g, "").slice(0, 20) : null,
      health_declared ? 1 : 0,
      health_declared ? new Date().toISOString() : null,
    );

    // ⚡ 訪客帳號偵測（2026-10-23）：同一電話已有「免註冊」預約帳號 → 通知 admin 合併
    try {
      if (phone) {
        const norm = (x) => String(x || "").replace(/[^\d]/g, "").replace(/^852/, "").replace(/^0/, "");
        const mine = norm(phone);
        if (mine.length === 8) {
          const guest = db
            .prepare("SELECT id, name, phone FROM users WHERE lead_source = 'guest_checkout' AND phone IS NOT NULL")
            .all()
            .find((u) => norm(u.phone) === mine);
          if (guest) {
            const { notifyAdmins } = require("../services/admin-alerts");
            notifyAdmins("guest.merge_needed", {
              message:
                `🔗 同一電話有新註冊，可合併訪客預約\n電話：${phone}\n訪客帳號：${guest.name}\n新帳號：${name}（${email}）\n請到 Admin → 用戶 合併`,
            });
          }
        }
      }
    } catch (e) {
      console.error("guest merge detect failed:", e.message);
    }

    // 🎁 推薦碼：註冊時帶入，驗證電郵後自動入賬
    const refCode = String(ref || "").trim();
    if (refCode) {
      const rc = db.prepare("SELECT user_id FROM referral_codes WHERE code = ?").get(refCode);
      if (rc && rc.user_id !== id) {
        db.prepare("UPDATE users SET pending_referral_code = ? WHERE id = ?").run(refCode, id);
      }
    }

    const user = db
      .prepare(
        "SELECT id, email, name, phone, credits, membership_type, email_verified, created_at FROM users WHERE id = ?",
      )
      .get(id);

    const token = generateToken(user);

    const isDev =
      process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_RESET_TOKEN === "1";
    // Set HTTP-only cookie (dual mode: also returns token in JSON)
    setAuthCookie(res, token);

    if (!isDev) {
      const base = process.env.PUBLIC_BASE_URL || "https://zenpass.hk";
      const vlink = `${base}/v2/verify-email.html?token=${encodeURIComponent(verificationToken)}`;
      emailNotification(
        email,
        "ZenPass 禪流 — 驗證你嘅電郵",
        `<div style="font-family:system-ui,-apple-system,'PingFang HK',sans-serif;max-width:520px;margin:auto;color:#222">
          <h2 style="color:#f06030">歡迎加入 ZenPass 禪流</h2>
          <p>你好${name}，多謝你註冊！你嘅驗證碼（10 分鐘內有效）：</p>
          <p style="font-size:28px;font-weight:800;letter-spacing:8px;color:#f06030;margin:10px 0">${verificationCode}</p>
          <p>或者撳以下按鈕驗證（連結 24 小時內有效）：</p>
          <p><a href="${vlink}" style="display:inline-block;background:#f06030;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">驗證電郵</a></p>
          <p style="color:#888;font-size:13px">如非本人操作，可以忽略呢封電郵。</p>
        </div>`,
      ).catch((e) => console.error("[REGISTER] verify email error:", e.message));
    }

    res.status(201).json({
      message: "註冊成功",
      token,
      user,
      ...(isDev ? { dev_verify_url: `https://zenpass.hk/v2/verify-email.html?token=${verificationToken}`, dev_verify_code: verificationCode } : {})
    });
  } catch (err) {
    console.error("註冊錯誤:", err);
    res.status(500).json({ success: false, error: "註冊失敗,請稍後再試" });
  }
});

// ===== POST /api/auth/login - 電郵登入 =====
// 登入失敗節流（按 email，記憶體；重啟清零）
const loginFailures = new Map();
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function loginBlocked(email) {
  const rec = loginFailures.get(email);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(email);
    return false;
  }
  return rec.count >= LOGIN_MAX_FAILS;
}
function recordLoginFailure(email) {
  const rec = loginFailures.get(email);
  if (!rec || Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(email, { count: 1, firstAt: Date.now() });
  } else {
    rec.count++;
  }
}
function clearLoginFailures(email) {
  loginFailures.delete(email);
}


router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "請輸入電郵和密碼" });
    }

    const db = getDb();
    db.pragma("foreign_keys = ON");

    const emailKey = String(email).trim().toLowerCase();
    const attemptKey = emailKey + "|" + (req.ip || "");
    if (loginBlocked(attemptKey)) {
      return res.status(429).json({
        success: false,
        error: "登入嘗試太多次，請 15 分鐘後再試",
      });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({ success: false, error: "電郵或密碼不正確" });
    }

    // Check if password login is allowed
    if (user.auth_provider !== "email") {

      return res.status(401).json({
        error: `此帳戶使用 ${user.auth_provider === "apple" ? "Apple" : "Google"} 登入,請使用該方式登入`,
      });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({ success: false, error: "電郵或密碼不正確" });
    }

    // 🔒 2026-10-24：帳號被停用即唔可以登入（主要管理員可喺後台停用／刪除）
    if (user.is_active !== undefined && Number(user.is_active) === 0) {
      return res.status(403).json({
        success: false,
        error: "此帳號已被停用，請聯絡主要管理員",
        code: "ACCOUNT_DISABLED",
      });
    }

    clearLoginFailures(attemptKey);
    const token = generateToken(user);

    const { password_hash, ...userData } = user;

    // Set HTTP-only cookie (dual mode: also returns token in JSON)
    setAuthCookie(res, token);

    res.json({
      message: "登入成功",
      token,
      user: userData,
    });
  } catch (err) {
    console.error("登入錯誤:", err);
    res.status(500).json({ success: false, error: "登入失敗,請稍後再試" });
  }
});

// ===== POST /api/auth/social - Apple / Google 第三方登入 =====
router.post("/social", async (req, res) => {
  // 🚫 安全（2026-10-19）：呢個 endpoint 會信任客戶端傳來嘅 providerId／email（唔驗證簽名），
  // 只要 POST {provider:"google", providerId:"x", email:"admin@zenpass.hk"} 就可以登入任何帳戶。
  // 目前前端冇用；待正式接 Google/Apple 簽名驗證後再開（設 ENABLE_SOCIAL_LOGIN=1）。
  if (process.env.ENABLE_SOCIAL_LOGIN !== "1") {
    return res.status(403).json({
      success: false,
      code: "SOCIAL_LOGIN_DISABLED",
      error: "第三方登入暫停用，請用電郵登入。",
    });
  }
  try {
    let { provider, providerId, email, name, providerToken } = req.body;

    if (!provider || !providerId) {
      return res.status(400).json({ success: false, error: "缺少第三方登入資料" });
    }
    if (!["apple", "google"].includes(provider)) {
      return res.status(400).json({ success: false, error: "不支援的登入方式" });
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
        return res.status(401).json({ success: false, error: "Google 身份驗證失敗" });
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

    const db = getDb();
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

      // Set HTTP-only cookie (dual mode)
      setAuthCookie(res, token);

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

    const token = generateToken(user);

    // Set HTTP-only cookie (dual mode)
    setAuthCookie(res, token);

    res.status(201).json({
      message: "註冊成功",
      token,
      user,
    });
  } catch (err) {
    console.error("第三方登入錯誤:", err);
    res.status(500).json({ success: false, error: "登入失敗" });
  }
});

// ===== GET /api/auth/me - 取當前用戶資料 =====
router.get("/me", authenticateToken, (req, res) => {
  try {
    const db = getDb();
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

    if (!user) {
      return res.status(404).json({ success: false, error: "用戶不存在" });
    }

    res.json({ user });
  } catch (err) {
    console.error("取用戶資料錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得用戶資料" });
  }
});

// ===== GET /api/auth/verify-email — 驗證電郵 =====
router.get("/verify-email", (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, error: "缺少驗證 token" });

    const db = getDb();
    const user = db.prepare("SELECT id FROM users WHERE verification_token = ? AND verification_token_expires > datetime('now')").get(token);

    if (!user) {

      return res.status(400).json({ success: false, error: "驗證連結已過期或無效" });
    }

    db.prepare("UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?").run(user.id);

    // 🎁 自動兌換註冊時帶入嘅推薦碼（雙方各 5 Credits）
    const rr = require("../services/referral-service").autoRedeemPending(user.id);

    res.json({
      message: rr.redeemed ? "✅ 電郵已驗證，推薦獎賞 5 Credits 已存入錢包" : "✅ 電郵已驗證成功",
      referral_redeemed: !!rr.redeemed,
      referral_credits: rr.redeemed ? 5 : 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "驗證失敗" });
  }
});

// ===== POST /api/auth/verify-code — 用 6 位驗證碼驗證電郵 =====
router.post("/verify-code", authenticateToken, verifyCodeLimiter, (req, res) => {
  try {
    const code = String((req.body && req.body.code) || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "請輸入 6 位數字驗證碼" });
    }

    const db = getDb();
    const user = db
      .prepare(
        "SELECT email_verified, verification_code, verification_code_expires FROM users WHERE id = ?",
      )
      .get(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: "用戶不存在" });
    if (user.email_verified) {
      return res.json({ success: true, message: "電郵已驗證" });
    }
    if (!user.verification_code || user.verification_code !== code) {
      return res.status(400).json({ success: false, error: "驗證碼不正確" });
    }

    const exp = user.verification_code_expires
      ? new Date(String(user.verification_code_expires).replace(" ", "T") + "Z")
      : null;
    if (exp && !isNaN(exp) && exp < new Date()) {
      return res.status(400).json({ success: false, error: "驗證碼已過期，請重新發送" });
    }

    db.prepare(
      `UPDATE users SET email_verified = 1, verification_code = NULL, verification_code_expires = NULL,
         verification_token = NULL, verification_token_expires = NULL WHERE id = ?`,
    ).run(req.user.id);

    // 🎁 自動兌換推薦碼
    const rr2 = require("../services/referral-service").autoRedeemPending(req.user.id);

    res.json({
      success: true,
      message: rr2.redeemed ? "✅ 電郵驗證成功，推薦獎賞 5 Credits 已存入錢包" : "✅ 電郵驗證成功",
      referral_redeemed: !!rr2.redeemed,
      referral_credits: rr2.redeemed ? 5 : 0,
    });
  } catch (err) {
    console.error("verify-code error:", err.message);
    res.status(500).json({ success: false, error: "驗證失敗" });
  }
});

// ===== POST /api/auth/resend-verification — 重新發送驗證電郵 =====
router.post("/resend-verification", authenticateToken, resendVerifyLimiter, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT email, email_verified FROM users WHERE id = ?").get(req.user.id);
    if (!user) { return res.status(404).json({ success: false, error: "用戶不存在" }); }
    if (user.email_verified) { return res.json({ message: "電郵已驗證" }); }

    // Generate new token + 6 位驗證碼
    // 🔒 2026-10-19：用加密隨機 token（原本 Math.random 可預測）
    const token = require("crypto").randomBytes(32).toString("hex");
    const code = genVerifyCode();
    db.prepare(
      "UPDATE users SET verification_token = ?, verification_token_expires = datetime('now', '+24 hours'), verification_code = ?, verification_code_expires = datetime('now', '+10 minutes') WHERE id = ?",
    ).run(token, code, req.user.id);

    // 🔒 2026-10-19：只有明確開發環境才回傳 token。原本 SMTP 一有問題（isDev=true）
    // 就會將有效 reset token 回俾任何請求者 → 可接管任何帳戶（包括 admin）。
    const isDev =
      process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_RESET_TOKEN === "1";
    if (!isDev) {
      const base = process.env.PUBLIC_BASE_URL || "https://zenpass.hk";
      const vlink = `${base}/v2/verify-email.html?token=${encodeURIComponent(token)}`;
      emailNotification(
        user.email,
        "ZenPass 禪流 — 驗證你嘅電郵",
        `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#222">
          <h2 style="color:#f06030">驗證你嘅電郵</h2>
          <p>你嘅驗證碼（10 分鐘內有效）：</p>
          <p style="font-size:28px;font-weight:800;letter-spacing:8px;color:#f06030;margin:10px 0">${code}</p>
          <p>或者撳以下按鈕驗證（連結 24 小時內有效）：</p>
          <p><a href="${vlink}" style="display:inline-block;background:#f06030;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">驗證電郵</a></p>
        </div>`,
      ).catch((e) => console.error("[RESEND] verify email error:", e.message));
    }
    res.json({
      message: "驗證電郵已發送",
      ...(isDev ? { dev_verify_url: `https://zenpass.hk/v2/verify-email.html?token=${token}`, dev_verify_code: code } : {})
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "發送失敗" });
  }
});

// ===== POST /api/auth/password-reset-request — 請求重置密碼 =====
router.post("/password-reset-request", (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "請輸入電郵" });

    const db = getDb();
    const user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(email);

    if (!user) {
      return res.json({ message: "如果此電郵已註冊,你將會收到重置密碼指示" });
    }

    // 🔒 2026-10-19：加密隨機 token（原本 Math.random 可預測）
    const token = require("crypto").randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    // Use the already-opened db connection above
    db.prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?")
      .run(token, expiresAt, user.id);

    // 🔒 2026-10-19：生產環境永不回傳 token（原本 SMTP 一壞就泄漏有效 reset token → 可接管任何帳戶）
    const isDev =
      process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_RESET_TOKEN === "1";
    if (!isDev) {
      const base = process.env.PUBLIC_BASE_URL || "https://zenpass.hk";
      const link = `${base}/v2/reset.html?token=${encodeURIComponent(token)}`;
      emailNotification(
        email,
        "ZenPass 禪流 — 重設密碼",
        `<div style="font-family:system-ui,-apple-system,'PingFang HK',sans-serif;max-width:520px;margin:auto;color:#222">
          <h2 style="color:#f06030">重設密碼</h2>
          <p>你好${user.name ? " " + user.name : ""}，</p>
          <p>我們收到你嘅 ZenPass 密碼重設要求。撳以下按鈕設定新密碼（連結 1 小時內有效）：</p>
          <p><a href="${link}" style="display:inline-block;background:#f06030;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">重設密碼</a></p>
          <p style="color:#888;font-size:13px">如非本人操作，可以忽略呢封電郵。</p>
        </div>`,
      ).catch((e) => console.error("[PASSWORD RESET] email error:", e.message));
    }

    res.json({
      message: "如果此電郵已註冊,你將會收到重置密碼指示",
      ...(isDev ? { dev_token: token, dev_message: "開發模式:使用此 token 重置密碼" } : {})
    });

  } catch (err) {
    console.error("[PASSWORD RESET] Error:", err);
    res.status(500).json({ success: false, error: "處理請求失敗" });
  }
});

// ===== POST /api/auth/password-reset - 重置密碼 =====
router.post("/password-reset", (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ success: false, error: "請提供 token 及新密碼" });
    if (!isStrongPassword(new_password)) return res.status(400).json({ success: false, error: STRONG_PW_MSG });

    const db = getDb();
    const user = db.prepare("SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > datetime('now')").get(token);

    if (!user) {

      return res.status(400).json({ success: false, error: "連結已過期或無效,請重新申請" });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, token_version = COALESCE(token_version,0) + 1, updated_at = datetime('now') WHERE id = ?")
      .run(hash, user.id);

    res.json({ message: "✅ 密碼已成功重置,請使用新密碼登入" });
  } catch (err) {
    console.error("[PASSWORD RESET] Error:", err);
    res.status(500).json({ success: false, error: "重置密碼失敗" });
  }
});

// ===== POST /api/auth/change-password — 已登入用戶更改密碼 =====
router.post("/change-password", authenticateToken, (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password) return res.status(400).json({ success: false, error: "請提供新密碼" });
    if (!isStrongPassword(new_password)) return res.status(400).json({ success: false, error: STRONG_PW_MSG });

    const db = getDb();
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE users SET password_hash = ?, token_version = COALESCE(token_version,0) + 1, updated_at = datetime('now') WHERE id = ?")
      .run(hash, req.user.id);

    res.json({ message: "✅ 密碼已更新" });
  } catch (err) {
    console.error("[CHANGE PASSWORD] Error:", err);
    res.status(500).json({ success: false, error: "更改密碼失敗" });
  }
});

// ===== POST /api/auth/logout - 登出 =====
router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ message: "已登出" });
});

module.exports = router;
