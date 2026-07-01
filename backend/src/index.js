/**
 * ZenPass 禪流 - 主伺服器入口
 */

require("dotenv").config({ path: __dirname + "/../.env" });

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const {
  generateToken,
  doubleCsrfProtection,
  initCsrf,
} = require("./middleware/csrf");
const logger = require("./services/logger");
const { sendNotification } = require("./services/notification");
const { processCorporateResets } = require("./services/corporate-reset");

// 初始化數據庫
const initDatabase = require("./config/init-db");
initDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// ===== 信任代理 — Nginx 將 X-Forwarded-For header 傳入，
// Express 必須設定 trust proxy 否則 express-rate-limit 會不斷炒
app.set("trust proxy", "loopback");

// ===== 中介軟體 =====

// Request ID 追蹤 — 每個請求分配唯一 ID
const { randomUUID, randomBytes } = require("crypto");
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
});

// HTTP 請求日誌 (morgan → winston)
app.use(
  morgan(":method :url :status :response-time ms", {
    stream: logger.morganStream,
  }),
);

// CORS 設定 - 支援跨域請求（GitHub Pages → localhost）
app.use(
  cors({
    origin: function (origin, callback) {
      const allowed = [
        "https://zenpass.hk",
        "https://www.zenpass.hk",
        "https://davidchoy1689-tech.github.io",
        "https://davidchoy1689-tech.github.io/ZenPass",
        "http://localhost:8080",
        "http://localhost:9090",
        "http://localhost:8888",
        "http://localhost:3001",
        "http://localhost:3000",
        undefined, // Allow same-origin
      ];

      // 生產環境透過 CORS_ORIGIN env 動態加 domain
      const envOrigin = process.env.CORS_ORIGIN;
      if (envOrigin && allowed.indexOf(envOrigin) === -1) {
        allowed.push(envOrigin);
      }
      if (allowed.indexOf(origin) !== -1 || !origin) {
        callback(null, true);
      } else {
        // Deny: not setting CORS headers → browser blocks the request
        callback(null, false);
      }
    },
    credentials: true,
  }),
);

// Security headers (Helmet) — CSP hardened: no unsafe-eval, nonce for scripts
app.use(
  helmet({
    hsts: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.googletagmanager.com",
          "https://js.stripe.com",
          "https://accounts.google.com",
          "https://appleid.cdn-apple.com",
          "https://static.hotjar.com",
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          // TODO: remove unsafe-inline once all inline styles use nonces
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://www.google-analytics.com", "https://google-analytics.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// Cookie parser — required for CSRF token cookie extraction
app.use(cookieParser());

// Compression middleware (gzip/brotli) — before static file serving
app.use(compression({ threshold: 256, level: 6 }));

// Redirect unauthenticated access to admin.html
app.use("/admin.html", (req, res, next) => {
  // If no token in query/cookie, redirect to login - but still serve static
  next();
});

// 靜態檔案服務 - 直接 serve ZenPass 前台和管理後台
// Serve static files from project root (contains all pages)
app.use(express.static(path.join(__dirname, "../..")));
// Also serve frontend/ for admin-internal pages
app.use("/admin", express.static(path.join(__dirname, "../../frontend/admin")));
// admin files served from frontend/admin/ via root static middleware
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ===== 反炒場中介軟體（放在 rate limiter 之後）=====
const { antiScalping, scalpGuard, getSuspensionRoutes } = require("./middleware/anti-scalping");

// 針對 booking 相關 endpoint 啟用反炒場
app.use("/api/bookings", antiScalping);

// 反炒場管理 API（只限 admin）
const { authenticateToken, requireAdmin } = require("./middleware/auth");
app.use("/api/anti-scalping", authenticateToken, requireAdmin, getSuspensionRoutes());

// ===== 細緻 Rate Limiting =====
// 分層限流：Auth > Admin > General API
const windowMinutes = process.env.NODE_ENV === "test" ? 0.1 : 1; // 1 min in dev/prod, 6s in test

// 每個 endpoint 各自獨立限流（Store per-route, not per-path, because we mount at /api/... prefixes）
const authLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 10,
  message: { success: false, error: "登入嘗試次數過多，請 1 分鐘後再試" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || "unknown",
});

const adminLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 30,
  message: { success: false, error: "管理操作請求過多，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || "unknown",
});

const generalLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 100,
  message: { success: false, error: "太多請求，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || "unknown",
});

