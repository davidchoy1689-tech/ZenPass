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
  try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN auto_renew INTEGER DEFAULT 0");
  } catch (e) {}
  // Set admin role for existing admin users
  try {
    db.exec("UPDATE users SET role = 'admin' WHERE email LIKE '%admin%' OR email LIKE '%@zenpass.hk'");
  } catch (e) {}

  
  // ===== CRM 學生管理 =====
  try {
    db.exec("ALTER TABLE users ADD COLUMN tags TEXT DEFAULT ''");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN notes TEXT DEFAULT ''");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN last_visit TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN total_visits INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN total_spent REAL DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN lead_source TEXT DEFAULT ''");
  } catch (e) {}

  // Student notes table (per-coach notes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_notes (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      coach_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (coach_id) REFERENCES users(id)
    )
  `);


  // ===== 多場地管理 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      is_primary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id)
    )
  `);
  try {
    db.exec("ALTER TABLE class_schedules ADD COLUMN location_id TEXT REFERENCES locations(id)");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE class_schedules ADD COLUMN notes TEXT");
  } catch (e) {}

  // ===== POS / 銷售記錄 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      location_id TEXT,
      type TEXT NOT NULL CHECK(type IN ('class','package','retail','other')),
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      payment_method TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coach_id) REFERENCES users(id),
      FOREIGN KEY (location_id) REFERENCES locations(id)
    )
  `);


  // ===== 推薦計劃 =====
  try {
    db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN referred_by TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN referral_credits_earned INTEGER DEFAULT 0");
  } catch (e) {}
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_redemptions (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_user_id TEXT,
      code_used TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
      reward_given INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (referrer_id) REFERENCES users(id)
    )
  `);

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

  // ===== 勳章定義表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT DEFAULT '🏅',
      category TEXT NOT NULL CHECK(category IN ('attendance','explorer','streak','social','special','district')),
      condition_type TEXT NOT NULL,
      condition_value TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ===== 用戶勳章表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_badges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      earned_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (badge_id) REFERENCES badges(id),
      UNIQUE(user_id, badge_id)
    );
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id)");
  } catch (e) {}

  // ===== 預設勳章種子數據 =====
  const existingBadges = db.prepare("SELECT COUNT(*) as count FROM badges").get();
  if (existingBadges.count === 0) {
    const insertBadge = db.prepare(`
      INSERT INTO badges (id, name, description, icon, category, condition_type, condition_value, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const badges = [
      // 出席類
      ['bdg_att_01', '初出茅廬', '首次完成課程預約', '🌱', 'attendance', 'total_bookings', '1', 1],
      ['bdg_att_02', '運動初心者', '完成 10 堂課程', '🏃', 'attendance', 'total_bookings', '10', 2],
      ['bdg_att_03', '運動愛好者', '完成 25 堂課程', '💪', 'attendance', 'total_bookings', '25', 3],
      ['bdg_att_04', '運動達人', '完成 50 堂課程', '🏆', 'attendance', 'total_bookings', '50', 4],
      ['bdg_att_05', '傳奇運動員', '完成 100 堂課程', '👑', 'attendance', 'total_bookings', '100', 5],

      // 類別探索類
      ['bdg_exp_01', '好奇寶寶', '嘗試 2 種不同類別課程', '🔍', 'explorer', 'categories_count', '2', 10],
      ['bdg_exp_02', '探索者', '嘗試 4 種不同類別課程', '🎯', 'explorer', 'categories_count', '4', 11],
      ['bdg_exp_03', '全能運動員', '嘗試全部類別課程', '🌟', 'explorer', 'categories_count', '5', 12],

      // 連續挑戰類
      ['bdg_str_01', '持續努力', '連續簽到 3 天', '🔥', 'streak', 'checkin_streak', '3', 20],
      ['bdg_str_02', '一週達人', '連續簽到 7 天', '🔥', 'streak', 'checkin_streak', '7', 21],
      ['bdg_str_03', '半個月挑戰', '連續簽到 15 天', '🌟', 'streak', 'checkin_streak', '15', 22],
      ['bdg_str_04', '鐵人認證', '連續簽到 30 天', '💎', 'streak', 'checkin_streak', '30', 23],

      // 社交貢獻類
      ['bdg_soc_01', '評論家', '撰寫 5 個課後評價', '⭐', 'social', 'reviews_count', '5', 30],
      ['bdg_soc_02', '專業評論', '撰寫 15 個課後評價', '📝', 'social', 'reviews_count', '15', 31],
      ['bdg_soc_03', '社交蝴蝶', '推薦 1 位朋友', '👥', 'social', 'referrals_count', '1', 32],
      ['bdg_soc_04', '人氣王', '推薦 3 位朋友', '🤝', 'social', 'referrals_count', '3', 33],

      // 特別成就類
      ['bdg_spc_01', '星光會員', '達到銀牌等級', '🥈', 'special', 'points_tier', 'silver', 40],
      ['bdg_spc_02', '金牌貴賓', '達到金牌等級', '🥇', 'special', 'points_tier', 'gold', 41],
      ['bdg_spc_03', '鑽石尊享', '達到鑽石等級', '💎', 'special', 'points_tier', 'diamond', 42],
      ['bdg_spc_04', '成就大師', '獲得 10 個勳章', '🥇', 'special', 'total_badges', '10', 43],
      ['bdg_spc_05', '完美收集', '獲得 20 個勳章', '🏅', 'special', 'total_badges', '20', 44],

      // 地區打卡類 - 香港18區
      ['bdg_dst_01', '🌊 中西區', '在中西區上過課', '🌊', 'district', 'district_checkin', '中西區', 60],
      ['bdg_dst_02', '🏔️ 東區', '在東區上過課', '🏔️', 'district', 'district_checkin', '東區', 61],
      ['bdg_dst_03', '🌳 南區', '在南區上過課', '🌳', 'district', 'district_checkin', '南區', 62],
      ['bdg_dst_04', '🏛️ 灣仔區', '在灣仔區上過課', '🏛️', 'district', 'district_checkin', '灣仔區', 63],
      ['bdg_dst_05', '🏯 九龍城區', '在九龍城區上過課', '🏯', 'district', 'district_checkin', '九龍城區', 64],
      ['bdg_dst_06', '🏭 觀塘區', '在觀塘區上過課', '🏭', 'district', 'district_checkin', '觀塘區', 65],
      ['bdg_dst_07', '🛍️ 深水埗區', '在深水埗區上過課', '🛍️', 'district', 'district_checkin', '深水埗區', 66],
      ['bdg_dst_08', '🙏 黃大仙區', '在黃大仙區上過課', '🙏', 'district', 'district_checkin', '黃大仙區', 67],
      ['bdg_dst_09', '🌆 油尖旺區', '在油尖旺區上過課', '🌆', 'district', 'district_checkin', '油尖旺區', 68],
      ['bdg_dst_10', '🏝️ 離島區', '在離島區上過課', '🏝️', 'district', 'district_checkin', '離島區', 69],
      ['bdg_dst_11', '🌿 葵青區', '在葵青區上過課', '🌿', 'district', 'district_checkin', '葵青區', 70],
      ['bdg_dst_12', '⛰️ 北區', '在北區上過課', '⛰️', 'district', 'district_checkin', '北區', 71],
      ['bdg_dst_13', '🌊 西貢區', '在西貢區上過課', '🌊', 'district', 'district_checkin', '西貢區', 72],
      ['bdg_dst_14', '🏘️ 沙田區', '在沙田區上過課', '🏘️', 'district', 'district_checkin', '沙田區', 73],
      ['bdg_dst_15', '🌸 大埔區', '在大埔區上過課', '🌸', 'district', 'district_checkin', '大埔區', 74],
      ['bdg_dst_16', '♨️ 荃灣區', '在荃灣區上過課', '♨️', 'district', 'district_checkin', '荃灣區', 75],
      ['bdg_dst_17', '🏖️ 屯門區', '在屯門區上過課', '🏖️', 'district', 'district_checkin', '屯門區', 76],
      ['bdg_dst_18', '🌾 元朗區', '在元朗區上過課', '🌾', 'district', 'district_checkin', '元朗區', 77],
    ];
    const insertMany = db.transaction((badges) => {
      for (const b of badges) insertBadge.run(...b);
    });
    insertMany(badges);
    console.log('✅ 已初始化 ' + badges.length + ' 個 ZenPass 勳章');
  }

  // IPO audit log migration
  try {
    const { migrate } = require("./migrate-audit");
    migrate();
  } catch (migErr) {
    console.error("⚠️ Audit migration failed:", migErr.message);
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
