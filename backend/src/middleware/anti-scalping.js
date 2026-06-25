/**
 * ZenPass 禪流 — Anti-Scalping 反炒場系統
 *
 * IPO-ready：防止 Bot 搶位、濫用預約、帳戶共享等炒場行為
 *
 * 核心機制：
 * 1. 用戶層級 Rate Limiting（每用戶每分鐘 N 次，獨立於全局 rate limit）
 * 2. Bot 檢測（User-Agent 分析 + 異常快速請求模式）
 * 3. 可疑活動積分系統（累積分數 → 自動封鎖）
 * 4. 帳戶停權管理（暫停 24h / 360d）
 * 5. 同一帳戶多裝置偵測（警告 + 限制）
 * 6. Booking 特定保護（同一時段重複搶位、極短時間內多次預約）
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// ===== 設定 =====
const CONFIG = {
  // 用戶層級 Rate Limit（每個 user_id，獨立 window）
  USER_RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 分鐘 window
  USER_RATE_LIMIT_MAX: 30, // 每分鐘最多 30 個 request

  // Booking 特定限制
  BOOKING_RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 分鐘
  BOOKING_RATE_LIMIT_MAX: 5, // 每分鐘最多 5 次預約嘗試

  // 可疑活動積分
  SUSPICIOUS_THRESHOLD_24H: 20, // 24 小時內累積 20 分 → 暫停 24 小時
  SUSPICIOUS_THRESHOLD_360D: 50, // 24 小時內累積 50 分 → 暫停 360 日

  // Bot 檢測
  BOT_USER_AGENT_PATTERNS: [
    /python-requests/i,
    /curl\//i,
    /wget/i,
    /java/i,
    /okhttp/i,
    /scrapy/i,
    /node-fetch/i,
    /go-http-client/i,
    /axios/i,
    /aiohttp/i,
    /httpx/i,
    /urllib/i,
    /ruby/i,
    /perl/i,
    /php-script/i,
    /httpclient/i,
    /selenium/i,
    /puppeteer/i,
    /playwright/i,
    /headless/i,
    /phantomjs/i,
    /lighthouse/i,
    /slackbot/i,
    /slack-http/i,
    /discordbot/i,
    /twitterbot/i,
    /facebookbot/i,
    /whatsapp/i,
  ],

  // 獎勵點數（每個違規行為加幾多分）
  SCORES: {
    SUSPICIOUS_UA: 5, // 疑似 Bot User-Agent
    KNOWN_BOT_UA: 10, // 明確 Bot User-Agent
    RAPID_BOOKING: 3, // 極短時間內多次預約
    RAPID_REQUESTS: 2, // 超出 rate limit
    DUPLICATE_SESSION: 2, // 同一用戶多裝置
    INVALID_JWT_BURST: 3, // 短時間內多次無效 JWT
    SUSPECTED_FARMING: 8, // 疑似帳號農場模式
  },
};

// ===== Database Helpers =====
function _getDb() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  return db;
}

// ===== Suspicious Activity 記錄 =====
function logSuspiciousActivity({
  user_id = null,
  ip = null,
  action,
  score,
  reason,
  details = {},
  req = null,
}) {
  try {
    const db = _getDb();
    db.prepare(
      `INSERT INTO suspicious_activity (user_id, ip_address, action_type, score, reason, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      user_id,
      ip || (req && req.ip) || null,
      action,
      score,
      reason,
      JSON.stringify(details),
    );

    // 累計分數：計算過去 24h 內 total_score，夠 threshold 就停權
    if (user_id) {
      const totalScore = db
        .prepare(
          `SELECT COALESCE(SUM(score), 0) as total FROM suspicious_activity
           WHERE user_id = ? AND created_at > datetime('now', '-24 hours')`,
        )
        .get(user_id).total;

      // Check if this user is already suspended
      const activeSuspension = db
        .prepare(
          `SELECT id FROM user_suspensions
           WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')`,
        )
        .get(user_id);

      if (!activeSuspension && totalScore >= CONFIG.SUSPICIOUS_THRESHOLD_360D) {
        suspendUser(user_id, 360, `累積可疑分數 ${totalScore}（過 ${CONFIG.SUSPICIOUS_THRESHOLD_360D} 上限）`);
      } else if (!activeSuspension && totalScore >= CONFIG.SUSPICIOUS_THRESHOLD_24H) {
        suspendUser(user_id, 1, `累積可疑分數 ${totalScore}（過 ${CONFIG.SUSPICIOUS_THRESHOLD_24H} 上限）`);
      }
    }

    db.close();
  } catch (err) {
    console.error("[ANTI-SCALPING] Log error:", err.message);
  }
}

// ===== 用戶停權 =====
function suspendUser(userId, durationDays, reason) {
  try {
    const db = _getDb();

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // 如果已經有 active suspension 就 extend 佢
    const existing = db
      .prepare(
        `SELECT id, expires_at FROM user_suspensions
         WHERE user_id = ? AND status = 'active'`,
      )
      .get(userId);

    if (existing) {
      const existingExpiry = new Date(existing.expires_at);
      const newExpiry = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
      const finalExpiry = existingExpiry > newExpiry ? existingExpiry : newExpiry;

      db.prepare(
        `UPDATE user_suspensions SET expires_at = ?, reason = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        finalExpiry.toISOString(),
        `${reason} (extended by ${durationDays}d, original: ${existing.expires_at})`,
        existing.id,
      );

      console.warn(`🔒 [ANTI-SCALPING] 用戶 ${userId} 停權期延長至 ${finalExpiry.toISOString()} — ${reason}`);
    } else {
      db.prepare(
        `INSERT INTO user_suspensions (user_id, status, reason, expires_at, created_at)
         VALUES (?, 'active', ?, ?, datetime('now'))`,
      ).run(userId, reason, expiresAt);

      console.warn(`🔒 [ANTI-SCALPING] 用戶 ${userId} 已被暫停 ${durationDays} 天 — ${reason}`);
    }

    // 記錄 audit
    const { v4: uuidv4 } = require("uuid");
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, description, created_at)
       VALUES (?, 'user.suspended', 'user', ?, ?, ?, datetime('now'))`,
    ).run(uuidv4(), userId, userId, `系統自動停權: ${reason}`);

    db.close();
    return true;
  } catch (err) {
    console.error("[ANTI-SCALPING] Suspend error:", err.message);
    return false;
  }
}

// ===== 檢查用戶是否被停權 =====
function checkUserSuspension(userId) {
  try {
    const db = _getDb();
    const suspension = db
      .prepare(
        `SELECT id, reason, expires_at, created_at FROM user_suspensions
         WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')`,
      )
      .get(userId);

    if (suspension) {
      const daysLeft = Math.ceil(
        (new Date(suspension.expires_at) - new Date()) / (1000 * 60 * 60 * 24),
      );
      db.close();
      return {
        suspended: true,
        reason: suspension.reason,
        expires_at: suspension.expires_at,
        days_left: daysLeft,
      };
    }

    // 清理已過期嘅 suspension
    db.prepare(
      `UPDATE user_suspensions SET status = 'expired' WHERE expires_at <= datetime('now') AND status = 'active'`,
    ).run();
    db.close();

    return { suspended: false };
  } catch (err) {
    console.error("[ANTI-SCALPING] Check suspension error:", err.message);
    return { suspended: false };
  }
}

// ===== Bot User-Agent 檢測 =====
function detectBotUA(userAgent) {
  if (!userAgent) {
    return { isBot: false, score: 0, reason: null };
  }

  const ua = userAgent.trim();

  // 極短 UA 長度（< 30 chars）→ 高機率 Bot
  if (ua.length < 30) {
    return {
      isBot: true,
      score: CONFIG.SCORES.SUSPICIOUS_UA,
      reason: `Suspicious UA: too short (${ua.length} chars): "${ua.slice(0, 50)}"`,
    };
  }

  // 逐個 pattern 配對
  for (const pattern of CONFIG.BOT_USER_AGENT_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        isBot: true,
        score: CONFIG.SCORES.KNOWN_BOT_UA,
        reason: `Known bot UA matched: "${pattern}" — "${ua.slice(0, 80)}"`,
      };
    }
  }

  return { isBot: false, score: 0, reason: null };
}

// ===== 用戶層級 Request Limiter（in-memory sliding window）=====
const userRequestLog = new Map();

function checkUserRateLimit(userId, windowMs, maxRequests) {
  const key = `${userId}:${windowMs}`;
  const now = Date.now();

  if (!userRequestLog.has(key)) {
    userRequestLog.set(key, []);
  }

  const timestamps = userRequestLog.get(key);

  // Clean old entries
  while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
    timestamps.shift();
  }

  if (timestamps.length >= maxRequests) {
    return { limited: true, count: timestamps.length, max: maxRequests };
  }

  timestamps.push(now);
  return { limited: false, count: timestamps.length, max: maxRequests };
}

// ===== 清理過期嘅 user request log（每 60 秒）=====
function cleanupUserRequestLog() {
  const now = Date.now();
  for (const [key, timestamps] of userRequestLog.entries()) {
    while (timestamps.length > 0 && timestamps[0] < now - 60000) {
      timestamps.shift();
    }
    if (timestamps.length === 0) {
      userRequestLog.delete(key);
    }
  }
}
setInterval(cleanupUserRequestLog, 60000);

// ===== Express Middleware =====

/**
 * 反炒場中介軟體（主要出口）
 *
 * 用法: router.post("/bookings", authenticateToken, antiScalping, handler)
 *       app.use("/api/bookings", antiScalping)
 */