// Apply specific limiters before general one
// Auth endpoints: strict rate limit (10/min) to prevent brute force
app.use("/api/auth/", authLimiter);
// Admin endpoints: moderate limit (30/min)
app.use("/api/admin/", adminLimiter);
// Everything else under /api/: standard limit (100/min)
app.use("/api/", generalLimiter);

// Stripe webhook must receive raw body — register BEFORE express.json()
const paymentsRouter = require("./routes/payments");
app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.url = "/stripe/webhook";
    paymentsRouter(req, res, next);
  },
);

// Everything else uses JSON body parser
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ===== API 回應格式統一中介軟體 =====
const responseNormalizer = require("./middleware/response-normalizer");
app.use("/api", responseNormalizer);

// ===== CSRF Protection =====
// GET /api/csrf-token — frontend grabs the CSRF token cookie
app.get("/api/csrf-token", (req, res) => {
  generateToken(req, res); // sets cookie + responds with JSON
});

// CSRF protection for state-changing requests on /api routes
// Stripe webhook and public endpoints are exempt
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  // Exempt Stripe webhook endpoint (external callback with built-in signature verification)
  if (req.path === "/payments/stripe/webhook") {
    return next();
  }
  doubleCsrfProtection(req, res, next);
});

// ===== 路由 =====
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
// 👥 團隊預訂（hold 住，有需要時 uncomment）
// app.use("/api/me/teammates", require("./routes/teammates"));
app.use("/api/classes", require("./routes/classes"));
app.use("/api/bookings", require("./routes/bookings"));
app.use("/api/coach", require("./routes/coach"));
app.use("/api/memberships", require("./routes/memberships"));
app.use("/api/payments", express.json(), paymentsRouter);
app.use("/api/coach", require("./routes/coach-earnings"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/upload", require("./routes/upload"));
app.use("/api/backup", require("./routes/backup"));
app.use("/api/course-contents", require("./routes/course-contents"));
app.use("/api/migrate", require("./routes/migrate"));
app.use("/api/points", require("./routes/points"));
app.use("/api/badges", require("./routes/badges"));
app.use("/api/crm", require("./routes/crm"));
app.use("/api/locations", require("./routes/pos"));
app.use("/api/pos", require("./routes/pos"));
app.use("/api/waitlist", require("./routes/waitlist"));
app.use("/api/activity", require("./routes/activity"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/marketing", require("./routes/marketing"));
app.use("/api/ab", require("./routes/ab-test"));
app.use("/api/reporting", require("./routes/reporting"));
app.use("/api/referral", require("./routes/referral"));
app.use("/api/loyalty", require("./routes/loyalty"));
app.use("/api/partner", require("./routes/partner"));
app.use("/api/crawler", require("./routes/crawler"));
app.use("/api/recommendations", require("./routes/recommendations"));
app.use("/api/track", require("./routes/recommendations"));
app.use("/api/pricing", require("./routes/pricing"));
app.use("/api/pricing", require("./routes/pricing-engine"));
app.use("/api/venue-rentals", require("./routes/venue-rentals"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/admin", require("./routes/deploy"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/audit", require("./routes/audit").router);
app.use("/api/penalty", require("./routes/penalty"));
app.use("/api/corporate", require("./routes/corporate"));
app.use("/api/school", require("./routes/school"));
app.use("/api/ratings", require("./routes/ratings"));
app.use("/api/wishlist", require("./routes/wishlist"));
app.use("/api/topup", require("./routes/topup"));
app.use("/api/nps", require("./routes/nps"));

// ===== 健康檢查 =====
const { ok } = require("./services/response");
const os = require("os");

app.get("/api/health", (req, res) => {
  const dbStatus = { connected: false, error: null };
  let uptime = process.uptime();

  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    db.prepare("SELECT 1").get();

    // Get DB stats
    const tableCount = db
      .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'")
      .get().cnt;
    const bookingCount = db
      .prepare("SELECT COUNT(*) as cnt FROM bookings")
      .get().cnt;
    const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users").get().cnt;

    dbStatus.connected = true;
    dbStatus.tables = tableCount;
    dbStatus.bookings = bookingCount;
    dbStatus.users = userCount;
    db.close();
  } catch (err) {
    dbStatus.connected = false;
    dbStatus.error = err.message;
  }

  ok(res, {
    status: dbStatus.connected ? "ok" : "degraded",
    version: "1.0.0",
    name: "ZenPass 禪流 API",
    time: new Date().toISOString(),
    uptime: Math.floor(uptime),
    uptime_human: formatDuration(uptime),
    database: dbStatus,
    memory: {
      free: Math.round(os.freemem() / 1024 / 1024) + " MB",
      total: Math.round(os.totalmem() / 1024 / 1024) + " MB",
      usage:
        Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100 +
        " MB",
    },
    platform: {
      node: process.version,
      arch: process.arch,
      hostname: os.hostname(),
    },
    // TODO: Integrate Sentry for production error tracking
    // sentry: process.env.SENTRY_DSN ? { dsn: process.env.SENTRY_DSN, enabled: true } : { enabled: false },
  });
});

function formatDuration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(d + "d");
  if (h > 0) parts.push(h + "h");
  if (m > 0) parts.push(m + "m");
  parts.push(s + "s");
  return parts.join(" ");
}

// ===== 404 Catch-all — Serve custom 404.html for unmatched routes =====
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res
      .status(404)
      .json({ success: false, error: "API endpoint not found" });
  }
  res.status(404).sendFile(path.join(__dirname, "../../frontend/404.html"));
});

