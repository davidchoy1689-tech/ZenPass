/**
 * ZenPass 禪流 - 數據庫初始化
 * 建立所有資料表
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

function initDatabase() {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // ===== 用戶表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      avatar_url TEXT,
      auth_provider TEXT DEFAULT 'email' CHECK(auth_provider IN ('email','apple','google')),
      auth_provider_id TEXT,
      credits INTEGER DEFAULT 0,
      membership_type TEXT DEFAULT 'none' CHECK(membership_type IN ('none','trial','standard','unlimited')),
      membership_expires_at TEXT,
      is_coach INTEGER DEFAULT 0,
      coach_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ===== 教練申請表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      years_experience TEXT,
      specialties TEXT,
      certificates TEXT,
      bio TEXT,
      venue_name TEXT,
      venue_address TEXT,
      venue_photos TEXT,
      facilities TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ===== 課程表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_en TEXT,
      description TEXT,
      description_en TEXT,
      category TEXT NOT NULL,
      difficulty TEXT DEFAULT 'beginner' CHECK(difficulty IN ('beginner','intermediate','advanced')),
      duration INTEGER NOT NULL,
      max_participants INTEGER DEFAULT 15,
      price_hkd REAL NOT NULL,
      credits_cost INTEGER DEFAULT 0,
      venue_name TEXT,
      venue_address TEXT,
      latitude REAL,
      longitude REAL,
      image_url TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','deleted')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id)
    );
  `);

  // ===== 課程時間表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_schedules (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      recurring TEXT DEFAULT 'none' CHECK(recurring IN ('none','daily','weekly','biweekly')),
      max_participants INTEGER,
      enrolled_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'available' CHECK(status IN ('available','full','cancelled')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
  `);

  // ===== 預約表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      payment_type TEXT CHECK(payment_type IN ('single','credits','membership_trial','membership_standard','membership_unlimited')),
      payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','refunded','cancelled')),
      amount REAL,
      stripe_payment_intent_id TEXT,
      fps_reference TEXT,
      payme_reference TEXT,
      status TEXT DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','confirmed','attended','cancelled','no_show')),
      reminder_sent_1h INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (schedule_id) REFERENCES class_schedules(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
  `);

  // 附加欄位（相容升級）
  try {
    const cols = db.prepare("PRAGMA table_info('bookings')").all();
    if (!cols.find((c) => c.name === "reminder_sent_1h")) {
      db.exec(
        "ALTER TABLE bookings ADD COLUMN reminder_sent_1h INTEGER DEFAULT 0",
      );
    }
  } catch (e) {
    // ignore if table already exists
  }

  // ===== 會籍表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('trial','standard','unlimited')),
      price_hkd REAL NOT NULL,
      credits_granted INTEGER DEFAULT 0,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
      stripe_subscription_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ===== 課金交易紀錄 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('membership','credits_topup','single_booking','refund')),
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'HKD',
      payment_method TEXT CHECK(payment_method IN ('stripe','fps','payme','credits','free')),
      stripe_payment_intent_id TEXT,
      fps_reference TEXT,
      payme_reference TEXT,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','refunded')),
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // ===== 索引 =====
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_schedule ON bookings(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_classes_coach ON classes(coach_id);
    CREATE INDEX IF NOT EXISTS idx_classes_category ON classes(category);
    CREATE INDEX IF NOT EXISTS idx_schedules_class ON class_schedules(class_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_time ON class_schedules(start_time);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  `);

  // ===== 教練收入表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_earnings (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      schedule_id TEXT,
      class_id TEXT,
      class_title TEXT,
      date TEXT NOT NULL,
      enrolled_count INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      gross_amount REAL DEFAULT 0,
      commission_rate REAL DEFAULT 0.75,
      net_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','paid','cancelled')),
      payout_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id),
      FOREIGN KEY (schedule_id) REFERENCES class_schedules(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
  `);

  // ===== 教練提現表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_payouts (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      net_amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'bank' CHECK(payment_method IN ('bank','fps','payme')),
      bank_name TEXT,
      bank_account TEXT,
      bank_code TEXT,
      fps_phone TEXT,
      payme_phone TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','rejected','cancelled')),
      notes TEXT,
      processed_by TEXT,
      processed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id)
    );
  `);

  // ===== 索引 =====
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_earnings_coach ON coach_earnings(coach_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_earnings_date ON coach_earnings(date)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_earnings_status ON coach_earnings(status)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_payouts_coach ON coach_payouts(coach_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_payouts_status ON coach_payouts(status)",
    );

    // ===== 教練私人收入表 =====
    db.exec(`
      CREATE TABLE IF NOT EXISTS private_income (
        id TEXT PRIMARY KEY,
        coach_id TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT DEFAULT '其他',
        client_name TEXT,
        client_phone TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (coach_id) REFERENCES users(id)
      );
    `);
    try {
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_private_income_coach ON private_income(coach_id)",
      );
    } catch (e) {}
  } catch (e) {}

  // ===== 通知記錄表 (in-app 推送) =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_notif_user ON notification_logs(user_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notification_logs(user_id, is_read)",
    );
  } catch (e) {}

  // ===== 站內通知表 (對外的 notification API) =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)",
    );
  } catch (e) {}

  // ===== 瀏覽器推送訂閱表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subscription TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)",
    );
  } catch (e) {}

  // ===== 課程內容表 (course_contents) =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_contents (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      course_number TEXT UNIQUE,
      title TEXT,
      description TEXT,
      rich_content TEXT,
      video_url TEXT,
      images TEXT,
      materials TEXT,
      level TEXT DEFAULT 'beginner'
        CHECK(level IN ('beginner','intermediate','advanced','all_levels')),
      benefits TEXT,
      faqs TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES classes(id)
    );
  `);

  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_course_contents_course ON course_contents(course_id)"
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_course_contents_number ON course_contents(course_number)"
    );
  } catch (e) {}

  // ===== 積分系統 (Points/Loyalty) - 相容升級 =====
  try {
    db.exec("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN points_tier TEXT DEFAULT 'bronze'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN points_tier_label TEXT DEFAULT '🥉 銅牌'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN last_checkin TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN checkin_streak INTEGER DEFAULT 0");
  } catch (e) {}

  // ===== 積分交易紀錄 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS points_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('earn','spend')),
      points INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('booking','checkin','review','referral','streak_bonus','weekly_bonus','redeem','admin','signup_bonus','other')),
      reference_id TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_points_user ON points_transactions(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_points_user_time ON points_transactions(user_id, created_at DESC)");
  } catch (e) {}

  // ===== 積分獎勵目錄 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS points_rewards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      points_cost INTEGER NOT NULL,
      reward_type TEXT NOT NULL CHECK(reward_type IN ('discount','credit','free_class','merchandise','other')),
      reward_value TEXT,
      icon TEXT DEFAULT '🎁',
      stock INTEGER DEFAULT -1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ===== 積分兌換記錄 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS points_redemptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reward_id TEXT NOT NULL,
      reward_name TEXT NOT NULL,
      points_spent INTEGER NOT NULL,
      reward_value TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','used','expired')),
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reward_id) REFERENCES points_rewards(id)
    );
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_redemptions_user ON points_redemptions(user_id)");
  } catch (e) {}

  // ===== 預設獎勵種子數據 =====
  const existingRewards = db.prepare("SELECT COUNT(*) as count FROM points_rewards").get();
  if (existingRewards.count === 0) {
    const insertReward = db.prepare(`
      INSERT INTO points_rewards (id, name, description, points_cost, reward_type, reward_value, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const rewards = [
      ['rwd_01', '\$10 折扣碼', '下次預約即減 \$10', 200, 'discount', '10', '🎫'],
      ['rwd_02', '\$25 折扣碼', '下次預約即減 \$25', 450, 'discount', '25', '🎫'],
      ['rwd_03', '5 點 Credits', '即時獲得 5 點 Credits', 800, 'credit', '5', '⭐'],
      ['rwd_04', '10 點 Credits', '即時獲得 10 點 Credits', 1500, 'credit', '10', '⭐'],
      ['rwd_05', '免費堂數 1 堂', '免費參加一堂常規課程（任何類別）', 2000, 'free_class', '1', '🏅'],
      ['rwd_06', 'ZenPass 環保袋', '限量版 ZenPass 環保購物袋', 500, 'merchandise', 'bag', '🛍️'],
      ['rwd_07', '私人教練體驗 1 節', '一對一私人教練體驗課 60 分鐘', 3500, 'free_class', 'pt_session', '💪'],
    ];
    const insertMany = db.transaction((rewards) => {
      for (const r of rewards) insertReward.run(...r);
    });
    insertMany(rewards);
    console.log('✅ 已初始化 7 個積分獎勵');
  }

  console.log("✅ 數據庫初始化完成:", DB_PATH);
  db.close();
}

// 如果直接執行此檔案
if (require.main === module) {
  require("dotenv").config({ path: __dirname + "/../../.env" });
  initDatabase();
}

module.exports = initDatabase;