function antiScalping(req, res, next) {
  const userAgent = req.headers["user-agent"] || "";
  const userId = req.user ? req.user.id : null;
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  // When mounted on /api/bookings, originalUrl preserves the full path
  const fullPath = req.originalUrl || req.url || req.path || "";
  const method = req.method;

  // ═══ 1. Bot UA 檢測 ═══
  const botCheck = detectBotUA(userAgent);
  if (botCheck.isBot) {
    logSuspiciousActivity({
      user_id: userId,
      ip,
      action: "bot_ua_detected",
      score: botCheck.score,
      reason: botCheck.reason,
      details: { userAgent, path, method },
      req,
    });

    // 限制 Bot UA 嘅請求
    return res.status(429).json({
      error: "偵測到自動化工具，已被限制存取。如有疑問請聯絡 info@zenpass.hk",
      code: "BOT_DETECTED",
    });
  }

  // ═══ 2. 按 IP Rate Limit（針對所有 API request） ═══
  const ipLimitResult = checkUserRateLimit(
    `ip:${ip}`,
    CONFIG.USER_RATE_LIMIT_WINDOW_MS,
    CONFIG.USER_RATE_LIMIT_MAX,
  );

  if (ipLimitResult.limited) {
    logSuspiciousActivity({
      user_id: null,
      ip,
      action: "rate_limit_exceeded",
      score: 1,
      reason: `IP rate limit: ${ipLimitResult.count}/${ipLimitResult.max} in ${CONFIG.USER_RATE_LIMIT_WINDOW_MS / 1000}s`,
      details: { path: fullPath, method, count: ipLimitResult.count },
      req,
    });

    return res.status(429).json({
      error: "請求次數過多，請稍後再試",
      code: "RATE_LIMITED",
      retry_after: Math.ceil(CONFIG.USER_RATE_LIMIT_WINDOW_MS / 1000),
    });
  }

  // ═══ 3. 預約保護（POST booking） ═══
  // Booking 特定限制用 IP（因為 user 未 auth），每個 IP 每分鐘最多 N 次
  const isBookingEndpoint = (fullPath.includes("/api/bookings") || fullPath.includes("/bookings")) && method === "POST";
  if (isBookingEndpoint) {
    const bookingLimitResult = checkUserRateLimit(
      `booking:${ip}`,
      CONFIG.BOOKING_RATE_LIMIT_WINDOW_MS,
      CONFIG.BOOKING_RATE_LIMIT_MAX,
    );

    if (bookingLimitResult.limited) {
      logSuspiciousActivity({
        user_id: null,
        ip,
        action: "rapid_booking_attempts",
        score: CONFIG.SCORES.RAPID_BOOKING,
        reason: `${bookingLimitResult.count} booking POSTs from IP ${ip} in ${CONFIG.BOOKING_RATE_LIMIT_WINDOW_MS / 1000}s`,
        details: { path: fullPath, count: bookingLimitResult.count },
        req,
      });

      return res.status(429).json({
        error: "預約次數過於頻繁，請稍後再試",
        code: "BOOKING_RATE_LIMITED",
        retry_after: Math.ceil(CONFIG.BOOKING_RATE_LIMIT_WINDOW_MS / 1000),
      });
    }
  }

  next();
}