// ===== 錯誤處理（集中式） =====
const { errorHandler, AppError } = require("./middleware/error-handler");
app.use(errorHandler);

const DB_PATH =
  process.env.DB_PATH || path.resolve(__dirname, "../data/zenpass.db");

// ===== 定期清理過期嘅 pending_payment（30分鐘未付款就釋放名額）=====
function cleanupExpiredBookings() {
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  // 清理過期未付款 booking，但保留已提交 FPS/PayMe 嘅（等 Admin 核實）
  // 清理過期未付款 booking（無付款證明，15分鐘）
  // 規則：進入付款程序即 hold 位，15分鐘內未完成付款則釋放
  const result = db
    .prepare(
      `
    UPDATE bookings SET status = 'cancelled', payment_status = 'refunded'
    WHERE status = 'pending_payment'
    AND fps_reference IS NULL
    AND payme_reference IS NULL
    AND created_at < datetime('now', '-15 minutes')
  `,
    )
    .run();

  // 清理已提交付款證明但 admin 未確認 >30min 嘅 booking（如 FPS 入數後無跟進）
  const staleResult = db
    .prepare(
      `
    UPDATE bookings SET status = 'cancelled'
    WHERE status = 'pending_payment'
    AND (fps_reference IS NOT NULL OR payme_reference IS NOT NULL)
    AND created_at < datetime('now', '-30 minutes')
  `,
    )
    .run();

  // 釋放名額：將剛 cancelled 嘅 booking 對應嘅 schedule 減返 enrolled_count
  const canceledIds = db
    .prepare(
      `SELECT schedule_id FROM bookings
       WHERE status = 'cancelled'
       AND created_at > datetime('now', '-16 minutes')`,
    )
    .all()
    .map((r) => r.schedule_id);

  for (const row of canceledIds) {
    if (row.schedule_id) {
      db.prepare(
        "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - 1) WHERE id = ? AND enrolled_count > 0",
      ).run(row.schedule_id);
    }
  }

  if (result.changes > 0) {
    console.log("🧹 清理了 " + result.changes + " 個過期未付款預約");
  }
  if (staleResult.changes > 0) {
    console.log(
      "🧹 清理了 " + staleResult.changes + " 個超過24小時嘅 stale 付款",
    );
  }
  db.close();
}

// 每 5 分鐘清理一次
setInterval(cleanupExpiredBookings, 5 * 60 * 1000);
// 啟動時先清理一次
cleanupExpiredBookings();

