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
const logger = require("./services/logger");
const { sendNotification } = require("./services/notification");

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
const { randomUUID } = require("crypto");
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
        "https://davidchoy1689-tech.github.io",
        "https://davidchoy1689-tech.github.io/ZenPass",
        "http://localhost:8080",
        "http://localhost:9090",
        "http://localhost:8888",
        "http://localhost:3001",
        "http://localhost:3000",
        undefined, // Allow same-origin
      ];
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

// Security headers (Helmet) - disable CSP to allow inline styles/scripts for now
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// Compression middleware (gzip/brotli) — before static file serving
app.use(compression({ threshold: 256, level: 6 }));

// Redirect unauthenticated access to admin.html
app.use("/admin.html", (req, res, next) => {
  // If no token in query/cookie, redirect to login - but still serve static
  next();
});

// 靜態檔案服務 - 直接 serve ZenPass 前台和管理後台
app.use(express.static(path.join(__dirname, "../../frontend")));
// admin files served from frontend/admin/ via root static middleware
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分鐘
  max: process.env.NODE_ENV === "test" ? 1000 : 500,
  message: { error: "太多請求，請稍後再試" },
});
app.use("/api/", limiter);

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

// ===== 路由 =====
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
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
app.use("/api/ai", require("./routes/ai"));
app.use("/api/marketing", require("./routes/marketing"));
app.use("/api/reporting", require("./routes/reporting"));
app.use("/api/referral", require("./routes/referral"));
app.use("/api/loyalty", require("./routes/referral"));
app.use("/api/partner", require("./routes/partner"));
app.use("/api/recommendations", require("./routes/recommendations"));
app.use("/api/track", require("./routes/recommendations"));
app.use("/api/pricing", require("./routes/pricing"));
app.use("/api/venue-rentals", require("./routes/venue-rentals"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/admin", require("./routes/deploy"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/audit", require("./routes/audit").router);

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