/**
 * 登入後嘅反炒場檢查（需喺 authenticateToken 之後使用）
 * 用法: router.post("/bookings", authenticateToken, scalpGuard, handler)
 */
function scalpGuard(req, res, next) {
  if (!req.user) {
    return next();
  }

  const userId = req.user.id;
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const fullPath = req.originalUrl || req.url || req.path || "";
  const method = req.method;
  const isBookingEndpoint = (fullPath.includes("/api/bookings") || fullPath.includes("/bookings")) && method === "POST";

  // ═══ A. 檢查用戶停權狀態 ═══
  const suspension = checkUserSuspension(userId);
  if (suspension.suspended) {
    return res.status(403).json({
      error: `帳戶已被暫停使用（剩餘 ${suspension.days_left} 天）`,
      reason: suspension.reason,
      code: "ACCOUNT_SUSPENDED",
      expires_at: suspension.expires_at,
    });
  }

  // ═══ B. 用戶層級 Rate Limit ═══
  const userLimitResult = checkUserRateLimit(
    userId,
    CONFIG.USER_RATE_LIMIT_WINDOW_MS,
    CONFIG.USER_RATE_LIMIT_MAX,
  );

  if (userLimitResult.limited) {
    logSuspiciousActivity({
      user_id: userId,
      ip,
      action: "user_rate_limit_exceeded",
      score: CONFIG.SCORES.RAPID_REQUESTS,
      reason: `User ${userId} rate limit: ${userLimitResult.count}/${userLimitResult.max}`,
      details: { path: fullPath, method, count: userLimitResult.count },
      req,
    });

    return res.status(429).json({
      error: "請求次數過多，請稍後再試。",
      code: "USER_RATE_LIMITED",
      retry_after: Math.ceil(CONFIG.USER_RATE_LIMIT_WINDOW_MS / 1000),
    });
  }

  // ═══ C. Booking 用戶層級限制（已 auth） ═══
  if (isBookingEndpoint) {
    const bookingLimitResult = checkUserRateLimit(
      `user_booking:${userId}`,
      10 * 1000, // 10秒 window
      3, // 最多 3 次
    );

    if (bookingLimitResult.limited) {
      logSuspiciousActivity({
        user_id: userId,
        ip,
        action: "rapid_booking_attempts_auth",
        score: CONFIG.SCORES.RAPID_BOOKING,
        reason: `User ${userId}: ${bookingLimitResult.count} booking POSTs in 10s`,
        details: { count: bookingLimitResult.count },
        req,
      });

      return res.status(429).json({
        error: "預約操作過於頻繁，請稍後再試。",
        code: "USER_BOOKING_LIMITED",
      });
    }
  }

  // ═══ D. IP 帳戶農場檢測 ═══
  try {
    const db = _getDb();
    const ipUsers = db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) as cnt FROM suspicious_activity
         WHERE ip_address = ? AND user_id != ? AND created_at > datetime('now', '-24 hours')`,
      )
      .get(ip, userId);

    if (ipUsers && ipUsers.cnt >= 3) {
      logSuspiciousActivity({
        user_id: userId,
        ip,
        action: "multi_account_ip",
        score: CONFIG.SCORES.SUSPECTED_FARMING,
        reason: `IP ${ip} used by ${ipUsers.cnt} accounts in 24h`,
        details: { account_count: ipUsers.cnt },
        req,
      });
    }
    db.close();
  } catch (err) {
    // non-critical
  }

  // ═══ E. 記錄正常請求（用於統計） ═══
  if (isBookingEndpoint) {
    try {
      const db = _getDb();
      db.prepare(
        `INSERT INTO request_log (user_id, ip_address, path, method, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      ).run(userId, ip, fullPath, method);
      db.close();
    } catch (err) {}
  }

  next();
}