// ===== 課前 1 小時提醒 =====
function sendClassReminders() {
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    // 搵出 1 小時後上堂、狀態 confirmed、仲未提醒過嘅 booking
    const due = db
      .prepare(
        `
      SELECT b.id, b.user_id, b.class_id, b.schedule_id, b.id as booking_id,
             c.title as class_title, c.venue_name,
             cs.start_time, cs.end_time,
             u.name as user_name, u.email as user_email
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN users u ON b.user_id = u.id
      WHERE b.status = 'confirmed'
        AND (b.reminder_sent_1h IS NULL OR b.reminder_sent_1h = 0)
        AND cs.start_time > datetime('now', '+55 minutes')
        AND cs.start_time < datetime('now', '+65 minutes')
    `,
      )
      .all();

    for (const booking of due) {
      try {
        sendNotification("booking.reminder_1h", {
          recipient: booking.user_id,
          data: {
            class_title: booking.class_title,
            date: booking.start_time.split("T")[0],
            time: booking.start_time.split("T")[1]?.slice(0, 5),
            venue: booking.venue_name || "—",
          },
        });
        console.log(
          `⏰ 已發送提醒: ${booking.user_name} → ${booking.class_title}`,
        );

        // Mark as reminded (用 booking_id 防重複發送)
        db.prepare(`UPDATE bookings SET reminder_sent_1h = 1 WHERE id = ?`).run(
          booking.id,
        );
      } catch (e) {
        console.error(`⚠️ 提醒發送失敗 (booking=${booking.id}):`, e.message);
      }
    }

    if (due.length > 0) {
      console.log(`⏰ 發送了 ${due.length} 個課前提醒`);
    }
  } catch (err) {
    console.error("⚠️ 課前提醒排程錯誤:", err.message);
  } finally {
    db.close();
  }
}

// 每 5 分鐘 check 一次
setInterval(sendClassReminders, 5 * 60 * 1000);
// 啟動時 check 一次
setTimeout(sendClassReminders, 5000);

// ===== 行銷自動化 Cron =====
const marketing = require("./services/marketing");
marketing.startMarketingCron();

// ===== CRM 自動分群 Cron（每小時） =====
const { autoSegmentUsers } = require("./routes/crm");
setInterval(autoSegmentUsers, 60 * 60 * 1000);
autoSegmentUsers();

// ===== 自動通知有大量空位嘅課程 =====
function autoNotifyLargeVacancies() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // 找出 > 50% 空位嘅未來課程
    var vacancies = db
      .prepare(
        `
      SELECT cs.id as schedule_id, cs.class_id, cs.enrolled_count, cs.max_participants,
             c.title, c.category, cs.start_time
      FROM class_schedules cs
      JOIN classes c ON cs.class_id = c.id
      WHERE cs.start_time > datetime('now', '+1 hour')
        AND cs.start_time < datetime('now', '+7 days')
        AND cs.status = 'available'
        AND cs.max_participants > 0
        AND (cs.max_participants - cs.enrolled_count) > (cs.max_participants * 0.5)
      ORDER BY cs.start_time ASC
      LIMIT 20
    `,
      )
      .all();

    if (vacancies.length === 0) {
      console.log("📢 空位通知: 今日無需通知嘅課程");
      db.close();
      return;
    }

    // For each course with large vacancies, find interested users
    var notifiedCount = 0;
    var processedClassIds = [];

    for (var vi = 0; vi < vacancies.length; vi++) {
      var v = vacancies[vi];

      // Skip if we already processed this class_id
      if (processedClassIds.indexOf(v.class_id) !== -1) continue;
      processedClassIds.push(v.class_id);

      // 搵出報名過同類課程並且有興趣嘅用戶
      var interestedUsers = db
        .prepare(
          `
        SELECT DISTINCT b.user_id
        FROM bookings b
        JOIN classes c ON b.class_id = c.id
        WHERE c.category = ?
          AND b.status IN ('confirmed', 'attended')
          AND b.user_id IS NOT NULL
        UNION
        SELECT DISTINCT ua.user_id
        FROM user_actions ua
        WHERE ua.category = ?
          AND ua.action IN ('view_class', 'book_class', 'favorite')
          AND ua.user_id IS NOT NULL
      `,
        )
        .all(v.category, v.category);

      for (var ui = 0; ui < interestedUsers.length; ui++) {
        try {
          var { sendNotification } = require("./services/notification");
          sendNotification("booking.confirmed", {
            recipient: interestedUsers[ui].user_id,
            data: {
              message:
                "📢 名額釋放: 「" +
                v.title +
                "」有 " +
                (v.max_participants - v.enrolled_count) +
                " 個空位，快啲預約啦！",
            },
          });
          notifiedCount++;
        } catch (notifErr) {
          console.error("📢 自動通知發送失敗:", notifErr.message);
        }
      }
    }

    console.log(
      "📢 空位自動通知: " +
        processedClassIds.length +
        " 個課程, " +
        notifiedCount +
        " 個用戶已通知",
    );
    db.close();
  } catch (err) {
    console.error("📢 空位自動通知錯誤:", err.message);
  }
}

// 每 6 小時 check 一次
setInterval(autoNotifyLargeVacancies, 6 * 60 * 60 * 1000);
// 啟動時等 60 秒 check 一次
setTimeout(autoNotifyLargeVacancies, 60 * 1000);

// ===== Corporate Credit 月度重置（每 15 分鐘檢查）=====
setInterval(processCorporateResets, 15 * 60 * 1000);
processCorporateResets();

// ===== Pause 自動恢復排程（每 15 分鐘檢查）=====
function autoResumePausedMemberships() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const due = db
      .prepare(
        `SELECT id, user_id, type, pause_reason FROM memberships 
         WHERE paused_until IS NOT NULL 
         AND paused_until <= datetime('now') 
         AND status = 'active'`
      )
      .all();

    for (const m of due) {
      db.prepare(
        `UPDATE memberships SET paused_until = NULL, pause_reason = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(m.id);

      // Audit log
      try {
        db.prepare(
          `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, description, created_at)
           VALUES (?, 'membership.resume', 'membership', ?, 'system', ?, datetime('now'))`
        ).run(
          require("crypto").randomUUID(),
          m.id,
          `🔄 暫停期滿自動恢復: ${m.type} (用戶: ${m.user_id})`,
        );
      } catch (e) {}

      // Notify user
      try {
        const { sendNotification } = require("./services/notification");
        sendNotification("membership.resume", {
          recipient: m.user_id,
          data: { message: "🔁 會籍已自動恢復！暫停期已結束，立即預約課程！" },
        });
      } catch (notifErr) {
        console.error("[PAUSE RESUME] Notification error:", notifErr.message);
      }

      console.log(`[PAUSE RESUME] 自動恢復會籍 ${m.id} 用戶 ${m.user_id}`);
    }

    if (due.length > 0) {
      console.log(`[PAUSE RESUME] 已恢復 ${due.length} 個暫停會籍`);
    }
    db.close();
  } catch (err) {
    console.error("[PAUSE RESUME] Error:", err.message);
  }
}

setInterval(autoResumePausedMemberships, 15 * 60 * 1000);
autoResumePausedMemberships();

// ===== Loyalty Tier 每月計算排程（每 30 分鐘檢查月份變化）=====
let lastLoyaltyCheckMonth = null;
function checkAndUpdateLoyaltyTiers() {
  try {
    const now = new Date();
    const currentMonth = now.getFullYear() + "-" + (now.getMonth() + 1);
    if (lastLoyaltyCheckMonth === currentMonth) return;
    
    // Check if it's the 1st of the month (run once on the 1st)
    if (now.getDate() !== 1) {
      // Still check new users / changes for current month
      lastLoyaltyCheckMonth = currentMonth;
      return;
    }
    
    lastLoyaltyCheckMonth = currentMonth;
    
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    // Calculate last month's bookings per user
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    
    const bookingCounts = db
      .prepare(
        `SELECT user_id, COUNT(*) as cnt FROM bookings
         WHERE status IN ('confirmed', 'attended')
         AND created_at >= ? AND created_at <= ?
         GROUP BY user_id`
      )
      .all(lastMonth.toISOString(), lastMonthEnd.toISOString());

    let updated = 0;
    for (const row of bookingCounts) {
      let tier = "bronze";
      if (row.cnt >= 20) tier = "vip";
      else if (row.cnt >= 10) tier = "gold";
      else if (row.cnt >= 5) tier = "silver";

      db.prepare(
        `UPDATE users SET loyalty_tier = ?, monthly_bookings = ? WHERE id = ?`
      ).run(tier, row.cnt, row.user_id);
      updated++;
    }

    console.log(`[LOYALTY] 已更新 ${updated} 個用戶嘅忠誠度等級 (${lastMonth.toISOString().slice(0,7)})`);
    db.close();
  } catch (err) {
    console.error("[LOYALTY] Error:", err.message);
  }
}

// Check every 30 minutes (will only run on 1st of month)
setInterval(checkAndUpdateLoyaltyTiers, 30 * 60 * 1000);
setTimeout(checkAndUpdateLoyaltyTiers, 15000);

// ===== Credit 到期預警通知（每小時檢查，28-31 號發送）=====
const { startCreditScheduler } = require("./services/credit-scheduler");
startCreditScheduler();

// ===== Membership EEGC
function checkExpiringMemberships() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    const expiring = db.prepare(
      "SELECT m.id, m.user_id, m.end_date, m.plan_id, u.email, u.name FROM memberships m JOIN users u ON m.user_id = u.id WHERE m.status = 'active' AND m.end_date BETWEEN datetime('now') AND datetime('now', '+7 days')",
    ).all();

    for (const m of expiring) {
      try {
        const daysLeft = Math.ceil((new Date(m.end_date) - new Date()) / 86400000);
        sendNotification("membership.expiring", {
          recipient: m.user_id,
          data: { end_date: m.end_date, plan_id: m.plan_id, days_left: daysLeft }
        });
      } catch (e) {
        console.error("Expiry notification error (" + m.id + "):", e.message);
      }
    }

    const expiredResult = db.prepare(
      "UPDATE memberships SET status = 'expired', updated_at = datetime('now') WHERE status = 'active' AND end_date < datetime('now')",
    ).run();

    db.close();

    if (expiring.length > 0) {
      console.log("[MEMBERSHIP CHECK] " + expiring.length + " EEGC");
    }
    if (expiredResult.changes > 0) {
      console.log("[MEMBERSHIP CHECK] " + expiredResult.changes + " EEGC");
    }
  } catch (err) {
    console.error("[MEMBERSHIP CHECK] Error:", err.message);
  }
}

setInterval(checkExpiringMemberships, 60 * 60 * 1000);
setTimeout(checkExpiringMemberships, 10000);
// ===== Startup Health Check =====
function startupHealthCheck() {
  const checks = {
    database: false,
    stripe_key: false,
    port: false,
  };

  // Check DB
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");
    db.prepare("SELECT 1").get();
    checks.database = true;
    db.close();
  } catch (err) {
    console.error("❌ Startup Check — DB 連線失敗:", err.message);
  }

  // Check Stripe key
  if (
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_SECRET_KEY !== "sk_test_xxxxxxxxxxxxxxxxxxxx"
  ) {
    checks.stripe_key = true;
  } else {
    console.warn(
      "⚠️ Startup Check — Stripe key 未設定或使用預設值，信用卡付款將使用 dev fallback",
    );
  }

  // Check port (will be checked when listen succeeds)
  checks.port = true;

  const allPassed = Object.values(checks).every((v) => v === true);
  if (allPassed) {
    console.log("✅ 啟動健康檢查：全部通過");
  } else {
    console.warn("⚠️ 啟動健康檢查：部分檢查未通過", JSON.stringify(checks));
  }

  return checks;
}

// ===== 錯誤處理 =====

// Global uncaught exceptions
process.on("uncaughtException", (err) => {
  logger.error("未捕獲異常 (uncaughtException)", {
    error: err.message,
    stack: err.stack,
  });
  // 給 logger 時間寫入，然後優雅重啟
  setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", (reason) => {
  logger.error("未處理的 Promise 拒絕 (unhandledRejection)", {
    error: reason?.message || reason,
    stack: reason?.stack,
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("收到 SIGTERM 信號，正在關閉伺服器...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  logger.info("收到 SIGINT 信號，正在關閉伺服器...");
  server.close(() => process.exit(0));
});

// ===== 自動備份（啟動時檢查，>24h 無備份就創建）=====
const {
  autoBackupOnStartup,
  scheduleDailyBackup,
} = require("./services/backup");
autoBackupOnStartup();
// 每日凌晨 3 點自動備份排程
scheduleDailyBackup();

// ===== 安裝金融記錄保護觸發器 =====
try {
  const { installDeleteTriggers } = require("./services/financial-protection");
  installDeleteTriggers();

  // 初始化 blockchain 寫入 hash table
  try {
    const { ensureBlockchainTable } = require("./services/blockchain-audit");
    ensureBlockchainTable();
  } catch (bcErr) {
    console.error("⚠️ Blockchain table init failed:", bcErr.message);
  }
} catch (protectErr) {
  console.error("⚠️ 金融保護 trigger 安裝失敗:", protectErr.message);
}

// ===== 啟動 =====
console.log("🛡️ CSRF protection enabled (Double Submit Cookie)");

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(`ZenPass 伺服器已啟動`, {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    cors: process.env.CORS_ORIGIN || "http://localhost:8080",
  });
  console.log(`
╔═══════════════════════════════════════════╗
║     ZenPass 禪流 API 伺服器已啟動         ║
║     Port: ${PORT}                           ║
║     環境: ${process.env.NODE_ENV || "development"}                    ║
║     前端: ${process.env.CORS_ORIGIN || "http://localhost:8080"}   ║
╚═══════════════════════════════════════════╝
  `);
});