// ===== 管理 API — 查看/解除停權 =====
function getSuspensionRoutes() {
  const express = require("express");
  const router = express.Router();

  // GET /api/anti-scalping/status/:userId — 查看用戶停權狀態
  router.get("/status/:userId", (req, res) => {
    const status = checkUserSuspension(req.params.userId);
    res.json(status);
  });

  // GET /api/anti-scalping/suspicious/:userId — 查看可疑活動
  router.get("/suspicious/:userId", (req, res) => {
    try {
      const db = _getDb();
      const activities = db
        .prepare(
          `SELECT * FROM suspicious_activity
           WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
        )
        .all(req.params.userId);
      db.close();
      res.json({ activities });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/anti-scalping/unsuspend/:userId — 管理員手動解除停權
  router.post("/unsuspend/:userId", (req, res) => {
    try {
      const db = _getDb();
      db.prepare(
        `UPDATE user_suspensions SET status = 'lifted', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'`,
      ).run(req.params.userId);

      const { v4: uuidv4 } = require("uuid");
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, description, created_at)
         VALUES (?, 'admin.unsuspend', 'user', ?, ?, ?, datetime('now'))`,
      ).run(uuidv4(), req.params.userId, req.user?.id || "admin", `管理員手動解除停權: ${req.body.reason || "no reason"}`);

      db.close();
      res.json({ message: "✅ 已解除停權" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/anti-scalping/dashboard — 可疑活動儀表板（past 7 days）
  router.get("/dashboard", (req, res) => {
    try {
      const db = _getDb();
      const stats = db
        .prepare(
          `SELECT action_type, COUNT(*) as count, SUM(score) as total_score
           FROM suspicious_activity
           WHERE created_at > datetime('now', '-7 days')
           GROUP BY action_type ORDER BY total_score DESC`,
        )
        .all();

      const topUsers = db
        .prepare(
          `SELECT user_id, SUM(score) as total_score, COUNT(*) as events
           FROM suspicious_activity
           WHERE created_at > datetime('now', '-7 days') AND user_id IS NOT NULL
           GROUP BY user_id ORDER BY total_score DESC LIMIT 20`,
        )
        .all();

      const activeSuspensions = db
        .prepare(
          `SELECT user_id, reason, expires_at, created_at
           FROM user_suspensions WHERE status = 'active' ORDER BY expires_at DESC`,
        )
        .all();

      db.close();
      res.json({ stats, top_users: topUsers, active_suspensions: activeSuspensions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// ===== 清理 request_log（每 24 小時清理 > 7 天數據）=====
function cleanupRequestLog() {
  try {
    const db = _getDb();
    const result = db
      .prepare("DELETE FROM request_log WHERE created_at < datetime('now', '-7 days')")
      .run();
    if (result.changes > 0) {
      console.log(`[ANTI-SCALPING] Cleaned ${result.changes} old request logs`);
    }
    db.close();
  } catch (err) {
    console.error("[ANTI-SCALPING] Cleanup error:", err.message);
  }
}
setInterval(cleanupRequestLog, 24 * 60 * 60 * 1000);

module.exports = {
  antiScalping,
  scalpGuard,
  checkUserSuspension,
  suspendUser,
  logSuspiciousActivity,
  getSuspensionRoutes,
  cleanupRequestLog,
};
